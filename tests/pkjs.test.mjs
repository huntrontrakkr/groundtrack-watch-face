// The phone side of the native app, as bundled for the Pebble app: it gives
// the watch its settings and the Sun, Moon and satellites' segments ahead,
// through one queue, and gives up on a watch that stops taking them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {HOMES} from '../src/home.js';
import {CATALOG} from '../src/satellites.js';

// (The phone's waits pass a thousand times as fast, in their order; one of
// an hour or more, the calendar's next reading, never comes.)
// A phone side with a stand-in watch: take(message) decides whether the
// watch takes each message. Returns the phone's listeners and every message
// it tried to send, and waits for it to fall quiet.
function phone(bundle,now,stored,take=()=>true){
  const listeners={},messages=[],logs=[];let pending=0;
  const context=vm.createContext({
    console:{log:m=>logs.push(m)},
    setTimeout:(f,ms)=>{if(ms>=3600000)return 0;pending++;setTimeout(()=>{pending--;f();},Math.min(ms/1000,50));return 1;},clearTimeout:()=>{},
    localStorage:{getItem:k=>k in stored?stored[k]:null},
    Pebble:{
      addEventListener:(name,f)=>{listeners[name]=f;},
      sendAppMessage:(message,ok,fail)=>{messages.push(message);const taken=take(message);pending++;setTimeout(()=>{pending--;(taken?ok:fail)();},0);}
    }
  });
  vm.runInContext(`Date.now=()=>${now};`,context);
  vm.runInContext(bundle,context);
  const quiet=async()=>{for(let idle=0;idle<3;){await new Promise(r=>setTimeout(r,20));idle=pending?0:idle+1;}};
  return {listeners,messages,logs,quiet};
}
const bundled=dir=>{const out=join(dir,'index.js');execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});return readFileSync(out,'utf8').replace(/\n/g,'\n\t');};

