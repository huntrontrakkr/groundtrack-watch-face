// Groundtrack and Groundtrack Fuller, phone side (one source,
// bundled for each face: GROUNDTRACK_FACE). The watch draws every chart itself; the
// phone sends it what it needs for that: its settings, the Sun and Moon as
// daily segments some weeks ahead, home's rise and set, and a satellite's
// segments and passes a few days ahead, when the watch asks and when
// settings change. Never on a timer of its own.
//
// This is the source; tools/build-pkjs.mjs bundles it into
// native/src/pkjs/index.js.
// Settings are kept in localStorage:
//   body ('sun', 'moon' or 'sat:' and a catalog number), face ('enroute' or
//   'plotboard': which of Groundtrack's two faces; without it, the body's
//   own), also ('sun', 'moon' or both, comma-separated: marked beside the
//   body), hourFigures ('1' or '0': the hour chart with or without its hour
//   figures), legend ('1': a Fuller sheet's scale bar), sats (JSON [{norad, name, code, period, ecc, still}]: satellites added
//   from CelesTrak on the settings page),
//   plate, readout ('off', 'flag' or 'callout'; before it, flag '1' or
//   '0'), numerals (the callout's figures: colon, plain, even, mono, accent),
//   margin ('utc' or 'body'), span ('day' or 'hour': QZSS's chart), tape
//   ('fixed', 'tape', 'slide' or 'clock': the world band's time scale), clock24
//   ('1' or '0'), timeZone (default: the phone's),
//   home (JSON {lat, lon}, or {none: true}; default: the preset home for the
//   zone, if any), events (JSON [{epoch, title, label}]: reporting points on
//   the route, each named with a five-letter code unique on its local day)
// The settings page (config.html) sets all but timeZone.
//   elementsUrl: where to fetch element sets (default CelesTrak's GP query),
//   for development against a mirror
// Satellites' element sets are fetched from CelesTrak at most once every two
// hours each (as CelesTrak asks) and kept, under tle-<catalog number>.
import {HOMES} from '../../src/home.js';
import {PLATES,PLATE_ORDER,FIGURE_SETS} from '../../src/plates.js';
import {registerElements,elementsFor,viewOf,plotOf,periodOf,CATALOG,GROUPS,catalogEntry,bodyId,addSatellite,forgetSatellites,addedSatellites} from '../../src/satellites.js';
import {chartOf,faceFor,VIEW_CODES} from '../../src/settings-rules.js';
import {segmentFor,encodeSegment,DAY,satelliteSegmentFor,encodeSatelliteSegment,satelliteSpan} from '../../src/segments.js';
import {riseSet,encodePassBlock,PASS_BLOCK} from '../../src/home.js';
import {localDay,localDate} from '../../src/chart-text.js';
import {clockParts} from '../../src/render.js';
import {registerNominal} from '../../src/nominal.js';
import {uniqueCode} from '../../src/events.js';
import {calendarEvents} from '../../src/ical.js';
import CONFIG_PAGE from './config.html';
import RULES_TEXT from 'groundtrack-rules-text';
// The settings page's preview runs the watch's own core on this hour's
// chart input (src/chart-input.js), as the watch would draw it, beside the
// same frame as the watch's reflective screen shows its colours (Pebble's
// Sunlight mapping).
import PAGE_ASSETS from 'groundtrack-page-assets';
import SUNLIGHT from '../../data/sunlight-colors.json';
import {devicePosition} from './device-position.js';

// GPS and QZSS have nominal orbits to fall back on, as the study does.
registerNominal();

function setting(key,fallback){
  var value=localStorage.getItem(key);
  return value===null||value===''?fallback:value;
}

