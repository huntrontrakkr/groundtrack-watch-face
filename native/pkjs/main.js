// Groundtrack Enroute, phone side. Renders an hour's scene on the phone and
// sends it to the watch in chunks: this hour's on launch, and whichever hour
// the watch asks for (this hour's if it has none, the next one's shortly
// before the hour). Never on a timer of its own.
//
// This is the source; tools/build-pkjs.mjs bundles it, with the renderer
// and the coastline and relief data, into native/src/pkjs/index.js.
// Settings are kept in localStorage:
//   body, plate, flag ('1' or '0'), timeZone (default: the phone's),
//   home (JSON {lat, lon}, or {none: true}; default: the preset home for the
//   zone, if any)
// The settings page (config.html) sets body, plate, flag and home.
//   sceneServer: fetch scenes from tools/scene-server.mjs instead, for development
//   elementsUrl: where to fetch element sets (default CelesTrak's GP query),
//   for development against a mirror
// Satellites' element sets are fetched from CelesTrak at most once every two
// hours each (as CelesTrak asks) and kept, under tle-<catalog number>.
import {inflateSync} from 'fflate';
import {buildScene} from '../../src/native-scene.js';
import {decodeRelief} from '../../src/relief.js';
import {civilHour} from '../../src/chart-render.js';
import {HOMES} from '../../src/home.js';
import {PLATES} from '../../src/enroute-render.js';
import {registerElements,viewOf,FRESH} from '../../src/satellites.js';
import CONFIG_PAGE from './config.html';
import {LAND,RELIEF} from 'groundtrack:data';

var CHUNK=2000;

function setting(key,fallback){
  var value=localStorage.getItem(key);
  return value===null||value===''?fallback:value;
}

// base64 without atob, which not every phone's JavaScript engine has.
function unbase64(text){
  var table=new Uint8Array(128),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for(var k=0;k<64;k++)table[alphabet.charCodeAt(k)]=k;
  var n=text.length,pad=text[n-1]==='='?(text[n-2]==='='?2:1):0,out=new Uint8Array(n/4*3-pad),o=0;
  for(var i=0;i<n;i+=4){
    var v=table[text.charCodeAt(i)]<<18|table[text.charCodeAt(i+1)]<<12|table[text.charCodeAt(i+2)]<<6|table[text.charCodeAt(i+3)];
    out[o++]=v>>16&255;if(o<out.length)out[o++]=v>>8&255;if(o<out.length)out[o++]=v&255;
  }
  return out;
}

// The data is inflated on first use and kept for the app's life.
var atlas=null,meters=null;
function data(){
  if(!atlas){atlas=inflateSync(unbase64(LAND));meters=decodeRelief(inflateSync(unbase64(RELIEF)));}
  return {atlas:atlas,meters:meters};
}

