// The watch's own chart builder (native/src/c/chart.c) against the phone's
// (src/native-scene.js): for the same hour, settings and home, the scene it
// builds from the map pack and the Sun and Moon segments must be the same
// bytes. Skipped where no C compiler is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildScene} from '../tools/export-scene.mjs';
import {HOMES} from '../src/home.js';
import {chartInput} from '../tools/chart-input.mjs';
import {registerLiveFixture} from './tle-fixture.mjs';

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
      ['sun','2026-03-20T11:00:00Z','plotboard',false,null],
      // GPS on its nominal orbit: the slow orbit's camera, figures and
      // ticks, and home's pass line through the hour.
      ['sat:36585','2026-09-27T13:00:00Z','crt',true,'America/New_York'],
      ['sat:36585','2026-09-27T19:00:00Z','enroute',true,'UTC'],
      ['sat:36585','2026-09-28T02:00:00Z','sectional',false,'America/New_York'],
      // The world band, from CelesTrak's elements: stations and satellites,
      // polar orbits over the band's edges, home's acquisition circle
      // through the hour.
      ['sat:25544','2026-09-30T13:00:00Z','crt',true,'America/New_York'],
      ['sat:25544','2026-09-30T02:00:00Z','enroute',false,'UTC'],
      ['sat:48274','2026-10-01T06:30:00Z','hypsometric',true,'Asia/Kolkata'],
      ['sat:20580','2026-09-30T20:00:00Z','sunlight',true,'Europe/London'],
      ['sat:49260','2026-10-01T09:00:00Z','plotboard',true,'America/New_York'],
      ['sat:43013','2026-09-30T17:00:00Z','red',false,null],
      ['sat:43013','2026-10-01T22:00:00Z','sectional',true,'UTC'],
      // Runs too long for the arena's room (a dense plate on a polar band).
      ['sat:49260','2026-09-30T16:00:00Z','crt',true,'America/New_York'],
      // QZSS's whole local day on its nominal orbit: hour ticks and labels,
      // and in a half-hour zone.
      ['sat:42738','2026-09-27T05:00:00Z','crt',true,'America/New_York'],
      ['sat:42738','2026-09-27T14:00:00Z','sunlight',false,'UTC'],
      ['sat:42738','2026-09-26T20:30:00Z','hypsometric',true,'Asia/Kolkata']
    ];
    registerLiveFixture();
    // And the browser's other options: the callout in each style, the
    // nautical zone, the 12-hour clock, QZSS on the hour chart.
    const options=[{},{readout:'callout',numerals:'colon'},{readout:'callout',numerals:'mono',margin:'body'},{readout:'callout',numerals:'accent',clock24:false},
      {numerals:'plain',margin:'body'},{readout:'callout',numerals:'even'},{numerals:'mono',clock24:false}];
    cases.push(['sat:42738','2026-09-27T05:00:00Z','sectional',true,'America/New_York',{span:'hour',readout:'callout'}]);
    // The world band with the world sliding: a scene for a minute.
    cases.push(['sat:25544','2026-09-30T13:00:00Z','crt',true,'America/New_York',{tape:'slide',minute:23}],['sat:49260','2026-10-01T09:00:00Z','enroute',false,'America/New_York',{tape:'slide',minute:47}]);
    // The world band's sliding tape.
    cases.push(['sat:25544','2026-09-30T13:00:00Z','crt',true,'America/New_York',{tape:'tape'}],['sat:43013','2026-09-30T17:00:00Z','plotboard',false,'UTC',{tape:'tape',clock24:false}]);
    cases.forEach((c,k)=>{if(!c[5])c[5]=options[k%options.length];});
    for(const [body,iso,plate,flag,zone,more] of cases){
      const start=Date.parse(iso),timeZone=zone||'UTC',home=zone?HOMES[zone]||null:null,o={flag,...more};
      const {scene}=buildScene({body,start,plate,timeZone,home,...o,zone:o.margin||'utc'});
      const out=join(dir,'c.scene');
      const r=spawnSync('native/host/chart_test',['native/resources/map.pack','native/resources/figures.bin',out],{input:chartInput({body,start,plate,zone:timeZone,home,...o})});
      assert.equal(r.status,0,r.stderr.toString());
      const c=readFileSync(out);
      let first=-1;for(let i=0;i<Math.max(c.length,scene.length);i++)if(c[i]!==scene[i]){first=i;break;}
      assert.equal(first,-1,`${body} ${iso} ${plate}: first difference at byte ${first} of ${scene.length}`);
      // The build's memory at its peak, counted as the watch's heap would
      // (with this machine's larger pointers): the watch has about 71 KB.
      const peak=Number(/peak (\d+)/.exec(r.stderr.toString())[1]);
      assert.ok(peak<=69000,`${body} ${iso} ${plate}: the build peaks at ${peak} bytes`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
