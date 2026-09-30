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
    assert.equal(JSON.stringify(p.messages),JSON.stringify([{Settings:[1,5,0,1,1,4071&255,4071>>8,0,0,(-7401)&255,((-7401)>>8)&255,255,255,0,0,0,0,0,0,0,0,2,0,0]},{Events:[0]}]));
    // The browser's other options, as set: a time callout in Departure Mono,
    // the 12-hour clock, the nautical zone; QZSS on the hour chart.
    const r=phone(bundle,now,{body:'sat:42738',plate:'crt',readout:'callout',numerals:'mono',clock24:'0',margin:'body',span:'hour',timeZone:zone});r.listeners.ready({});await r.quiet();
    const set=r.messages[0].Settings;
    assert.equal(JSON.stringify([set[2],set[3],set[17]>>1,set[21],set[22]]),JSON.stringify([2,0,0,3,1]));
    // Events: from two hours ago to four days ahead, each its time and name.
    const events=JSON.stringify([{epoch:now-3*3600000,title:'Old',label:'OLDDD'},{epoch:now+3600000,title:'Run',label:'RUNNN'},{epoch:now+5*86400000,title:'Far',label:'FARRR'}]);
    const pe=phone(bundle,now,{body:'sun',timeZone:zone,events});pe.listeners.ready({});await pe.quiet();
    const ebytes=pe.messages.find(m=>m.Events).Events,et=(now+3600000)/1000;
    assert.equal(JSON.stringify(ebytes),JSON.stringify([et&255,(et>>8)&255,(et>>16)&255,(et>>>24)&255,...'RUNNN'].map(v=>typeof v==='string'?v.charCodeAt(0):v)));
    // A satellite: its catalog number, kind (a station, on the world band)
    // and code.
    const q=phone(bundle,now,{body:'sat:25544',plate:'crt',flag:'0',timeZone:zone});q.listeners.ready({});await q.quiet();
    assert.equal(JSON.stringify(q.messages[0].Settings.slice(13,21)),JSON.stringify([25544&255,25544>>8,0,0,1|1<<1,...'ISS'].map(v=>typeof v==='string'?v.charCodeAt(0):v)));
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
    const {riseText}=await import('../src/enroute-render.js');
    const u16=k=>rise[4+2*k]|rise[5+2*k]<<8,hhmm=v=>v===65535?'----':String(Math.floor(v/60)).padStart(2,'0')+String(v%60).padStart(2,'0');
    assert.equal(rise[0]|rise[1]<<8|rise[2]<<16,Date.UTC(2026,8,29)/86400000);
    assert.deepEqual([`HOM SR ${hhmm(u16(0))}`,`SS ${hhmm(u16(1))}`],riseText('sun',HOMES[zone],Date.parse('2026-09-29T22:00:00Z'),zone));
    assert.deepEqual([`HOM MR ${hhmm(u16(2))}`,`MS ${hhmm(u16(3))}`],riseText('moon',HOMES[zone],Date.parse('2026-09-29T22:00:00Z'),zone));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
