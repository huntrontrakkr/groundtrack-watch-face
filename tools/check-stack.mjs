// The watch's stack is 2 KB (less a 32-byte guard), and the system's own
// calls run on it too: no function of the watch's may keep much on it.
// Compiles each source for each app with the SDK's compiler and
// -fstack-usage, and fails if any frame is over the budget. (The frames are
// a guard against a large local creeping back; what the stack really
// reaches is in the app's log, "S<N>/2016", from the emulator.)
//   node tools/check-stack.mjs [budget=640]
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,readdirSync,readFileSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';

const BUDGET=Number(process.argv[2])||640;
// Drawn for the study and the tests only: never called on the watch.
const HOST_ONLY=new Set(['enr_text_box','enr_measure','enr_zone','enr_class','enr_text_width']);
function compiler(){
  for(const root of [join(homedir(),'.local/share/pebble-sdk/SDKs'),join(homedir(),'.pebble-sdk/SDKs'),join(homedir(),'Library/Application Support/Pebble SDK/SDKs')]){
    if(!existsSync(root))continue;
    for(const sdk of readdirSync(root)){const gcc=join(root,sdk,'toolchain/arm-none-eabi/bin/arm-none-eabi-gcc');if(existsSync(gcc))return gcc;}
  }
  try{execFileSync('arm-none-eabi-gcc',['--version'],{stdio:'pipe'});return 'arm-none-eabi-gcc';}catch{return null;}
}
const gcc=compiler();
if(!gcc){console.log('No arm-none-eabi-gcc found: the stack frames were not checked.');process.exit(process.env.CI?1:0);}
const dir=mkdtempSync(join(tmpdir(),'groundtrack-stack-')),src='native/src/c';let bad=false;
try{
  for(const face of ['ENROUTE','FULLER']){
    const frames=[];
    for(const file of readdirSync(src).filter(f=>f.endsWith('.c'))){
      const out=join(dir,`${face}-${file}.o`);
      execFileSync(gcc,['-std=gnu11','-Os','-w','-mcpu=cortex-m4','-mthumb',`-DFACE_${face}`,'-DPBL_SDK_3','-Inative/host/stub','-fstack-usage','-c',join(src,file),'-o',out],{stdio:'pipe'});
      for(const line of readFileSync(out.replace(/\.o$/,'.su'),'utf8').trim().split('\n')){
        const [where,bytes]=line.split('\t'),name=where.split(':')[3];
        if(!HOST_ONLY.has(name))frames.push([Number(bytes),`${file}:${name}`]);
      }
    }
    frames.sort((a,b)=>b[0]-a[0]);
    console.log(`${face.toLowerCase()}: largest frames ${frames.slice(0,5).map(([n,f])=>`${f} ${n}`).join(', ')}`);
    for(const [n,f] of frames)if(n>BUDGET){bad=true;console.log(`  ${f} keeps ${n} bytes on the stack — over the ${BUDGET}-byte budget`);}
  }
}finally{rmSync(dir,{recursive:true,force:true});}
process.exit(bad?1:0);
