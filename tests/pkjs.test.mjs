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
    listeners.ready({});
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
