// Records instruction counts for the installed build in the Pebble emulator,
// after Dymaxion's tools/energy/measure.mjs. The emulator must have been
// started through tools/energy/qemu-trace.sh. It opens windows, through
// QEMU's monitor, around each of these:
//   idle    nine seconds with no minute change: the background to subtract
//   minute  nine seconds across a minute change (the face's minute redraw)
//   build   ten seconds from a settings change, which makes the watch build
//           the hour's chart again, as it does at each hour
// Each build window changes the minute flag, so every one is a real change.
// Windows are named <label>~<kind>-<n>; count.mjs counts them afterwards.
// Usage: node tools/energy/measure.mjs <label> [repeats] [message_keys.json]
// MEASURE_KINDS (default idle,minute,build) picks the windows. PEBBLE names
// the pebble command (default tools/emulator.sh).
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {connect} from 'node:net';
import {fileURLToPath} from 'node:url';
import {HOMES} from '../../src/home.js';
import {PLATES} from '../../src/plates.js';
import {catalogEntry,viewOf} from '../../src/satellites.js';

const label=process.argv[2]||'build',repeats=Number(process.argv[3]||2);
const dir=resolve(process.env.QEMU_TRACE_DIR),out=resolve('test-results/energy');mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const command=process.env.PEBBLE||fileURLToPath(new URL('../emulator.sh',import.meta.url));
const pebble=(...args)=>execFileSync(command,[...args,'--emulator','emery'],{stdio:['ignore','inherit','inherit'],timeout:60000});
const info=JSON.parse(readFileSync('/tmp/pb-emulator.json','utf8')).emery,port=Object.values(info)[0].qemu.monitor;
// One command through QEMU's monitor: wait for its prompt, send, then wait for
// the prompt that follows the command's output.
const monitor=command=>new Promise((ok,fail)=>{
  const s=connect(port,'127.0.0.1');let text='',sent=false;
  const timer=setTimeout(()=>{s.destroy();fail(new Error('monitor: no reply to '+command+': '+text));},5000);
  s.on('data',d=>{
    text+=d;
    if(!sent&&text.includes('(qemu) ')){sent=true;text='';s.write(command+'\n');}
    else if(sent&&text.includes('(qemu) ')){clearTimeout(timer);s.end();ok(text);}
  });
  s.on('error',e=>{clearTimeout(timer);fail(e);});
});
let file=1+Math.max(0,...readdirSync(dir).map(f=>parseInt(f,10)).filter(Number.isFinite));const next=name=>join(dir,String(file++).padStart(4,'0')+'-'+name+'.log');
async function window(name,ms){
  await monitor('logfile '+next('window-'+label+'~'+name));await monitor('log in_asm,exec,nochain');
  await sleep(ms);
  await monitor('log in_asm,nochain');await monitor('logfile '+next('gap'));
}
// Settings as the phone packs them (native/pkjs/main.js): MEASURE_BODY (sun,
// moon or sat:<catalog number>; the Sun by default) on MEASURE_PLATE
// (Enroute), 24-hour, home New York; the minute flag as given. They must be
// the phone's own, or the phone's next settings build the hour again.
// MEASURE_FACE (enroute, plotboard, fuller) names the face installed.
const FACE=process.env.MEASURE_FACE||'enroute',PROJECT=FACE==='enroute'?'native':`native-${FACE}`;
const KEY=JSON.parse(readFileSync(process.argv[4]||`${PROJECT}/build/js/message_keys.json`,'utf8'));
const BODY=process.env.MEASURE_BODY||'sun',PLATE=Object.keys(PLATES).indexOf(process.env.MEASURE_PLATE||'enroute');
const settings=flag=>{
  const h=HOMES['America/New_York'],b=Buffer.alloc(25),sat=BODY.startsWith('sat:'),c=sat?catalogEntry(BODY):null;
  // Fuller draws a fast satellite's hour, not the world band.
  const view=v=>FACE==='fuller'&&v==='world'?'hour':v;
  b.set([BODY==='sun'?0:BODY==='moon'?1:2,PLATE,flag,1,1]);b.writeInt32LE(Math.round(h.lat*100),5);b.writeInt32LE(Math.round(h.lon*100),9);
  b.writeInt32LE(sat?Number(BODY.slice(4)):0,13);b[17]=(c?.symbol==='station'?1:0)|(sat?['hour','world','day'].indexOf(view(viewOf(BODY))):0)<<1;
  if(c)b.write(c.code,18,'latin1');
  b[21]=2;b[22]=0;b[23]=0;b[24]=0;
  return b;
};
let flag=1;
const UUID=JSON.parse(readFileSync(`${PROJECT}/package.json`,'utf8')).pebble.uuid;
const send=()=>{flag^=1;const f=join(out,`${label}-settings.bin`);writeFileSync(f,settings(flag));pebble('send-app-message','--app-uuid',UUID,'--bytes-file',`${KEY.Settings}=${f}`);};
const kinds=(process.env.MEASURE_KINDS||'idle,minute,build').split(',');
const want={idle:0,minute:0,build:0},got={idle:0,minute:0,build:0},names=[];for(const k of kinds)want[k]=repeats;
const until=async second=>{while(new Date().getSeconds()!==second)await sleep(200);};
while(Object.keys(want).some(k=>got[k]<want[k])){
  const s=new Date().getSeconds();
  if(s>=50){await sleep(12000);continue;}
  // Nine seconds from :15, clear of any minute change.
  if(got.idle<want.idle&&s<15){await until(15);const n='idle-'+(++got.idle);await window(n,9000);names.push(n);continue;}
  // Ten seconds from a settings change at :28, clear of the minute.
  if(got.build<want.build&&s<28){await until(28);send();const n='build-'+(++got.build);await window(n,10000);names.push(n);continue;}
  // Nine seconds from :56, across the minute change.
  if(got.minute<want.minute){await until(56);const n='minute-'+(++got.minute);await window(n,9000);names.push(n);continue;}
  await sleep(10000);
}
await monitor('log in_asm,nochain');
console.log(label,'windows:',names.join(' '));
