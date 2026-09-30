// Groundtrack Enroute, phone side. Renders the current hour's scene on the
// phone and sends it to the watch in chunks: on launch, and when the watch
// asks (a new hour, or a scene lost). Never on a timer of its own.
//
// This is the source; tools/build-pkjs.mjs bundles it, with the renderer
// and the coastline and relief data, into native/src/pkjs/index.js.
// Settings are kept in localStorage:
//   body, plate, flag ('1' or '0'), timeZone (default: the phone's),
//   home (JSON {lat, lon}; default: the preset home for the zone, if any)
//   sceneServer: fetch scenes from tools/scene-server.mjs instead, for development
import {inflateSync} from 'fflate';
import {buildScene} from '../../src/native-scene.js';
import {decodeRelief} from '../../src/relief.js';
import {civilHour} from '../../src/chart-render.js';
import {HOMES} from '../../src/home.js';
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
  if(saved){try{var h=JSON.parse(saved);if(isFinite(h.lat)&&isFinite(h.lon))return {code:'HOM',name:'Home',lat:+h.lat,lon:+h.lon};}catch(error){}}
  return HOMES[timeZone]||null;
}

function renderScene(done){
  var began=Date.now(),timeZone=zone(),d=data();
  var scene=buildScene({atlas:d.atlas,meters:d.meters,body:setting('body','sun'),start:civilHour(Date.now(),timeZone),
    plate:setting('plate','enroute'),flag:setting('flag','1')==='1',timeZone:timeZone,home:home(timeZone)}).scene;
  console.log('Scene rendered in '+(Date.now()-began)+' ms: '+scene.length+' bytes');
  done(scene);
}

function fetchScene(server,done){
  var url=server+'/scene?body='+encodeURIComponent(setting('body','sun'))+'&plate='+encodeURIComponent(setting('plate','enroute'))+
    '&flag='+setting('flag','1')+'&zone='+encodeURIComponent(zone())+'&at='+Date.now();
  var request=new XMLHttpRequest();
  request.open('GET',url);
  request.responseType='arraybuffer';
  request.onload=function(){
    if(request.status!==200){console.log('Scene server answered '+request.status);return;}
    done(new Uint8Array(request.response));
  };
  request.onerror=function(){console.log('Scene server unreachable at '+url);};
  request.send();
}

// One message at a time: the total, then each chunk with its offset.
function sendScene(bytes){
  var offset=0;
  function next(){
    if(offset>=bytes.length){console.log('Scene sent: '+bytes.length+' bytes');return;}
    var n=Math.min(CHUNK,bytes.length-offset),message={SceneOffset:offset,SceneChunk:Array.prototype.slice.call(bytes.subarray(offset,offset+n))};
    Pebble.sendAppMessage(message,function(){offset+=n;next();},function(){setTimeout(next,500);});
  }
  Pebble.sendAppMessage({SceneTotal:bytes.length},next,function(){console.log('The watch did not take the scene size');});
}

function refresh(){
  var server=setting('sceneServer',null);
  try{
    if(server)fetchScene(server,sendScene);else renderScene(sendScene);
  }catch(error){console.log('No scene: '+(error&&error.message||error));}
}

Pebble.addEventListener('ready',refresh);
Pebble.addEventListener('appmessage',function(e){if(e.payload.SceneRequest!==undefined)refresh();});
