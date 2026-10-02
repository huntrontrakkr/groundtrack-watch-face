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

// A phone side with a stand-in watch: take(message) decides whether the
// watch takes each message. Returns the phone's listeners and every message
// it tried to send, and waits for it to fall quiet.
function phone(bundle,now,stored,take=()=>true){
  const listeners={},messages=[],logs=[];let pending=0;
  const context=vm.createContext({
    console:{log:m=>logs.push(m)},
    setTimeout:(f,ms)=>{pending++;setTimeout(()=>{pending--;f();},Math.min(ms,5));},
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
        setTimeout:(f,ms)=>{pending++;setTimeout(()=>{pending--;f();},Math.min(ms,5));},
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
    delete stored['tle-tried-36585'];
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
    assert.ok(p.messages.some(m=>m.Status==='NO ELEMENTS'));
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
    assert.equal(JSON.stringify(p.messages),JSON.stringify([{Settings:[1,5,0,1,1,4071&255,4071>>8,0,0,(-7401)&255,((-7401)>>8)&255,255,255,0,0,0,0,0,0,0,0,2,0,0,0,2,0]},{Events:[0]}]));
    // The browser's other options, as set: a time callout in Departure Mono,
    // the 12-hour clock, the nautical zone; QZSS on the hour chart.
    const r=phone(bundle,now,{body:'sat:42738',plate:'crt',readout:'callout',numerals:'mono',clock24:'0',margin:'body',span:'hour',timeZone:zone});r.listeners.ready({});await r.quiet();
    const set=r.messages[0].Settings;
    assert.equal(JSON.stringify([set[2],set[3],set[17]>>1,set[21],set[22]]),JSON.stringify([2,0,0,3,1]));
    // Events: the next twenty from two hours ago, each its time and name.
    const events=JSON.stringify([{epoch:now-3*3600000,title:'Old',label:'OLDDD'},{epoch:now+3600000,title:'Run',label:'RUNNN'},{epoch:now+5*86400000,title:'Far',label:'FARRR'}]);
    const pe=phone(bundle,now,{body:'sun',timeZone:zone,events});pe.listeners.ready({});await pe.quiet();
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
      if(stored.body==='sat:43013'){assert.ok(!b.messages.some(m=>m.SatSegments));assert.equal(b.messages.find(m=>m.Status)?.Status,'NO ELEMENTS');}
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
      const set=p.messages.find(m=>m.Settings).Settings;assert.equal(set.length,27);assert.equal(set[24],code);
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
    const config=JSON.parse(/var config=(\{.*?\}),s=config/s.exec(decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length)))?.[1]??'null');
    assert.equal(config.face,'enroute');
    // An event's title may spell the page's own marks, or close its script.
    let marked=null;const stored={events:JSON.stringify([{epoch:now+3600000,title:'__PREVIEW__ __CONFIG__ </script>\u2028',label:'PREVW'}])};
    const c2=vm.createContext({console:{log:()=>{}},setTimeout,navigator:{},localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:()=>{}},
      Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{marked=u;},sendAppMessage:(m,ok)=>setTimeout(ok,0)}});
    vm.runInContext(`Date.now=()=>${now};`,c2);vm.runInContext(bundle,c2);
    listeners.showConfiguration({});for(let i=0;i<300&&!marked;i++)await new Promise(r=>setTimeout(r,20));
    const html=decodeURIComponent(marked.slice('data:text/html;charset=utf-8,'.length)),script=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.ok(!script.includes('var PV=__PREVIEW__')&&!script.includes('config=__CONFIG__'),'both marks are filled');
    assert.doesNotThrow(()=>new vm.Script(script),'the page\'s script parses');
    assert.equal(JSON.parse(/var config=(\{.*?\}),s=config/s.exec(html)[1]).events[0].title,'__PREVIEW__ __CONFIG__ </script>\u2028');
    assert.deepEqual(config.bodies.map(b=>b[0]).sort(),['sat:20580','sat:25544','sat:36585','sat:42738','sat:43013','sat:48274','sat:49260']);
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
    const config=JSON.parse(/var config=(\{.*?\}),s=config/s.exec(decodeURIComponent(opened.slice('data:text/html;charset=utf-8,'.length)))?.[1]??'null');
    assert.equal(config.face,'fuller');
    assert.deepEqual(config.bodies.map(b=>b[0]),['sat:25544','sat:48274','sat:20580','sat:49260','sat:43013','sat:36585','sat:42738']);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