function zone(){
  var fallback='UTC';
  try{fallback=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(error){}
  return setting('timeZone',fallback);
}

function home(timeZone){
  var saved=setting('home',null);
  if(saved){try{var h=JSON.parse(saved);if(h.none)return null;if(typeof h.lat==='number'&&typeof h.lon==='number'&&Math.abs(h.lat)<=90&&Math.abs(h.lon)<=180)return {code:'HOM',name:'Home',lat:h.lat,lon:h.lon};}catch(error){}}
  return HOMES[timeZone]||null;
}

// Every message to the watch goes through one queue, one at a time. A
// message the watch doesn't take is tried again a few times; after that the
// queue is dropped, and the watch asks again for the data it still lacks.
// It never asks for its settings or events, so those dropped are owed: sent
// with the next thing the watch asks for, and tried again a few times (the
// watch may only have been out of reach).
var queue=[],pumping=false,waiting=false,owed=false,owedTries=0;
function enqueue(message){queue.push({message:message,failures:0});pump();}
function dropped(){
  var lost=queue.some(function(item){return item.message.Settings||item.message.Events;});
  queue=[];
  if(lost)owed=true;
  // (Eight more tries over twenty minutes, then only when the watch asks.)
  if(owed&&owedTries<8){owedTries++;setTimeout(payOwed,30000*owedTries);}
}
function payOwed(){if(!owed)return;owed=false;sendSettings();sendEvents();}
function pump(){
  if(pumping||waiting||!queue.length)return;
  pumping=true;var item=queue[0];
  function failed(){
    pumping=false;
    if(++item.failures>5){console.log('The watch is not taking a message');dropped();}
    else{waiting=true;setTimeout(function(){waiting=false;pump();},500*item.failures);}
  }
  try{
    Pebble.sendAppMessage(item.message,function(){queue.shift();pumping=false;pump();},failed);
  }catch(error){failed();}
}

// What the watch needs to draw its charts itself. Settings: body (0 Sun, 1
// Moon, 2 a satellite), plate, the minute readout (0 none, 1 the flag, 2 a
// time callout), 24-hour, home, then home's latitude and longitude in
// hundredths of a degree (i32 each), then a satellite's catalog number
// (i32), the body's kind (1 a station, plus its view, 0 the hour chart, 1
// the world band, 2 the whole day, 3 the world band's whole day, times 2)
// and its code (3 characters), then the
// callout's figures (0 colon, 1 plain, 2 even, 3 mono, 4 accent), the
// margin's time (0 Zulu, 1 the nautical zone under the body) and the world
// band's time scale (0 fixed, 1 a sliding tape, 2 the world sliding too,
// 3 a clock)
// and, on the fixed tape, how its minutes fall on the route (0 off, 1 a
// vernier, 2 a comb, 3 chevrons), the figure set (FIGURE_SETS' index), the
// margins' corner, and which of the Sun (1) and Moon (2) are marked beside
// the body, whether the hour chart is bare of its hour figures, and whether
// a Fuller sheet carries its scale bar.
var FIGURES=FIGURE_SETS.map(function(f){return f[0];});
// The margins' corner: the day of the year (the world band: the height), the
// body's ground point, the Moon's light.
var CORNERS=['day','point','light'];
var READOUTS=['off','flag','callout','counter'],NUMERALS=['colon','plain','even','mono','accent'],TAPES=['fixed','tape','slide','clock','route'],TRANSFERS=['off','vernier','comb','chevrons'];
function readout(){var r=setting('readout',null);return READOUTS.indexOf(r)>=0?r:setting('flag','1')==='1'?'flag':'off';}
// The chart a body has (src/settings-rules.js chartOf): on Groundtrack by
// the face chosen (a fast satellite's is the Plotboard, whichever was) and
// the body's orbit; on Groundtrack Fuller a rolling Fuller sheet of a
// satellite's hour (QZSS's of its day, unless its hour is chosen).
function face(body){return FACE==='fuller'?'fuller':faceFor(setting('face',''),viewOf(body));}
function chart(body){return chartOf(face(body),body,viewOf(body),setting('span','day'),plotOf(body));}
function daily(body){var c=chart(body);return c==='day'||c==='worldday';}
// (The hour chart bare of its hour figures: hourFigures '0'.)
function bare(){return setting('hourFigures','1')==='0';}
function also(){return setting('also','').split(',').filter(function(k){return k==='sun'||k==='moon';});}
function watchSettings(){
  var body=currentBody(),h=home(zone()),plate=Object.keys(PLATES).indexOf(setting('plate','enroute'));
  var sat=body.indexOf('sat:')===0,entry=sat?catalogEntry(body):null,numerals=NUMERALS.indexOf(setting('numerals','even'));
  // (A bare hour chart has the time in full beside the body.)
  var bytes=[body==='sun'?0:body==='moon'?1:2,plate<0?0:plate,bare()&&chart(body)==='hour'?2:READOUTS.indexOf(readout()),setting('clock24','1')==='0'?0:1,h?1:0];
  function i32(v){bytes.push(v&255,(v>>8)&255,(v>>16)&255,(v>>>24)&255);}
  i32(h?Math.round(h.lat*100):0);i32(h?Math.round(h.lon*100):0);
  i32(sat?Number(body.slice(4)):0);
  // (Groundtrack Fuller's Sun and Moon have the one chart: no view is sent.)
  bytes.push((entry&&entry.symbol==='station'?1:0)|(sat||FACE!=='fuller'?VIEW_CODES[chart(body)]:0)<<1);
  var code=entry?entry.code:'';for(var k=0;k<3;k++)bytes.push(k<code.length?code.charCodeAt(k):0);
  var tape=TAPES.indexOf(setting('tape','fixed'));
  var transfer=TRANSFERS.indexOf(setting('transfer','off'));
  var figures=FIGURES.indexOf(setting('figures','michroma')),corner=CORNERS.indexOf(setting('corner','day'));
  bytes.push(numerals<0?2:numerals,setting('margin','utc')==='body'?1:0,tape<0?0:tape,transfer<0?0:transfer,figures<0?FIGURES.indexOf('michroma'):figures,corner<0?0:corner,
    (also().indexOf('sun')>=0?1:0)|(also().indexOf('moon')>=0?2:0),bare()?1:0,setting('legend','0')==='1'?1:0);
  return bytes;
}
function sendSettings(){enqueue({Settings:watchSettings()});}
// A satellite the watch draws itself: its segments from an hour ago to
// three days ahead (as far as its elements reach), twelve to a message, and
// home's passes by twelve-hour block.
var SAT_DAYS=3;
function sendSatellite(norad){
  var body='sat:'+norad;
  // (Asked again while its elements are being fetched: that answer serves.)
  if(fetching[norad])return;
  elements(body,function(problem,reason){
    if(problem){console.log('No elements for '+body+': '+(reason||problem));status(problem);return;}
    // From an hour ago, or for the whole-day chart from a day ago (its day
    // starts at local midnight).
    // (The hour's chart starts 40 minutes before its local hour, which the
    // watch may be 59 minutes into.)
    var span,now=Math.floor(Date.now()/1000),bytes=[],sent=0,back=daily(body)?26*3600:6000;
    try{span=satelliteSpan(body);}catch(error){console.log('No orbit for '+body+': '+error.message);return;}
    for(var t=Math.floor((now-back)/span)*span;t<now+SAT_DAYS*86400;t+=span){
      var seg;try{seg=encodeSatelliteSegment(satelliteSegmentFor(body,t*1000));}catch(error){break;}
      for(var k=0;k<seg.length;k++)bytes.push(seg[k]);sent++;
      if(bytes.length>=12*seg.length){enqueue({SatSegments:bytes});bytes=[];}
    }
    if(bytes.length)enqueue({SatSegments:bytes});
    // (Elements that place it nowhere, a decayed satellite's say: the watch
    // is told, not left waiting.)
    if(!sent){status('NO ELEMENTS: DATA');return;}
    var timeZone=zone(),h=home(timeZone);
    if(h)for(var b=Math.floor(Date.now()/PASS_BLOCK)*PASS_BLOCK;b<Date.now()+SAT_DAYS*DAY;b+=PASS_BLOCK){
      // (With whose they are: the watch may have chosen another since.)
      try{enqueue({Passes:Array.prototype.slice.call(encodePassBlock(body,h,b,timeZone)),DataBody:Number(norad)});}catch(error){break;}
    }
    console.log('Satellite '+norad+': '+sent+' segments sent');
  });
}
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
// does; other satellites have none, and the watch is told so, with why:
// NET (CelesTrak out of reach), TIME (no answer in twenty seconds), HTTP and
// the status it answered with, DATA (an answer that is no element set) or
// WAIT (a failure a moment ago: not asked again yet).
// One request at a time for a satellite: the watch asks twice as it starts,
// and the second asking waits for the first's answer.
// After a failure the next request waits: a minute if CelesTrak was out of
// reach (the phone may only have been starting), fifteen if it answered
// badly; and the phone tries again itself when the wait is over.
var ELEMENTS_AGE=2*3600000,fetching={},RETRY_NET=60000,RETRY_BAD=15*60000;
function elements(body,done){
  if(body.indexOf('sat:')!==0)return done(null);
  var norad=body.slice(4),key='tle-'+norad,kept=null;
  try{kept=JSON.parse(localStorage.getItem(key));}catch(error){}
  // (Elements for another object are not this one's.)
  function mine(e){if(e.norad!==Number(norad))throw new Error('elements for '+e.norad);return e;}
  function use(text,source){try{mine(registerElements(text,source));return true;}catch(error){console.log('Elements for '+norad+' refused: '+error.message);return false;}}
  function fallback(reason,why,answer){
    // (Kept elements still serve within their time: three days in a low
    // orbit, a fortnight in a high one.)
    if(kept&&kept.text&&Date.now()-kept.epoch<(periodOf(body)>480?30:3)*86400000&&use(kept.text,'celestrak'))return answer(null,reason);
    // (GPS and QZSS have their nominal orbits; the rest have nothing.)
    answer(elementsFor(body)?null:'NO ELEMENTS: '+why,reason);
  }
  if(kept&&kept.text&&Date.now()-kept.fetched<ELEMENTS_AGE&&use(kept.text,'celestrak'))return done(null);
  if(fetching[norad]){fetching[norad].push(done);return;}
  var tried=Number(localStorage.getItem('tle-tried-'+norad))||0,wait=Number(localStorage.getItem('tle-wait-'+norad))||RETRY_BAD;
  if(Date.now()-tried<wait)return fallback('Tried CelesTrak '+Math.round((Date.now()-tried)/1000)+' s ago','WAIT',done);
  var waiting=fetching[norad]=[done],settled=false;
  function finish(problem,reason){
    if(settled)return;settled=true;delete fetching[norad];
    waiting.forEach(function(w){w(problem,reason);});
  }
  function failed(reason,why,retry){
    if(settled)return;
    // (Out of reach again within the hour: twice the wait, to fifteen minutes.)
    if(retry<RETRY_BAD&&Date.now()-tried<3600000)retry=Math.min(RETRY_BAD,Math.max(retry,2*(Number(localStorage.getItem('tle-wait-'+norad))||0)));
    try{localStorage.setItem('tle-tried-'+norad,String(Date.now()));localStorage.setItem('tle-wait-'+norad,String(retry));}catch(error){}
    // Again when the wait is over, if this satellite is still the one shown:
    // quietly, the watch sent its orbit only once CelesTrak has given it.
    setTimeout(function(){
      if(currentBody()===body)elements(body,function(problem,stale){if(!problem&&!stale)sendSatellite(norad);});
    },retry+1000);
    fallback(reason,why,finish);
  }
  var request=new XMLHttpRequest();
  request.open('GET',setting('elementsUrl','https://celestrak.org/NORAD/elements/gp.php')+'?CATNR='+norad+'&FORMAT=TLE');
  request.onload=function(){
    if(request.status!==200)return failed('CelesTrak answered '+request.status,'HTTP '+request.status,RETRY_BAD);
    var text=request.responseText;
    try{var e=mine(registerElements(text,'celestrak'));}catch(error){return failed(error.message,'DATA',RETRY_BAD);}
    try{localStorage.setItem(key,JSON.stringify({text:text,fetched:Date.now(),epoch:e.epoch}));}catch(error){}
    try{localStorage.removeItem('tle-tried-'+norad);localStorage.removeItem('tle-wait-'+norad);}catch(error){}
    console.log('Elements for '+norad+' from CelesTrak, epoch '+new Date(e.epoch).toISOString());
    finish(null);
  };
  request.onerror=function(){failed('CelesTrak unreachable','NET',RETRY_NET);};
  request.ontimeout=function(){failed('CelesTrak did not answer','TIME',RETRY_NET);};
  try{request.timeout=20000;}catch(error){}
  // (And should neither handler be called: the same, a little later.)
  setTimeout(function(){failed('CelesTrak did not answer','TIME',RETRY_NET);},30000);
  try{request.send();}catch(error){failed('The request could not be sent: '+error.message,'NET',RETRY_NET);}
}

// When the phone can't give a satellite's orbit, the watch says why instead
// of waiting.
function status(text){
  console.log('Status to the watch: '+text);
  enqueue({Status:text});
}

// Events ({epoch, title}), from the calendar whose link the settings hold
// (none by default): the past day's and after are kept, at most forty, each
// named with a five-letter code unique on its local day (src/events.js), as
// the study names them.
// (Only what saveEvents wrote: a time the calendar holds, a title, a label.)
function storedEvents(){
  var v=[];try{v=JSON.parse(setting('events','[]'));}catch(error){}
  return Array.isArray(v)?v.filter(function(e){return e&&typeof e.epoch==='number'&&Math.abs(e.epoch)<4e12&&typeof e.title==='string'&&typeof e.label==='string';}):[];
}
function saveEvents(list){
  var timeZone=zone(),kept=[],now=Date.now();
  list.filter(function(e){return e&&typeof e.epoch==='number'&&e.epoch<4e12&&typeof e.title==='string'&&e.title.trim()&&e.epoch>now-86400000;})
    .sort(function(a,b){return a.epoch-b.epoch;}).slice(0,40).forEach(function(e){
      var day=localDay(e.epoch,timeZone),taken=kept.filter(function(k){return k.epoch>=day.start&&k.epoch<day.end;}).map(function(k){return k.label;});
      kept.push({epoch:Math.floor(e.epoch/60000)*60000,title:e.title.trim().slice(0,40),label:uniqueCode(e.title,taken)});
    });
  localStorage.setItem('events',JSON.stringify(kept));
}
// The watch's events: the next twenty from two hours ago, each its time
// (i32 Unix seconds) and name (5 characters). `changed` sends them only if
// they are not the ones last sent (the watch draws its chart again for
// them): later events come into the twenty as earlier ones pass.
var eventsSent=null;
function sendEvents(changed){
  var now=Date.now(),bytes=[];
  // (No link, no events: none are kept from before there was one.)
  (calendarLink()?storedEvents():[]).filter(function(e){return e.epoch>now-7200000;}).slice(0,20).forEach(function(e){
    var t=Math.floor(e.epoch/1000);bytes.push(t&255,(t>>8)&255,(t>>16)&255,(t>>>24)&255);
    for(var k=0;k<5;k++)bytes.push(k<e.label.length?e.label.charCodeAt(k):0);
  });
  var key=bytes.join(',');
  if(changed&&key===eventsSent)return;
  eventsSent=key;
  enqueue({Events:bytes.length?bytes:[0]});
}

// The calendar: its private iCalendar link, if the settings hold one (they
// hold none unless one is put there, and then nothing is fetched). The
// phone reads it on starting, on saving, and every three hours while it
// runs; the events of the next eight days are kept and the watch's sent if
// they have changed. The link and the calendar stay on the phone: only each
// event's time and five-letter name go to the watch.
var CALENDAR_EVERY=3*3600000,calendarTimer=null,calendarOut=false;
function calendarLink(){
  var link=String(setting('calendar','')).trim().replace(/^webcal:/i,'https:');
  return /^https?:\/\/\S+$/i.test(link)?link:'';
}
function calendarStatus(text){try{localStorage.setItem('calendar-status',text);}catch(error){}console.log('Calendar: '+text);}
function fetchCalendar(force){
  var link=calendarLink();
  if(calendarTimer){clearTimeout(calendarTimer);calendarTimer=null;}
  if(!link||calendarOut)return;
  var last=Number(localStorage.getItem('calendar-fetched'))||0,now=Date.now();
  if(!force&&now-last<CALENDAR_EVERY){calendarTimer=setTimeout(function(){fetchCalendar(false);},CALENDAR_EVERY-(now-last)+1000);return;}
  try{localStorage.setItem('calendar-fetched',String(now));}catch(error){}
  calendarOut=true;
  var settled=false,request=new XMLHttpRequest();
  function done(problem,text){
    if(settled)return;settled=true;calendarOut=false;
    if(calendarLink()!==link)return;
    if(problem)calendarStatus(problem);
    else try{
      var found=calendarEvents(text,{from:Date.now()-7200000,to:Date.now()+8*86400000,zone:zone(),limit:40});
      saveEvents(found);calendarStatus(found.length+(found.length===1?' event':' events')+' in the next week');
      sendEvents(true);
    }catch(error){calendarStatus(error.message==='No calendar in the answer'?'The link gave no calendar':'The calendar could not be read');}
    calendarTimer=setTimeout(function(){fetchCalendar(false);},CALENDAR_EVERY);
  }
  request.open('GET',link);
  request.onload=function(){if(request.status===200)done(null,request.responseText);else done('The link answered '+request.status);};
  request.onerror=function(){done('The link could not be reached');};
  request.ontimeout=function(){done('The link did not answer');};
  try{request.timeout=30000;}catch(error){}
  setTimeout(function(){done('The link did not answer');},45000);
  try{request.send();}catch(error){done('The link could not be reached');}
}

// The settings page, offline: a data URL holding the page and the settings.
var FACE=typeof GROUNDTRACK_FACE==='string'?GROUNDTRACK_FACE:'enroute';
// Both faces: the Sun, the Moon and any satellite: the catalog's, and those
// added on the settings page from CelesTrak (kept under sats).
function loadSatellites(){
  var list=[];try{list=JSON.parse(setting('sats','[]'));}catch(error){}
  forgetSatellites();
  if(Array.isArray(list))list.slice(0,40).forEach(function(e){try{addSatellite(e);}catch(error){}});
}
loadSatellites();
// (An added satellite as it is kept and given to the page.)
function kept(c){return {norad:c.norad,name:c.name,code:c.code,period:c.period,ecc:c.ecc||0,still:!!c.still};}
function known(body){return body==='sun'||body==='moon'||(typeof body==='string'&&!!catalogEntry(body));}
function bodies(){return ['sun','moon'].concat(CATALOG.concat(addedSatellites()).map(function(c){return bodyId(c.norad);}));}
// Fuller starts on the ISS's hour, as the watch does.
var FIRST=FACE==='fuller'?'sat:25544':'sun';
function currentBody(){var b=setting('body',FIRST);return known(b)?b:FIRST;}
// A data-URL page can't reliably ask for the phone's location itself (as
// Dymaxion found), so the phone takes a coarse fix first, waiting at most
// five seconds, and passes it in, rounded to 0.01°.
// What the page's preview is made from. The page makes each chart input
// itself (src/page-input.js, with the core among its assets), in the
// settings as they stand on it, so every choice is previewed; from here it
// has the element sets the phone has kept, the time zone and its city, and
// the calendar's events.
function previewInputs(){
  var timeZone=zone(),tles={};
  bodies().forEach(function(body){
    if(body.indexOf('sat:')!==0)return;
    var k=null;try{k=JSON.parse(localStorage.getItem('tle-'+body.slice(4)));}catch(error){}
    if(k&&typeof k.text==='string')tles[body.slice(4)]=k.text;
  });
  // (now: the phone's clock, which the page's follows.)
  return {assets:PAGE_ASSETS,sunlight:SUNLIGHT.colors,tles:tles,zone:timeZone,preset:HOMES[timeZone]||null,events:calendarLink()?storedEvents():[],now:Date.now()};
}
Pebble.addEventListener('showConfiguration',function(){
  var timeZone=zone(),preset=HOMES[timeZone],opened=false;
  function open(position){
    if(opened)return;opened=true;
    var config={settings:{body:currentBody(),face:face(currentBody()),also:also(),hourFigures:setting('hourFigures','1'),legend:setting('legend','0'),calendar:setting('calendar',''),plate:setting('plate','enroute'),readout:readout(),numerals:setting('numerals','even'),figures:setting('figures','michroma'),corner:setting('corner','day'),
      margin:setting('margin','utc'),span:setting('span','day'),tape:setting('tape','fixed'),transfer:setting('transfer','off'),clock24:setting('clock24','1'),home:setting('home',''),timeZone:timeZone},
      // (The calendar's events as last read, and how that went.)
      events:calendarLink()?storedEvents():[],calendarStatus:calendarLink()?setting('calendar-status',''):'',
      // (Each body with its chart, the minutes it takes a lap, its group and
      // what the Plotboard shows of it: the page says by them which face it
      // can be on and what each shows. The satellites added are the page's
      // to list and to add to: elementsUrl is where it looks for more.)
      face:FACE,bodies:[['sun','Sun','Its ground point, where it stands overhead','hour',periodOf('sun'),'','day'],['moon','Moon','In its calculated phase','hour',periodOf('moon'),'','day']].concat(
        CATALOG.map(function(c){var b=bodyId(c.norad);return [b,c.code+' · '+c.name,c.note,viewOf(b),c.period,c.group,plotOf(b)];})),
      groups:GROUPS,sats:addedSatellites().map(kept),
      elementsUrl:setting('elementsUrl','https://celestrak.org/NORAD/elements/gp.php'),
      plates:PLATE_ORDER.map(function(k){return [k,PLATES[k].name,PLATES[k].note];}),figureSets:FIGURE_SETS,preset:preset?preset.name:null,position:position};
    // The settings go inside a script element: no '<' may close it.
    // (Both in one pass: an event's title may spell either mark.)
    var page=CONFIG_PAGE.replace(/__CONFIG__|__PREVIEW__|__RULES__/g,function(mark){return mark==='__RULES__'?RULES_TEXT:JSON.stringify(mark==='__CONFIG__'?config:previewInputs()).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');});
    Pebble.openURL('data:text/html;charset=utf-8,'+encodeURIComponent(page));
  }
  setTimeout(function(){open(null);},5000);
  devicePosition().then(function(p){open({lat:Math.round(p.coords.latitude*100)/100,lon:Math.round(p.coords.longitude*100)/100});},function(){open(null);});
});
Pebble.addEventListener('webviewclosed',function(e){
  if(!e||!e.response||e.response==='CANCELLED')return;
  var chosen;
  try{chosen=JSON.parse(e.response.charAt(0)==='{'?e.response:decodeURIComponent(e.response));}catch(error){console.log('Unreadable settings');return;}
  if(!chosen||typeof chosen!=='object')return;
  // The satellites added from CelesTrak (each checked as it is taken), and
  // the elements the page fetched for them, kept as the phone's own would
  // be: it does not ask CelesTrak again for two hours.
  if(Array.isArray(chosen.sats)){
    forgetSatellites();
    chosen.sats.slice(0,40).forEach(function(e){try{addSatellite(e);}catch(error){}});
    localStorage.setItem('sats',JSON.stringify(addedSatellites().map(kept)));
  }
  if(chosen.tles&&typeof chosen.tles==='object')Object.keys(chosen.tles).slice(0,40).forEach(function(norad){
    var text=chosen.tles[norad];
    if(typeof text!=='string'||text.length>400||!known('sat:'+norad))return;
    try{var e=registerElements(text,'celestrak');if(e.norad===Number(norad))localStorage.setItem('tle-'+norad,JSON.stringify({text:text,fetched:Date.now(),epoch:e.epoch}));}catch(error){}
  });
  if(known(chosen.body))localStorage.setItem('body',chosen.body);
  if(chosen.face==='enroute'||chosen.face==='plotboard')localStorage.setItem('face',chosen.face);
  if(chosen.legend==='1'||chosen.legend==='0')localStorage.setItem('legend',chosen.legend);
  if(chosen.hourFigures==='1'||chosen.hourFigures==='0')localStorage.setItem('hourFigures',chosen.hourFigures);
  if(Array.isArray(chosen.also))localStorage.setItem('also',chosen.also.filter(function(k){return k==='sun'||k==='moon';}).join(','));
  if(PLATES[chosen.plate])localStorage.setItem('plate',chosen.plate);
  if(READOUTS.indexOf(chosen.readout)>=0)localStorage.setItem('readout',chosen.readout);
  if(NUMERALS.indexOf(chosen.numerals)>=0)localStorage.setItem('numerals',chosen.numerals);
  if(FIGURES.indexOf(chosen.figures)>=0)localStorage.setItem('figures',chosen.figures);
  if(CORNERS.indexOf(chosen.corner)>=0)localStorage.setItem('corner',chosen.corner);
  if(chosen.margin==='utc'||chosen.margin==='body')localStorage.setItem('margin',chosen.margin);
  if(chosen.span==='day'||chosen.span==='hour')localStorage.setItem('span',chosen.span);
  if(TAPES.indexOf(chosen.tape)>=0)localStorage.setItem('tape',chosen.tape);
  if(TRANSFERS.indexOf(chosen.transfer)>=0)localStorage.setItem('transfer',chosen.transfer);
  if(chosen.clock24==='1'||chosen.clock24==='0')localStorage.setItem('clock24',chosen.clock24);
  if(typeof chosen.home==='string')localStorage.setItem('home',chosen.home);
  // The calendar's link: a new one is read at once; none, and its events go.
  var linkBefore=calendarLink();
  if(typeof chosen.calendar==='string')localStorage.setItem('calendar',chosen.calendar.trim().slice(0,2000));
  var linkChanged=calendarLink()!==linkBefore;
  if(linkChanged){localStorage.setItem('events','[]');try{localStorage.removeItem('calendar-status');localStorage.removeItem('calendar-fetched');}catch(error){}}
  // The watch draws again in the new settings, with home's rise and set
  // for the new home.
  owed=false;owedTries=0;
  sendSettings();sendRiseSets();sendEvents();
  fetchCalendar(linkChanged);
});

// On launch, the settings: the watch asks for anything else it lacks.
Pebble.addEventListener('ready',function(){owed=false;owedTries=0;sendSettings();sendEvents();fetchCalendar(false);});
Pebble.addEventListener('appmessage',function(e){
  // Segments from a UTC day (days since 1970; -1: none are missing), and
  // home's rise and set or a satellite's own data; and with them what the
  // watch is owed, and its events if they have moved on.
  var from=e.payload.DataRequest;
  if(from!==undefined){
    owedTries=0;
    if(owed)payOwed();else sendEvents(true);
    if(from>=0)sendSegments(from);
    if(e.payload.DataBody)sendSatellite(e.payload.DataBody);else sendRiseSets();
  }
});
