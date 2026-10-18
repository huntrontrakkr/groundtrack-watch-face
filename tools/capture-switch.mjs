// The store's GIF of a flick to the next satellite, from the emulator: the
// track list and the reacquiring are the watch app's own, not the core's,
// so they are captured, not rendered. The app is built with its animations
// slowed (GT_HUD_SLOW=SLOW, 8 unless given) so that each frame is screenshotted; the frames,
// repeats dropped, are played back at the watch's own pace (66 ms).
//
//   node tools/capture-switch.mjs <emery|gabbro> <plate> <out.gif>   (FACE=fuller: Groundtrack Fuller's)
//
// It seeds the emulator's phone (pypkjs's localStorage) with the ISS as the
// body, HST and CSS as companions and their elements from the test fixture
// (marked fetched now: CelesTrak is not asked), wipes the emulator, builds
// and installs the slowed app, flicks and screenshots for 200 seconds.
// Needs PEBBLE_QEMU_PATH as for tools/emulator.sh. Rebuild the app normally
// afterwards.
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,rmSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {encodeGIF} from './gif.mjs';

const face=process.env.FACE==='fuller'?'fuller':'enroute',appDir=face==='fuller'?'native-fuller':'native',uuid=face==='fuller'?'638c835d-73cf-4ad6-a2fa-312fe087de5d':'a0f61ba3-4580-4bf9-a71c-0a83f3d35600';
const [platform,plate,out]=process.argv.slice(2),seconds=Number(process.env.SECONDS_SHOT||150);
if(!['emery','gabbro'].includes(platform)||!plate||!out)throw new Error('usage: capture-switch.mjs <emery|gabbro> <plate> <out.gif>');
const home=process.env.HOME,sdk=join(home,'.local/share/pebble-sdk/4.33.1',platform);
const sh=(cmd,args,opts={})=>execFileSync(cmd,args,{stdio:'pipe',...opts});
// (The emulator stopped: by command name, never a pattern over arguments;
// and the tool's record of it removed, which a lingering process would keep
// alive, its ports dead.)
const stop=()=>{try{sh('sh',['-c',"ps -eo pid,comm | awk '$2 ~ /^qemu-pebble/ {print $1}' | xargs -r kill"]);}catch{}
  for(const f of readdirSync('/tmp'))if(f==='pb-emulator.json'||/^pb-qemu-pypkjs-.*\.json$/.test(f))rmSync(join('/tmp',f),{force:true});};
stop();rmSync(join(sdk,'qemu_spi_flash.bin'),{force:true});
// The phone's storage (dbm.dumb, as pypkjs keeps it).
const lines=readFileSync('tests/fixtures/celestrak-2026-10-02.tle','utf8').trim().split('\n'),tle={};
for(let i=0;i+2<lines.length;i+=3)tle[Number(lines[i+1].slice(2,7))]=lines.slice(i,i+3).join('\n')+'\n';
const now=Date.now(),kv={body:'sat:25544',extra:'sat:20580,sat:48274',plate,...(face==='enroute'?{face:'plotboard'}:{}),home:JSON.stringify({lat:40.71,lon:-74.01})};
for(const n of [25544,20580,48274])kv['tle-'+n]=JSON.stringify({text:tle[n],fetched:now,epoch:now-86400e3});
mkdirSync(join(sdk,'localstorage'),{recursive:true});
sh('python3',['-c',`import dbm.dumb,json,sys\nd=dbm.dumb.open(sys.argv[1],'c')\nfor k,v in json.loads(sys.argv[2]).items():d[k]=v\nd.close()`,join(sdk,'localstorage',uuid),JSON.stringify(kv)]);
sh('node',['tools/build-pkjs.mjs',...(face==='fuller'?['--face','fuller']:[])]);
sh('pebble',['build'],{cwd:appDir,env:{...process.env,GT_FLAGS:'-DGT_HUD_SLOW='+(process.env.SLOW||8)}});
// (A wiped emulator's first boot can outlast the installer's wait: tried
// again, three times at most.)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let app,log='';
for(let attempt=0;attempt<3&&!/built/.test(log);attempt++){
  let done=false;log='';
  app=spawn('tools/emulator.sh',['install','--emulator',platform,'--logs',`${appDir}/build/${appDir}.pbw`],{stdio:['ignore','pipe','pipe']});
  app.stdout.on('data',d=>{log+=d;});app.stderr.on('data',d=>{log+=d;});app.on('exit',()=>{done=true;});
  for(let i=0;i<150&&!/built/.test(log)&&!done;i++)await sleep(1000);
}
if(!/built/.test(log))throw new Error('the emulator built no chart:\n'+log.slice(-2000));
// (Past the hour's first scan, slowed as it is.)
await sleep(30000);
const dir='/tmp/capture-switch';rmSync(dir,{recursive:true,force:true});mkdirSync(dir);
// The screenshots over one connection (tools/emu-shots.py, in pebble-tool's
// Python), from a moment before the flick.
const toolPy=readFileSync(sh('sh',['-c','command -v pebble']).toString().trim(),'utf8').split('\n')[0].replace(/^#!\s*/,'');
const shooter=spawn(toolPy,['tools/emu-shots.py',platform,String(seconds),join(dir,'shots.rgb')],{stdio:['ignore','pipe','pipe']});
let shotLog='';shooter.stdout.on('data',d=>{shotLog+=d;});shooter.stderr.on('data',d=>{shotLog+=d;});
const shot=new Promise(r=>shooter.on('exit',r));
await sleep(3000);
sh('tools/emulator.sh',['emu-tap','--emulator',platform]);
await shot;
app.kill('SIGKILL');stop();
writeFileSync(join(dir,'app.log'),log.split('\n').filter(l=>!/token|bearer|oauth/i.test(l)).join('\n'));
const raw=readFileSync(join(dir,'shots.rgb'));
const w=platform==='gabbro'?260:200,h=platform==='gabbro'?260:228,n=Math.floor(raw.length/(w*h*3)),frames=[];
if(!n)throw new Error('no screenshots: '+shotLog);
for(let k=0;k<n;k++){const f=raw.subarray(k*w*h*3,(k+1)*w*h*3);if(!frames.length||Buffer.compare(f,frames[frames.length-1]))frames.push(Buffer.from(f));}
// (The chart a moment first, the new one a moment last.)
const delays=frames.map((_,k)=>k===0?100:k===frames.length-1?150:7);
writeFileSync(out,encodeGIF(frames,w,h,delays));
console.log(`${out}: ${frames.length} frames of ${n} screenshots (${shotLog.trim()})`);
