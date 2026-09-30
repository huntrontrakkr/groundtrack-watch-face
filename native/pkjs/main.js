// Groundtrack Enroute, phone side. The watch draws the Sun and Moon charts
// itself; the phone sends it what it needs for that: its settings, the Sun
// and Moon as daily segments some weeks ahead, and home's rise and set, when
// the watch asks and when settings change. For a satellite the phone renders
// the hour's scene and sends it in chunks: whichever hour the watch asks
// for (this hour's if it has none, the next one's shortly before the hour).
// Never on a timer of its own.
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
import {segmentFor,encodeSegment,DAY} from '../../src/segments.js';
import {riseSet} from '../../src/home.js';
import {localDay,localDate} from '../../src/enroute-render.js';
import {clockParts} from '../../src/render.js';
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

// Every message to the watch goes through one queue, one at a time. A
// message the watch doesn't take is tried again a few times; after that it
// is dropped with the rest of its group (a scene's chunks), and the watch
// asks again.
var queue=[],pumping=false;
function enqueue(message,group,done){queue.push({message:message,group:group,done:done,failures:0});pump();}
function pump(){
  if(pumping||!queue.length)return;
  pumping=true;var item=queue[0];
  Pebble.sendAppMessage(item.message,function(){
    queue.shift();pumping=false;if(item.done)item.done(true);pump();
  },function(){
    pumping=false;
    if(++item.failures>5){
      console.log('The watch is not taking the scene');
      queue=queue.filter(function(q){return q!==item&&!(item.group&&q.group===item.group);});
      if(item.done)item.done(false);pump();
    }else setTimeout(pump,500*item.failures);
  });
}

// A scene: its total, then each chunk with its offset.
var sending=false,waiting=null,last=null,scenes=0;
function sendScene(bytes,finished){
  var group='scene'+(++scenes),ended=false;
  function end(ok){if(!ended){ended=true;if(ok)console.log('Scene sent: '+bytes.length+' bytes');finished(ok);}}
  enqueue({SceneTotal:bytes.length},group,function(ok){if(!ok)end(false);});
  for(var offset=0;offset<bytes.length;offset+=CHUNK)(function(offset){
    var n=Math.min(CHUNK,bytes.length-offset),final=offset+n>=bytes.length;
    enqueue({SceneOffset:offset,SceneChunk:Array.prototype.slice.call(bytes.subarray(offset,offset+n))},group,function(ok){if(!ok||final)end(ok);});
  })(offset);
}

// What the watch needs to draw the Sun and Moon itself. Settings: body (0
// Sun, 1 Moon, 2 a satellite), plate, flag, 24-hour, home, then home's
// latitude and longitude in hundredths of a degree (i32 each).
function watchSettings(){
  var body=setting('body','sun'),h=home(zone()),plate=Object.keys(PLATES).indexOf(setting('plate','enroute'));
  var bytes=[body==='sun'?0:body==='moon'?1:2,plate<0?0:plate,setting('flag','1')==='1'?1:0,1,h?1:0];
  function i32(v){bytes.push(v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255);}
  i32(h?Math.round(h.lat*100):0);i32(h?Math.round(h.lon*100):0);
  return bytes;
}
function sendSettings(){enqueue({Settings:watchSettings()});}
// The Sun and Moon segments from a UTC day to SEGMENT_DAYS ahead: positions
// and phase only (228 bytes a day), eight to a message.
var SEGMENT_DAYS=45,WATCH_SEGMENT=228;
function sendSegments(fromDay){
  var today=Math.floor(Date.now()/DAY),end=today+SEGMENT_DAYS;
  if(!(fromDay>=today-1&&fromDay<end))fromDay=today;
  for(var day=fromDay;day<end;day+=8){
    var bytes=[];
    for(var d=day;d<Math.min(day+8,end);d++){var seg=encodeSegment(segmentFor(d*DAY));for(var k=0;k<WATCH_SEGMENT;k++)bytes.push(seg[k]);}
    enqueue({Segments:bytes});
  }
  console.log('Segments sent from day '+fromDay+' to '+(end-1));
}
// Home's rise and set by local date, 12 bytes a date: the date (days since
// 1970), then the Sun's rise and set and the Moon's, in minutes of the local
// day (65535 for none), as renderEnroute's riseText gives them.
function sendRiseSets(){
  var timeZone=zone(),h=home(timeZone);if(!h)return;
  var bytes=[],t=Date.now();
  function u16(v){bytes.push(v&255,(v>>8)&255);}
  for(var n=0;n<SEGMENT_DAYS;n++){
    var day=localDay(t,timeZone),d=localDate(day.start,timeZone),number=Date.UTC(d.year,d.month-1,d.day)/DAY;
    bytes.push(number&255,(number>>8)&255,(number>>16)&255,(number>>>24)&255);
    ['sun','moon'].forEach(function(body){
      var r=riseSet(body,h,day.start);
      [r.rise,r.set].forEach(function(e){if(e===null||e===undefined)u16(65535);else{var q=clockParts(e,timeZone);u16(Number(q.h)*60+Number(q.m));}});
    });
    t=day.end;
  }
  enqueue({RiseSets:bytes});
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
  enqueue({SceneStatus:text});
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
  // The watch draws again in the new settings (a satellite's hour it asks
  // for again), with home's rise and set for the new home.
  sendSettings();sendRiseSets();
});

// On launch, the settings: the watch asks for anything else it lacks.
Pebble.addEventListener('ready',function(){sendSettings();});
Pebble.addEventListener('appmessage',function(e){
  // A satellite's scene for the hour holding a Unix time.
  var at=e.payload.SceneRequest;
  if(at!==undefined)refresh(at>0?at*1000:Date.now());
  // Segments from a UTC day (days since 1970), and home's rise and set.
  var from=e.payload.DataRequest;
  if(from!==undefined){sendSegments(from);sendRiseSets();}
});