test('the phone gives up on a watch that stops taking messages',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const bundle=bundled(dir),now=Date.parse('2026-09-27T13:56:00Z');
    let taken=0;const p=phone(bundle,now,{timeZone:'UTC'},()=>++taken<=3);
    p.listeners.appmessage({payload:{DataRequest:Math.floor(now/86400000)}});await p.quiet();
    assert.ok(p.messages.length<=3+6,`${p.messages.length} messages`);
    assert.ok(p.logs.includes('The watch is not taking a message'));
    // Settings the watch didn't take are owed: tried again a few times, not
    // for ever, and sent with the next thing the watch asks for.
    let reach=false;const q=phone(bundle,now,{timeZone:'UTC',body:'moon'},()=>reach);
    q.listeners.ready({});await q.quiet();
    const tried=q.messages.filter(m=>m.Settings).length;
    assert.ok(tried>=6&&tried<=6*10,`${tried} tries of the settings`);
    reach=true;q.messages.length=0;
    q.listeners.appmessage({payload:{DataRequest:-1}});await q.quiet();
    assert.equal(q.messages.filter(m=>m.Settings).length,1);assert.equal(q.messages.filter(m=>m.Events).length,1);
    q.messages.length=0;q.listeners.appmessage({payload:{DataRequest:-1}});await q.quiet();
    assert.equal(q.messages.filter(m=>m.Settings||m.Events).length,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// GPS BIIF-1 (NAVSTAR 65, USA 213) as CelesTrak gave it on 29 September 2026.
const GPS_LIVE=`NAVSTAR 65 (USA 213)
1 36585U 10022A   26271.40622219  .00000028  00000+0  00000+0 0  9994
2 36585  54.2565 204.4065 0116452  55.9654 123.9173  2.00610603119667
`;
test('the phone fetches live elements, keeps them two hours, falls back to the nominal orbit, and sends the segments',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const bundle=bundled(dir),now=Date.parse('2026-09-29T22:30:00Z'),zone='UTC',today=Math.floor(now/86400000);
    // A stand-in for the phone's XMLHttpRequest: answers with `answer(url)`.
    const run=(stored,answer)=>{
      const requests=[],listeners={},messages=[],logs=[];let pending=0;
      class XMLHttpRequest{open(method,url){this.url=url;}send(){requests.push(this.url);pending++;setTimeout(()=>{pending--;const a=answer(this.url);if(a){this.status=a.status;this.responseText=a.text;this.onload();}else this.onerror();},1);}}
      const context=vm.createContext({console:{log:m=>logs.push(m)},XMLHttpRequest,
        setTimeout:(f,ms)=>{if(ms>=3600000)return 0;pending++;setTimeout(()=>{pending--;f();},Math.min(ms/1000,50));return 1;},clearTimeout:()=>{},
        localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);},removeItem:k=>{delete stored[k];}},
        Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},sendAppMessage:(m,ok)=>{messages.push(m);pending++;setTimeout(()=>{pending--;ok();},0);}}});
      vm.runInContext(`Date.now=()=>${now};`,context);vm.runInContext(bundle,context);
      const quiet=async()=>{for(let idle=0;idle<3;){await new Promise(r=>setTimeout(r,20));idle=pending?0:idle+1;}};
      return {requests,listeners,messages,logs,quiet};
    };
    const ask=async(p,norad)=>{p.listeners.appmessage({payload:{DataRequest:today,DataBody:norad}});await p.quiet();return p.messages.filter(m=>m.SatSegments).flatMap(m=>m.SatSegments);};
    const {registerNominal}=await import('../src/nominal.js');registerNominal();
    const {satelliteSegmentFor,encodeSatelliteSegment,SAT_SEGMENT_BYTES}=await import('../src/segments.js');
    const first=()=>[...encodeSatelliteSegment(satelliteSegmentFor('sat:36585',Math.floor((now/1000-3600)/21600)*21600*1000))];
    // Offline, with nothing kept: the nominal orbit, and no second try for
    // fifteen minutes.
    const stored={body:'sat:36585',timeZone:zone};
    let p=run(stored,()=>null);let segs=await ask(p,36585);
    assert.equal(p.requests.length,1);
    assert.deepEqual(segs.slice(0,SAT_SEGMENT_BYTES),first(),'offline, the phone should send the nominal orbit');
    p=run(stored,()=>({status:200,text:GPS_LIVE}));await ask(p,36585);
    assert.equal(p.requests.length,0,'a failed request was repeated within fifteen minutes');
    // Online: CelesTrak's elements, kept for two hours.
    delete stored['tle-tried-36585'];delete stored['tle-wait-36585'];
    p=run(stored,()=>({status:200,text:GPS_LIVE}));segs=await ask(p,36585);
    assert.deepEqual(p.requests,['https://celestrak.org/NORAD/elements/gp.php?CATNR=36585&FORMAT=TLE']);
    const {registerElements}=await import('../src/satellites.js');registerElements(GPS_LIVE,'celestrak');
    assert.deepEqual(segs.slice(0,SAT_SEGMENT_BYTES),first(),'the phone should send the live orbit');
    assert.equal(JSON.parse(stored['tle-36585']).fetched,now);
    p=run(stored,()=>{throw new Error('no request expected');});await ask(p,36585);
    assert.equal(p.requests.length,0);
    // QZSS's whole-day chart needs its day from midnight: segments from a
    // day back.
    p=run({body:'sat:42738',timeZone:zone},()=>null);segs=await ask(p,42738);
    const starts=[];for(let k=0;k<segs.length;k+=SAT_SEGMENT_BYTES)starts.push(new DataView(Uint8Array.from(segs.slice(k,k+8)).buffer).getInt32(4,true));
    assert.ok(Math.min(...starts)<=now/1000-26*3600+21600,'no segment from a day back');
    // A fast satellite with no elements at all: the watch is told.
    p=run({body:'sat:25544',timeZone:zone},()=>null);await ask(p,25544);
    assert.ok(p.messages.some(m=>m.Status==='NO ELEMENTS: NET'));
    // The watch asks twice as it starts, the second time while the first
    // request is still out: one request, no word of failure, the orbit once.
    const ISS=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').split('\n').slice(0,3).join('\n')+'\n';
    p=run({body:'sat:25544',timeZone:zone},()=>({status:200,text:ISS}));
    p.listeners.appmessage({payload:{DataRequest:today,DataBody:25544}});p.listeners.appmessage({payload:{DataRequest:-1,DataBody:25544}});await p.quiet();
    assert.equal(p.requests.length,1);
    assert.ok(!p.messages.some(m=>m.Status),'a failure was reported while the request was out');
    assert.equal(p.messages.filter(m=>m.SatSegments).flatMap(m=>m.SatSegments).length%SAT_SEGMENT_BYTES,0);
    assert.equal(p.messages.filter(m=>m.SatSegments).length,7,'the orbit was sent more than once');
    // CelesTrak answering badly: the watch is told how, and once it answers
    // well again (the phone asks by itself when the wait is over) the orbit
    // follows unasked.
    let good=false;const flaky={body:'sat:25544',timeZone:zone};
    p=run(flaky,()=>good?({status:200,text:ISS}):({status:503,text:''}));
    p.listeners.appmessage({payload:{DataRequest:-1,DataBody:25544}});await p.quiet();
    assert.ok(p.messages.some(m=>m.Status==='NO ELEMENTS: HTTP 503'));
    assert.ok(!p.messages.some(m=>m.SatSegments));
    good=true;delete flaky['tle-tried-25544'];
    p=run(flaky,()=>({status:200,text:'not an element set'}));
    p.listeners.appmessage({payload:{DataRequest:-1,DataBody:25544}});await p.quiet();
    assert.ok(p.messages.some(m=>m.Status==='NO ELEMENTS: DATA'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the phone gives the watch its settings, the Sun and Moon ahead, and home\'s rise and set',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');
    execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-29T22:30:00Z'),zone='America/New_York';
    const p=phone(bundle,now,{body:'moon',plate:'crt',flag:'0',timeZone:zone});
    // On launch, the settings: Moon, Green CRT, no flag, 24-hour, New York;
    // the callout's figures outlined (the browser's default), Zulu.
    p.listeners.ready({});await p.quiet();
    assert.equal(JSON.stringify(p.messages),JSON.stringify([{Settings:[1,5,0,1,1,4071&255,4071>>8,0,0,(-7401)&255,((-7401)>>8)&255,255,255,0,0,0,0,0,0,0,0,2,0,0,0,2,0,0,0,0,0,...Array(8).fill(0)]},{Events:[0]}]));
    // The browser's other options, as set: a time callout in Departure Mono,
    // the 12-hour clock, the nautical zone; QZSS on the hour chart.
    const r=phone(bundle,now,{body:'sat:42738',plate:'crt',readout:'callout',numerals:'mono',clock24:'0',margin:'body',span:'hour',timeZone:zone});r.listeners.ready({});await r.quiet();
    const set=r.messages[0].Settings;
    assert.equal(JSON.stringify([set[2],set[3],set[17]>>1,set[21],set[22]]),JSON.stringify([2,0,0,3,1]));
    // Events: the next twenty from two hours ago, each its time and name.
    const events=JSON.stringify([{epoch:now-3*3600000,title:'Old',label:'OLDDD'},{epoch:now+3600000,title:'Run',label:'RUNNN'},{epoch:now+5*86400000,title:'Far',label:'FARRR'}]);
    // (They are a calendar's, read a moment ago: without its link there are none.)
    const pe=phone(bundle,now,{body:'sun',timeZone:zone,events,calendar:'https://calendar.example/private/basic.ics','calendar-fetched':String(now)});pe.listeners.ready({});await pe.quiet();
    {const none=phone(bundle,now,{body:'sun',timeZone:zone,events});none.listeners.ready({});await none.quiet();
    assert.equal(JSON.stringify(none.messages.find(m=>m.Events).Events),'[0]','events were sent with no calendar linked');}
    const ebytes=pe.messages.find(m=>m.Events).Events,et=(now+3600000)/1000,ft=(now+5*86400000)/1000;
    assert.equal(JSON.stringify(ebytes),JSON.stringify([et&255,(et>>8)&255,(et>>16)&255,(et>>>24)&255,...'RUNNN',ft&255,(ft>>8)&255,(ft>>16)&255,(ft>>>24)&255,...'FARRR'].map(v=>typeof v==='string'?v.charCodeAt(0):v)));
    // Asked for data, the phone sends the events only if they have moved on
    // (the watch draws again for them); with no day missing (-1), no
    // segments, only home's rise and set.
    pe.messages.length=0;pe.listeners.appmessage({payload:{DataRequest:-1}});await pe.quiet();
    assert.deepEqual(pe.messages.map(m=>Object.keys(m)[0]),['RiseSets']);
    // What is stored may be anything: none of it stops the settings.
    for(const stored of [{events:'"text"'},{events:'{"length":2}'},{events:'[null,{"epoch":1e300,"title":"x","label":"X"},{"epoch":'+(now+60000)+',"title":"No label"}]'},{home:'{"lat":null,"lon":null}'},{home:'[1,2]'},{'tle-25544':'{"text":"nonsense","fetched":'+now+',"epoch":'+now+'}','tle-tried-25544':String(now),body:'sat:25544'},
      // (NOAA-20's kept elements are another satellite's: not used.)
      {'tle-tried-43013':String(now),'tle-43013':JSON.stringify({text:readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').split('\n').slice(0,3).join('\n')+'\n',fetched:now,epoch:now}),body:'sat:43013'}]){
      const b=phone(bundle,now,{timeZone:zone,...stored});b.listeners.ready({});await b.quiet();
      b.listeners.appmessage({payload:{DataRequest:Math.floor(now/86400000),...(stored.body?{DataBody:Number(stored.body.slice(4))}:{})}});await b.quiet();
      assert.ok(b.messages.find(m=>m.Settings),JSON.stringify(stored));
      if(stored.body==='sat:43013'){assert.ok(!b.messages.some(m=>m.SatSegments));assert.equal(b.messages.find(m=>m.Status)?.Status,'NO ELEMENTS: WAIT');}
      if(stored.home)assert.equal(b.messages.find(m=>m.Settings).Settings[5]|b.messages.find(m=>m.Settings).Settings[6]<<8,4071,'home falls back to the zone\'s');
    }
    for(const response of ['null','7','"x"','[]','%7B'])pe.listeners.webviewclosed({response});
    // A satellite: its catalog number, kind (on the hour chart) and code; the
    // ISS is taken too (on the world band), a body no face has is not.
    const q=phone(bundle,now,{body:'sat:36585',plate:'crt',flag:'0',timeZone:zone});q.listeners.ready({});await q.quiet();
    assert.equal(JSON.stringify(q.messages[0].Settings.slice(13,21)),JSON.stringify([36585&255,36585>>8,0,0,0,...'GPS'].map(v=>typeof v==='string'?v.charCodeAt(0):v)));
    const o=phone(bundle,now,{body:'sat:25544',timeZone:zone});o.listeners.ready({});await o.quiet();
    assert.equal(o.messages.find(m=>m.Settings).Settings[0],2);
    const u=phone(bundle,now,{body:'sat:99999',timeZone:zone});u.listeners.ready({});await u.quiet();
    assert.equal(u.messages.find(m=>m.Settings).Settings[0],0);
    // Asked from a day, the Sun and Moon to 45 days ahead, and home's rise
    // and set for 45 local dates.
    const today=Math.floor(now/86400000);p.messages.length=0;
    p.listeners.appmessage({payload:{DataRequest:today+2}});await p.quiet();
    const segs=p.messages.filter(m=>m.Segments).flatMap(m=>m.Segments),rise=p.messages.find(m=>m.RiseSets).RiseSets;
    assert.equal(segs.length,43*228);
    const {segmentFor,encodeSegment}=await import('../src/segments.js');
    assert.deepEqual(segs.slice(0,228),[...encodeSegment(segmentFor((today+2)*86400000)).slice(0,228)]);
    assert.equal(rise.length,45*12);
    // The first local date: 29 September, with New York's rise and set as
    // the chart's margin gives them.
    const {riseText}=await import('../src/chart-text.js');
    const u16=k=>rise[4+2*k]|rise[5+2*k]<<8,hhmm=v=>v===65535?'----':String(Math.floor(v/60)).padStart(2,'0')+String(v%60).padStart(2,'0');
    assert.equal(rise[0]|rise[1]<<8|rise[2]<<16,Date.UTC(2026,8,29)/86400000);
    assert.deepEqual([`HOM SR ${hhmm(u16(0))}`,`SS ${hhmm(u16(1))}`],riseText('sun',HOMES[zone],Date.parse('2026-09-29T22:00:00Z'),zone));
    assert.deepEqual([`HOM MR ${hhmm(u16(2))}`,`MS ${hhmm(u16(3))}`],riseText('moon',HOMES[zone],Date.parse('2026-09-29T22:00:00Z'),zone));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the world band on Groundtrack: the fast satellites beside the Sun and Moon, and the band\'s options',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-29T22:30:00Z');
    // With nothing set, the Sun; the ISS, chosen, on the world band.
    {const p=phone(bundle,now,{timeZone:'UTC'});p.listeners.ready({});await p.quiet();assert.equal(p.messages.find(m=>m.Settings).Settings[0],0);}
    {const p=phone(bundle,now,{timeZone:'UTC',body:'sat:25544'});p.listeners.ready({});await p.quiet();
      const set=p.messages.find(m=>m.Settings).Settings;
      assert.equal(JSON.stringify([set[0],set[13]|set[14]<<8,set[17],String.fromCharCode(...set.slice(18,21))]),JSON.stringify([2,25544,1|1<<1,'ISS']));
    }
    // How the tape's minutes fall on the route: the settings' 25th byte.
    for(const [transfer,code] of [['vernier',1],['comb',2],['chevrons',3],['wavy',0]]){
      const p=phone(bundle,now,{timeZone:'UTC',transfer});p.listeners.ready({});await p.quiet();
      const set=p.messages.find(m=>m.Settings).Settings;assert.equal(set.length,39);assert.equal(set[24],code);
    }
    // The minute readout (byte 2): none, the flag, the time in full, or the
    // counter (this hour's figure as the time); one the phone doesn't know
    // is the flag.
    for(const [readout,value] of [['off',0],['flag',1],['callout',2],['counter',3],['big',1]]){
      const p=phone(bundle,now,{timeZone:'UTC',body:'sun',readout});p.listeners.ready({});await p.quiet();
      assert.equal(p.messages.find(m=>m.Settings).Settings[2],value,readout);
    }
    // The margins' corner: the last byte, the day of the year for one the
    // phone doesn't know.
    for(const [corner,code] of [['day',0],['point',1],['light',2],['clock',0]]){
      const p=phone(bundle,now,{timeZone:'UTC',corner});p.listeners.ready({});await p.quiet();
      const set=p.messages.find(m=>m.Settings).Settings;assert.equal(set[26],code);
    }
    // The figure set: byte 25, Michroma (the default) for one the phone
    // doesn't know.
    for(const [figures,code] of [['jost',0],['b612',1],['orbitron',3],['comic',2]]){
      const p=phone(bundle,now,{timeZone:'UTC',figures});p.listeners.ready({});await p.quiet();
      const set=p.messages.find(m=>m.Settings).Settings;assert.equal(set[25],code);
    }
    // The settings page: every satellite (the Sun and Moon are its own rows).
    let opened=null;const listeners={};
    const context=vm.createContext({console:{log:()=>{}},setTimeout,navigator:{},localStorage:{getItem:()=>null,setItem:()=>{}},
      Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{opened=u;},sendAppMessage:(m,ok)=>setTimeout(ok,0)}});
    vm.runInContext(`Date.now=()=>${now};`,context);vm.runInContext(bundle,context);
    listeners.showConfiguration({});for(let i=0;i<300&&!opened;i++)await new Promise(r=>setTimeout(r,20));
    const config=JSON.parse(/var config=(\{.*?\}),form=document/s.exec(decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length)))?.[1]??'null');
    assert.equal(config.face,'enroute');
    // An event's title (a calendar's, so anyone's) may spell the page's own
    // marks, or close its script.
    let marked=null;const stored={calendar:'https://calendar.example/private/basic.ics','calendar-fetched':String(now),events:JSON.stringify([{epoch:now+3600000,title:'__PREVIEW__ __CONFIG__ </script>\u2028',label:'PREVW'}])};
    const c2=vm.createContext({console:{log:()=>{}},setTimeout,navigator:{},localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:()=>{}},
      Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{marked=u;},sendAppMessage:(m,ok)=>setTimeout(ok,0)}});
    vm.runInContext(`Date.now=()=>${now};`,c2);vm.runInContext(bundle,c2);
    listeners.showConfiguration({});for(let i=0;i<300&&!marked;i++)await new Promise(r=>setTimeout(r,20));
    const html=decodeURIComponent(marked.slice('data:text/html;charset=utf-8,'.length)),script=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!script.includes('var PV=__PREVIEW__')&&!script.includes('config=__CONFIG__'),'both marks are filled');
    assert.doesNotThrow(()=>new vm.Script(script),'the page\'s script parses');
    assert.equal(JSON.parse(/var config=(\{.*?\}),form=document/s.exec(html)[1]).events[0].title,'__PREVIEW__ __CONFIG__ </script>\u2028');
    // (Each with the chart its body has: the settings page's rules go by it.)
    // (Each with its own chart, its group and what the Plotboard shows of it.)
    assert.deepEqual(config.bodies.map(b=>b[0]),['sun','moon',...CATALOG.map(c=>'sat:'+c.norad)]);
    const about=Object.fromEntries(config.bodies.map(b=>[b[0],[b[3],b[5],b[6]]]));
    assert.deepEqual([about.sun,about.moon,about['sat:25544'],about['sat:43013'],about['sat:36585'],about['sat:42738'],about['sat:40296']],
      [['hour','','day'],['hour','','day'],['world','stations','hour'],['world','weather','hour'],['hour','navigation','day'],['day','navigation','day'],['hour','curios','hour']]);
    assert.deepEqual([config.groups.length,config.sats,config.settings.face,config.settings.also,config.elementsUrl],[8,[],'enroute',[],'https://celestrak.org/NORAD/elements/gp.php']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a calendar\'s link: read on starting and saving, its week\'s events kept and sent; none without one',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const bundle=bundled(dir),now=Date.parse('2026-10-05T12:00:00Z');
    const ICS=['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:1','DTSTART:20261005T133000Z','SUMMARY:Launch','END:VEVENT',
      'BEGIN:VEVENT','UID:2','DTSTART;TZID=America/New_York:20260302T091500','RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR','SUMMARY:Standup','END:VEVENT',
      'BEGIN:VEVENT','UID:3','DTSTART;VALUE=DATE:20261006','SUMMARY:Holiday','END:VEVENT','END:VCALENDAR'].join('\r\n');
    const run=(stored,answer)=>{
      const requests=[],listeners={},messages=[];let pending=0;
      class XMLHttpRequest{open(method,url){this.url=url;}send(){requests.push(this.url);pending++;setTimeout(()=>{pending--;const a=answer(this.url);if(a){this.status=a.status;this.responseText=a.text;this.onload();}else this.onerror();},1);}}
      const context=vm.createContext({console:{log:()=>{}},XMLHttpRequest,clearTimeout:()=>{},
        setTimeout:(f,ms)=>{if(ms>=3600000)return 0;pending++;setTimeout(()=>{pending--;f();},Math.min(ms/1000,50));return 1;},
        localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);},removeItem:k=>{delete stored[k];}},
        Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},sendAppMessage:(m,ok)=>{messages.push(m);pending++;setTimeout(()=>{pending--;ok();},0);}}});
      vm.runInContext(`Date.now=()=>${now};`,context);vm.runInContext(bundle,context);
      const quiet=async()=>{for(let idle=0;idle<3;){await new Promise(r=>setTimeout(r,20));idle=pending?0:idle+1;}};
      return {requests,listeners,messages,quiet};
    };
    const names=m=>{const b=m.Events,out=[];for(let k=0;k+9<=b.length;k+=9)out.push(String.fromCharCode(...b.slice(k+4,k+9)));return out;};
    // No link (as the settings start): nothing is fetched, no events go.
    const stored={timeZone:'UTC'};
    let p=run(stored,()=>{throw new Error('no request expected');});p.listeners.ready({});await p.quiet();
    assert.equal(p.requests.length,0);
    assert.equal(JSON.stringify(p.messages.filter(m=>m.Events).map(m=>m.Events)),'[[0]]');
    // A link saved (webcal: is https:): read at once; the week's timed
    // events, the weekday standup's five among them, are kept with their
    // five-letter names and the next twenty sent; the all-day one is not.
    p=run(stored,url=>({status:200,text:ICS}));
    p.listeners.webviewclosed({response:JSON.stringify({calendar:'webcal://calendar.example/private/basic.ics'})});await p.quiet();
    assert.deepEqual(p.requests,['https://calendar.example/private/basic.ics']);
    const kept=JSON.parse(stored.events);
    assert.deepEqual(kept.map(e=>`${new Date(e.epoch).toISOString().slice(5,16)} ${e.title} ${e.label}`),
      ['10-05T13:15 Standup STAND','10-05T13:30 Launch LANCH','10-06T13:15 Standup STAND','10-07T13:15 Standup STAND','10-08T13:15 Standup STAND','10-09T13:15 Standup STAND','10-12T13:15 Standup STAND']);
    assert.equal(stored['calendar-status'],'7 events in the next week');
    assert.deepEqual(names(p.messages.filter(m=>m.Events).pop()),['STAND','LANCH','STAND','STAND','STAND','STAND','STAND']);
    // Started again within three hours: not fetched again, the kept events sent.
    p=run(stored,()=>{throw new Error('no request expected');});p.listeners.ready({});await p.quiet();
    assert.equal(p.requests.length,0);
    assert.equal(names(p.messages.find(m=>m.Events)).length,7);
    // Three hours on, the link out of reach: the events stay, the page is told.
    stored['calendar-fetched']=String(now-4*3600000);
    p=run(stored,()=>null);p.listeners.ready({});await p.quiet();
    assert.equal(p.requests.length,1);
    assert.equal(stored['calendar-status'],'The link could not be reached');
    assert.equal(JSON.parse(stored.events).length,7);
    // An answer that is no calendar (a sign-in page, say).
    stored['calendar-fetched']=String(now-4*3600000);
    p=run(stored,()=>({status:200,text:'<html>Sign in</html>'}));p.listeners.ready({});await p.quiet();
    assert.equal(stored['calendar-status'],'The link gave no calendar');
    // The link taken away: its events go, from the phone and the watch.
    p=run(stored,()=>{throw new Error('no request expected');});
    p.listeners.webviewclosed({response:JSON.stringify({calendar:''})});await p.quiet();
    assert.equal(stored.events,'[]');assert.equal(stored['calendar-status'],undefined);
    assert.equal(JSON.stringify(p.messages.filter(m=>m.Events).pop().Events),'[0]');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Groundtrack Fuller\'s phone side: every body, each satellite\'s hour a Fuller sheet',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');execFileSync(process.execPath,['tools/build-pkjs.mjs','--face','fuller',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-29T22:30:00Z');
    // With nothing set, the ISS's hour, as the watch starts; NOAA-20's hour
    // too (view 0), QZSS's day (view 2) unless its hour is chosen, the Sun.
    for(const [stored,expect] of [[{timeZone:'UTC'},[2,25544,1]],[{timeZone:'UTC',body:'sun'},[0,0,0]],[{timeZone:'UTC',body:'sat:25544'},[2,25544,1|0<<1]],[{timeZone:'UTC',body:'sat:43013'},[2,43013,0]],
      [{timeZone:'UTC',body:'sat:42738'},[2,42738,2<<1]],[{timeZone:'UTC',body:'sat:42738',span:'hour'},[2,42738,0]]]){
      const p=phone(bundle,now,stored);p.listeners.ready({});await p.quiet();
      const set=p.messages.find(m=>m.Settings).Settings;
      assert.deepEqual([set[0],set[13]|set[14]<<8|set[15]<<16,set[17]],expect,JSON.stringify(stored));
    }
    let opened=null;const listeners={};
    const context=vm.createContext({console:{log:()=>{}},setTimeout,navigator:{},localStorage:{getItem:()=>null,setItem:()=>{}},
      Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{opened=u;},sendAppMessage:(m,ok)=>setTimeout(ok,0)}});
    vm.runInContext(`Date.now=()=>${now};`,context);vm.runInContext(bundle,context);
    listeners.showConfiguration({});for(let i=0;i<300&&!opened;i++)await new Promise(r=>setTimeout(r,20));
    const config=JSON.parse(/var config=(\{.*?\}),form=document/s.exec(decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length)))?.[1]??'null');
    assert.equal(config.face,'fuller');
    assert.deepEqual(config.bodies.map(b=>b[0]),['sun','moon',...CATALOG.map(c=>'sat:'+c.norad)]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Groundtrack\'s two faces, the Sun and Moon beside the body, and satellites from elsewhere',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const bundle=bundled(dir),now=Date.parse('2026-10-02T19:07:00Z'),today=Math.floor(now/86400000);
    const run=(stored,answer=()=>null,at=now)=>{
      const requests=[],listeners={},messages=[];let pending=0;
      class XMLHttpRequest{open(method,url){this.url=url;}send(){requests.push(this.url);pending++;setTimeout(()=>{pending--;const a=answer(this.url);if(a){this.status=200;this.responseText=a;this.onload();}else this.onerror();},1);}}
      const context=vm.createContext({console:{log:()=>{}},XMLHttpRequest,
        setTimeout:(f,ms)=>{if(ms>=3600000)return 0;pending++;setTimeout(()=>{pending--;f();},Math.min(ms/1000,50));return 1;},clearTimeout:()=>{},
        localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);},removeItem:k=>{delete stored[k];}},
        Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},sendAppMessage:(m,ok)=>{messages.push(m);pending++;setTimeout(()=>{pending--;ok();},0);}}});
      vm.runInContext(`Date.now=()=>${at};`,context);vm.runInContext(bundle,context);
      const quiet=async()=>{for(let idle=0;idle<3;){await new Promise(r=>setTimeout(r,20));idle=pending?0:idle+1;}};
      return {requests,listeners,messages,quiet,stored};
    };
    const settings=async stored=>{const p=run({timeZone:'UTC',...stored});p.listeners.ready({});await p.quiet();return p.messages.find(m=>m.Settings).Settings;};
    // The chart the watch is told (byte 17: a station's bit, and twice the
    // view): on Enroute the hour chart (0) or the whole day (2); on the
    // Plotboard the hour's run (1) of the fast, the day's (3) of the slow.
    // A fast satellite is on the Plotboard whichever face was asked for, and
    // one in an oval orbit there shows its hour.
    for(const [stored,view] of [[{body:'sun'},0],[{body:'sun',face:'plotboard'},3<<1],[{body:'moon',face:'plotboard'},3<<1],[{body:'sat:36585'},0],[{body:'sat:36585',face:'plotboard'},3<<1],
      [{body:'sat:25544',face:'enroute'},1|1<<1],[{body:'sat:43013'},1<<1],[{body:'sat:42738'},2<<1],[{body:'sat:42738',span:'hour'},0],[{body:'sat:42738',face:'plotboard',span:'hour'},3<<1],
      [{body:'sat:60133',face:'plotboard'},3<<1],[{body:'sat:60133',span:'hour'},2<<1],[{body:'sat:40296'},0],[{body:'sat:40296',face:'plotboard'},1<<1],[{body:'sat:54755',face:'plotboard'},1<<1],[{body:'sat:54755',face:'nonsense'},1<<1],[{body:'sat:40296',face:'nonsense'},0]])
      assert.equal((await settings(stored))[17],view,JSON.stringify(stored));
    // The Sun and Moon beside the body: the settings' last byte.
    for(const [also,bits] of [['sun',1],['moon',2],['sun,moon',3],['mars',0]])assert.deepEqual(Array.from(await settings({body:'sat:25544',also})).slice(27,31),[bits,0,0,0],also);
    // The vibration when the phone goes out of reach: the last byte.
    for(const [vibe,value] of [[undefined,0],['0',0],['1',1],['yes',0]])assert.equal(Array.from(await settings({body:'sun',vibe}))[30],value,String(vibe));
    // And the fuel line: shown unless turned off (bit 2).
    for(const [fuel,vibe,value] of [['0',undefined,2],['0','1',3],['1','1',1],['no',undefined,0]])assert.equal(Array.from(await settings({body:'sun',fuel,vibe}))[30],value,`${fuel} ${vibe}`);
    // The hour chart bare of its hour figures (byte 28): the time in full
    // beside the body then, whatever the readout was; other charts keep theirs.
    for(const [stored,readout,bare] of [[{body:'sun',readout:'off',hourFigures:'0'},2,1],[{body:'sun',readout:'off'},0,0],[{body:'sun',face:'plotboard',readout:'off',hourFigures:'0'},0,1],[{body:'sat:25544',readout:'flag',hourFigures:'0'},1,1]]){
      const set=await settings(stored);assert.deepEqual([set[2],set[28]],[readout,bare],JSON.stringify(stored));}
    // A satellite added on the settings page: followed by its number, under
    // the code its name gave it; one neither listed nor added is not.
    const sats=JSON.stringify([{norad:33591,name:'NOAA 19',code:'NOA',period:101.9,ecc:0},{nonsense:true}]);
    {const set=await settings({body:'sat:33591',sats});
    assert.deepEqual([set[0],set[13]|set[14]<<8|set[15]<<16,set[17],String.fromCharCode(...set.slice(18,21))],[2,33591,1<<1,'NOA']);}
    assert.equal((await settings({body:'sat:33591'}))[0],0);
    // The page's answer: the satellites added are kept (each checked), with
    // the elements the page fetched for them, which then serve for two
    // hours without CelesTrak being asked.
    const HIMAWARI=readFileSync('tests/fixtures/celestrak-name-himawari.txt','utf8').split(/\r?\n/).slice(30,33).map((l,i)=>i?l:l.trim()).join('\n')+'\n';
    assert.match(HIMAWARI,/^HIMAWARI-8\n1 40267U /);
    const p=run({timeZone:'UTC'},()=>{throw new Error('no request expected');});
    p.listeners.webviewclosed({response:JSON.stringify({body:'sat:40267',face:'plotboard',also:['moon','mars'],sats:[{norad:40267,name:'HIMAWARI-8',code:'HIM',period:1436.2,ecc:0,still:true},{norad:25544,name:'x',period:93},{norad:'x'}],
      tles:{40267:HIMAWARI,25544:HIMAWARI,99:'nonsense'}})});await p.quiet();
    assert.deepEqual([p.stored.body,p.stored.face,p.stored.also,JSON.parse(p.stored.sats)],['sat:40267','plotboard','moon',[{norad:40267,name:'HIMAWARI-8',code:'HIM',period:1436.2,ecc:0,still:true}]]);
    assert.deepEqual([JSON.parse(p.stored['tle-40267']).fetched,'tle-25544' in p.stored,'tle-99' in p.stored],[now,false,false]);
    {const set=p.messages.find(m=>m.Settings).Settings;assert.deepEqual([set[13]|set[14]<<8|set[15]<<16,set[17],String.fromCharCode(...set.slice(18,21)),set[27]],[40267,3<<1,'HIM',2]);}
    p.messages.length=0;p.listeners.appmessage({payload:{DataRequest:today,DataBody:40267}});await p.quiet();
    // (Its day on the Plotboard: six-hour segments, from a day back.)
    {const {SAT_SEGMENT_BYTES}=await import('../src/segments.js'),segs=p.messages.filter(m=>m.SatSegments).flatMap(m=>m.SatSegments),view=new DataView(Uint8Array.from(segs).buffer);
    assert.ok(segs.length>=12*SAT_SEGMENT_BYTES);
    assert.deepEqual([view.getInt32(0,true),view.getInt32(8,true)],[40267,21600]);
    assert.ok(view.getInt32(4,true)<=now/1000-24*3600);}
    assert.equal(p.requests.length,0);
    // A slow satellite with no elements to be had: the watch is told so (GPS
    // and QZSS alone have nominal orbits to fall back on).
    {const q=run({timeZone:'UTC',body:'sat:37846'});q.listeners.appmessage({payload:{DataRequest:today,DataBody:37846}});await q.quiet();
    assert.ok(q.messages.some(m=>m.Status==='NO ELEMENTS: NET'));assert.ok(!q.messages.some(m=>m.SatSegments));}
    // CelesTrak's newest elements three weeks old: they are what there is,
    // and are sent (the watch marks them EL OLD by their epoch).
    {const old=readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8').split('\n').slice(0,3).join('\n')+'\n',late=Date.parse('2026-10-20T12:00:00Z');
    const q=run({timeZone:'UTC',body:'sat:25544'},()=>old,late);q.listeners.appmessage({payload:{DataRequest:Math.floor(late/86400000),DataBody:25544}});await q.quiet();
    assert.ok(q.messages.some(m=>m.SatSegments));assert.ok(!q.messages.some(m=>m.Status));}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