function zone(){
  var fallback='UTC';
  try{fallback=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(error){}
  return setting('timeZone',fallback);
}

function home(timeZone){
  var saved=setting('home',null);
  if(saved){try{var h=JSON.parse(saved);if(h.none)return null;if(isFinite(h.lat)&&isFinite(h.lon))return {code:'HOM',name:'Home',lat:+h.lat,lon:+h.lon};}catch(error){}}
  return HOMES[timeZone]||null;
}

function renderScene(start,done){
  var began=Date.now(),timeZone=zone(),d=data();
  var scene=buildScene({atlas:d.atlas,meters:d.meters,body:setting('body','sun'),start:start,
    plate:setting('plate','enroute'),flag:setting('flag','1')==='1',timeZone:timeZone,home:home(timeZone)}).scene;
  console.log('Scene for '+new Date(start).toISOString()+' rendered in '+(Date.now()-began)+' ms: '+scene.length+' bytes');
  done(scene);
}

function fetchScene(server,start,done,failed){
  var url=server+'/scene?body='+encodeURIComponent(setting('body','sun'))+'&plate='+encodeURIComponent(setting('plate','enroute'))+
    '&flag='+setting('flag','1')+'&zone='+encodeURIComponent(zone())+'&at='+start;
  var request=new XMLHttpRequest();
  request.open('GET',url);
  request.responseType='arraybuffer';
  request.onload=function(){
    if(request.status!==200)return failed('NO CHART','Scene server answered '+request.status);
    done(new Uint8Array(request.response));
  };
  request.onerror=function(){failed('NO CHART','Scene server unreachable at '+url);};
  request.send();
}

// One scene in flight at a time, one message at a time: the total, then each
// chunk with its offset. A message the watch doesn't take is tried again a
// few times; after that the scene is abandoned and the watch asks again.
var sending=false,waiting=null,last=null;
function sendScene(bytes,finished){
  var offset=-1,failures=0;
  function next(){
    if(offset>=bytes.length){console.log('Scene sent: '+bytes.length+' bytes');finished(true);return;}
    var n=offset<0?0:Math.min(CHUNK,bytes.length-offset);
    var message=offset<0?{SceneTotal:bytes.length}:{SceneOffset:offset,SceneChunk:Array.prototype.slice.call(bytes.subarray(offset,offset+n))};
    Pebble.sendAppMessage(message,function(){offset=offset<0?0:offset+n;failures=0;next();},function(){
      if(++failures>5){console.log('The watch is not taking the scene');finished(false);}
      else setTimeout(next,500*failures);
    });
  }
  next();
}

// A satellite's elements: kept ones if younger than two hours, otherwise
// fetched from CelesTrak, otherwise kept ones still within three days of
// their epoch. GPS and QZSS fall back to their nominal orbits, as the study
// does; other satellites have none, and the watch is told so.
var ELEMENTS_AGE=2*3600000;
function elements(body,done){
  if(body.indexOf('sat:')!==0)return done(null);
  var norad=body.slice(4),key='tle-'+norad,kept=null;
  try{kept=JSON.parse(localStorage.getItem(key));}catch(error){}
  function use(text,source){try{registerElements(text,source);return true;}catch(error){console.log('Elements for '+norad+' refused: '+error.message);return false;}}
  function fallback(reason){
    if(kept&&Date.now()-kept.epoch<FRESH&&use(kept.text,'celestrak'))return done(null);
    done(viewOf(body)==='world'?'NO ELEMENTS':null,reason);
  }
  if(kept&&Date.now()-kept.fetched<ELEMENTS_AGE&&use(kept.text,'celestrak'))return done(null);
  // After a failed request, wait a while before the next.
  var tried=Number(localStorage.getItem('tle-tried-'+norad))||0;
  if(Date.now()-tried<15*60000)return fallback('Tried CelesTrak '+Math.round((Date.now()-tried)/60000)+' min ago');
  try{localStorage.setItem('tle-tried-'+norad,String(Date.now()));}catch(error){}
  var request=new XMLHttpRequest();
  request.open('GET',setting('elementsUrl','https://celestrak.org/NORAD/elements/gp.php')+'?CATNR='+norad+'&FORMAT=TLE');
  request.onload=function(){
    if(request.status!==200)return fallback('CelesTrak answered '+request.status);
    var text=request.responseText;
    try{var e=registerElements(text,'celestrak');}catch(error){return fallback(error.message);}
    try{localStorage.setItem(key,JSON.stringify({text:text,fetched:Date.now(),epoch:e.epoch}));localStorage.removeItem('tle-tried-'+norad);}catch(error){}
    console.log('Elements for '+norad+' from CelesTrak, epoch '+new Date(e.epoch).toISOString());
    done(null);
  };
  request.onerror=function(){fallback('CelesTrak unreachable');};
  request.send();
}

// When the phone can't draw the hour, the watch says why instead of waiting.
function status(text){
  console.log('Status to the watch: '+text);
  Pebble.sendAppMessage({SceneStatus:text},function(){},function(){});
}

// The scene for the civil hour holding `when` (milliseconds). The last
// scene is kept, so a request the watch repeats (a transfer it lost) is sent
// again without rendering it again. A request that arrives while that same
// hour is being prepared or sent (the watch asking as the phone side
// starts) is already answered.
function refresh(when){
  var start=civilHour(when,zone());
  if(sending){waiting=start;return;}
  sending=true;
  function finish(ok){
    sending=false;
    var w=waiting;waiting=null;
    if(w!==null&&!(ok&&w===start))refresh(w);
  }
  function send(bytes){
    last={start:start,key:settingsKey(),bytes:bytes};
    sendScene(bytes,finish);
  }
  function fail(text,error){console.log('No scene: '+(error&&error.message||error||text));status(text);finish(false);}
  if(last&&last.start===start&&last.key===settingsKey())return send(last.bytes);
  var server=setting('sceneServer',null),body=setting('body','sun');
  if(server)return fetchScene(server,start,send,fail);
  if(viewOf(body)!=='hour')return fail('VIEW NOT YET ON WATCH');
  elements(body,function(problem,reason){
    if(problem)return fail(problem,reason);
    try{renderScene(start,send);}
    catch(error){fail(/three days/.test(error.message)?'ELEMENTS TOO OLD':'NO CHART',error);}
  });
}
function settingsKey(){return [setting('body','sun'),setting('plate','enroute'),setting('flag','1'),zone(),setting('home','')].join('|');}

// The settings page, offline: a data URL holding the page and the settings.
var BODIES=['sun','moon','sat:36585'];
Pebble.addEventListener('showConfiguration',function(){
  var timeZone=zone(),preset=HOMES[timeZone];
  var config={settings:{body:setting('body','sun'),plate:setting('plate','enroute'),flag:setting('flag','1'),home:setting('home',''),timeZone:timeZone},
    plates:Object.keys(PLATES).map(function(k){return [k,PLATES[k].name,PLATES[k].note];}),preset:preset?preset.name:null};
  // The settings go inside a script element: no '<' may close it.
  var page=CONFIG_PAGE.replace('__CONFIG__',function(){return JSON.stringify(config).replace(/</g,'\\u003c');});
  Pebble.openURL('data:text/html;charset=utf-8,'+encodeURIComponent(page));
});
Pebble.addEventListener('webviewclosed',function(e){
  if(!e||!e.response||e.response==='CANCELLED')return;
  var chosen;
  try{chosen=JSON.parse(e.response.charAt(0)==='{'?e.response:decodeURIComponent(e.response));}catch(error){console.log('Unreadable settings');return;}
  if(BODIES.indexOf(chosen.body)>=0)localStorage.setItem('body',chosen.body);
  if(PLATES[chosen.plate])localStorage.setItem('plate',chosen.plate);
  if(chosen.flag==='1'||chosen.flag==='0')localStorage.setItem('flag',chosen.flag);
  if(typeof chosen.home==='string')localStorage.setItem('home',chosen.home);
  // This hour again, in the new settings; the watch drops any next hour it
  // was keeping and asks for it again.
  refresh(Date.now());
});

Pebble.addEventListener('ready',function(){refresh(Date.now());});
// The watch asks with a Unix time in the hour it wants.
Pebble.addEventListener('appmessage',function(e){
  var at=e.payload.SceneRequest;
  if(at!==undefined)refresh(at>0?at*1000:Date.now());
});
