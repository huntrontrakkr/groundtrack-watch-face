// The phone side of the native app, as bundled for the Pebble app: it must
// render the current hour's scene itself, byte for byte as the tools do, and
// send it to the watch in chunks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {buildScene} from '../tools/export-scene.mjs';
import {civilHour} from '../src/chart-render.js';
import {HOMES} from '../src/home.js';

test('the phone renders the hour and sends it to the watch',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');
    execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const now=Date.parse('2026-09-27T13:24:00Z'),zone='America/New_York';
    const stored={body:'moon',plate:'crt',flag:'1',timeZone:zone},listeners={},messages=[];
    let finished;const sent=new Promise(resolve=>{finished=resolve;});
    const context=vm.createContext({
      console:{log:()=>{}},setTimeout,
      localStorage:{getItem:k=>k in stored?stored[k]:null},
      Pebble:{
        addEventListener:(name,f)=>{listeners[name]=f;},
        // The watch takes every message; the last chunk ends the scene.
        sendAppMessage:(message,ok)=>{
          if(message.SceneTotal===undefined&&message.SceneChunk===undefined){setTimeout(ok,0);return;}
          messages.push(message);
          const total=messages[0].SceneTotal,got=messages.slice(1).reduce((n,m)=>n+m.SceneChunk.length,0);
          if(got===total)finished();else setTimeout(ok,0);
        }
      }
    });
    vm.runInContext(`Date.now=()=>${now};`,context);
    // The SDK repackages the bundle with webpack 1, which indents every line
    // with a tab; run it as the watch app will carry it.
    vm.runInContext(readFileSync(out,'utf8').replace(/\n/g,'\n\t'),context);
    listeners.ready({});listeners.appmessage({payload:{SceneRequest:now/1000}});
    await sent;

    const total=messages[0].SceneTotal,scene=new Uint8Array(total);
    for(const m of messages.slice(1)){
      assert.ok(m.SceneChunk.length<=2000);
      scene.set(m.SceneChunk,m.SceneOffset);
    }
    const expected=buildScene({body:'moon',start:civilHour(now,zone),plate:'crt',flag:true,timeZone:zone}).scene;
    assert.equal(total,expected.length);
    assert.ok(Buffer.from(scene).equals(expected),'the phone scene differs from the exported one');
    assert.equal(new DataView(scene.buffer).getInt32(12,true),Date.parse('2026-09-27T13:00:00Z')/1000);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

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
const scenes=messages=>{
  const out=[];let scene=null;
  for(const m of messages.filter(m=>m.SceneTotal!==undefined||m.SceneChunk!==undefined)){
    if(m.SceneTotal!==undefined){scene=new Uint8Array(m.SceneTotal);out.push(scene);}
    else scene.set(m.SceneChunk,m.SceneOffset);
  }
  return out.map(s=>({hour:new DataView(s.buffer).getInt32(12,true)*1000,bytes:s}));
};

test('the phone sends the hour the watch asks for, once, and gives up on a watch that stops',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');
    execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-27T13:56:00Z'),zone='UTC',stored={timeZone:zone};

    // The watch asks for this hour twice in a row (as it starts, say): the
    // second request, arriving meanwhile, is already answered.
    let p=phone(bundle,now,stored);
    p.listeners.appmessage({payload:{SceneRequest:now/1000}});p.listeners.appmessage({payload:{SceneRequest:now/1000}});
    await p.quiet();
    assert.deepEqual(scenes(p.messages).map(s=>s.hour),[Date.parse('2026-09-27T13:00:00Z')]);

    // Near the hour's end the watch asks for the next one; asked again
    // (its transfer lost), the phone sends the same bytes without rendering.
    p.listeners.appmessage({payload:{SceneRequest:Date.parse('2026-09-27T14:00:00Z')/1000}});await p.quiet();
    p.listeners.appmessage({payload:{SceneRequest:Date.parse('2026-09-27T14:00:00Z')/1000}});await p.quiet();
    const sent=scenes(p.messages);
    assert.deepEqual(sent.map(s=>s.hour),[13,14,14].map(h=>Date.parse(`2026-09-27T${h}:00:00Z`)));
    assert.ok(Buffer.from(sent[1].bytes).equals(buildScene({body:'sun',start:Date.parse('2026-09-27T14:00:00Z'),plate:'enroute',flag:true,timeZone:zone,home:HOMES[zone]}).scene));
    assert.ok(Buffer.from(sent[2].bytes).equals(sent[1].bytes));
    assert.equal(p.logs.filter(l=>/rendered/.test(l)).length,2);

    // A watch that stops taking messages: a few tries, then silence.
    let taken=0;p=phone(bundle,now,stored,()=>++taken<=3);
    p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.ok(p.messages.length<=3+6,`${p.messages.length} messages`);
    assert.ok(p.logs.includes('The watch is not taking the scene'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// GPS BIIF-1 (NAVSTAR 65, USA 213) as CelesTrak gave it on 29 September 2026.
const GPS_LIVE=`NAVSTAR 65 (USA 213)    
1 36585U 10022A   26271.40622219  .00000028  00000+0  00000+0 0  9994
2 36585  54.2565 204.4065 0116452  55.9654 123.9173  2.00610603119667
`;
test('the phone fetches live elements, keeps them two hours, and falls back to the nominal orbit',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');
    execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-29T22:30:00Z'),zone='UTC';
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
    const start=Date.parse('2026-09-29T22:00:00Z'),options={body:'sat:36585',start,plate:'enroute',flag:true,timeZone:zone,home:HOMES[zone]};
    // Offline, with nothing kept: the nominal orbit, and no second try for
    // fifteen minutes.
    const nominal=buildScene(options).scene;
    const stored={body:'sat:36585',timeZone:zone};
    let p=run(stored,()=>null);p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.equal(p.requests.length,1);
    assert.ok(Buffer.from(scenes(p.messages)[0].bytes).equals(nominal),'offline, the phone should draw the nominal orbit');
    p=run(stored,()=>({status:200,text:GPS_LIVE}));p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.equal(p.requests.length,0,'a failed request was repeated within fifteen minutes');
    // Online: CelesTrak's elements, kept for two hours.
    delete stored['tle-tried-36585'];
    p=run(stored,()=>({status:200,text:GPS_LIVE}));p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.deepEqual(p.requests,['https://celestrak.org/NORAD/elements/gp.php?CATNR=36585&FORMAT=TLE']);
    const {registerElements}=await import('../src/satellites.js');registerElements(GPS_LIVE,'celestrak');
    const live=buildScene(options).scene;
    assert.ok(!live.equals(nominal));
    assert.ok(Buffer.from(scenes(p.messages)[0].bytes).equals(live),'the phone scene should use the live elements');
    assert.equal(JSON.parse(stored['tle-36585']).fetched,now);
    p=run(stored,()=>{throw new Error('no request expected');});p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.equal(p.requests.length,0);assert.ok(Buffer.from(scenes(p.messages)[0].bytes).equals(live));
    // A view the watch can't draw yet (QZSS's day): the watch is told, not
    // left waiting.
    p=run({body:'sat:42738',timeZone:zone},()=>null);p.listeners.appmessage({payload:{SceneRequest:now/1000}});await p.quiet();
    assert.equal(JSON.stringify(p.messages),JSON.stringify([{SceneStatus:'VIEW NOT YET ON WATCH'}]));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the phone gives the watch its settings, the Sun and Moon ahead, and home\'s rise and set',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-pkjs-'));
  try{
    const out=join(dir,'index.js');
    execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
    const bundle=readFileSync(out,'utf8').replace(/\n/g,'\n\t'),now=Date.parse('2026-09-29T22:30:00Z'),zone='America/New_York';
    const p=phone(bundle,now,{body:'moon',plate:'crt',flag:'0',timeZone:zone});
    // On launch, the settings: Moon, Green CRT, no flag, 24-hour, New York.
    p.listeners.ready({});await p.quiet();
    assert.equal(JSON.stringify(p.messages),JSON.stringify([{Settings:[1,5,0,1,1,4071&255,4071>>8,0,0,(-7401)&255,((-7401)>>8)&255,255,255,0,0,0,0,0,0,0,0]}]));
    // A satellite: its catalog number, kind (a station, on the world band)
    // and code.
    const q=phone(bundle,now,{body:'sat:25544',plate:'crt',flag:'0',timeZone:zone});q.listeners.ready({});await q.quiet();
    assert.equal(JSON.stringify(q.messages[0].Settings.slice(13)),JSON.stringify([25544&255,25544>>8,0,0,1|1<<1,...'ISS'].map(v=>typeof v==='string'?v.charCodeAt(0):v)));
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
