// The watch's own chart builder (native/src/c/chart.c) against the phone's
// (src/native-scene.js): for the same hour, settings and home, the scene it
// builds from the map pack and the Sun and Moon segments must be the same
// bytes. Skipped where no C compiler is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildScene} from '../tools/export-scene.mjs';
import {HOMES} from '../src/home.js';
import {chartInput} from '../tools/chart-input.mjs';

let cc=true;try{execFileSync('make',['-s','-C','native/host','chart_test'],{stdio:'pipe'});}catch{cc=false;}

test('the watch builds the phone\'s scene, byte for byte',{skip:!cc&&'no C compiler'},()=>{
  const dir=mkdtempSync(join(tmpdir(),'groundtrack-chart-'));
  try{
    const cases=[
      ['sun','2026-09-27T08:00:00Z','enroute',true,'UTC'],
      ['sun','2026-06-21T13:00:00Z','sectional',true,'America/New_York'],
      ['sun','2026-12-21T22:30:00Z','hypsometric',false,'Asia/Kolkata'],
      ['sun','2027-01-31T23:00:00Z','sunlight',true,'Europe/London'],
      ['moon','2026-09-19T09:00:00Z','crt',true,'America/New_York'],
      ['moon','2026-03-10T05:00:00Z','red',false,'UTC'],
      ['moon','2025-12-06T02:30:00Z','plotboard',true,'Asia/Kolkata'],
      ['sun','2026-03-20T11:00:00Z','plotboard',false,null]
    ];
    for(const [body,iso,plate,flag,zone] of cases){
      const start=Date.parse(iso),timeZone=zone||'UTC',home=zone?HOMES[zone]||null:null;
      const {scene}=buildScene({body,start,plate,flag,timeZone,home});
      const out=join(dir,'c.scene');
      execFileSync('native/host/chart_test',['native/resources/map.pack','native/resources/figures.bin',out],{input:chartInput({body,start,plate,flag,zone:timeZone,home}),stdio:['pipe','pipe','pipe']});
      const c=readFileSync(out);
      let first=-1;for(let i=0;i<Math.max(c.length,scene.length);i++)if(c[i]!==scene[i]){first=i;break;}
      assert.equal(first,-1,`${body} ${iso} ${plate}: first difference at byte ${first} of ${scene.length}`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
