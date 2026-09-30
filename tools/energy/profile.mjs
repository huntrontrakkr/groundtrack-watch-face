// Which of the app's functions a measured window's instructions went to:
// reads a trace directory as count.mjs does, finds where the app was loaded
// by matching the traced code against the app's ELF, and sums each executed
// block into the function holding it (from the ELF's symbols).
//
//   node tools/energy/profile.mjs <trace dir> <window kind, e.g. minute> [app.elf]
import {readdirSync,createReadStream,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {thumbCount} from './count.mjs';

const [dir,kind='minute',elf='native/build/emery/pebble-app.elf']=process.argv.slice(2);
const inApp=pc=>pc>=0x20000000&&pc<0x30000000;
const tool=name=>execFileSync('sh',['-c',`find ~/.local/share/pebble-sdk -name arm-none-eabi-${name} | head -1`]).toString().trim();

// The app's code and symbols.
const textFile=join(tmpdir(),`profile-${process.pid}.bin`);execFileSync(tool('objcopy'),['-O','binary','--only-section=.text',elf,textFile]);
const text=readFileSync(textFile);rmSync(textFile);
const textAt=parseInt(execFileSync(tool('objdump'),['-h',elf]).toString().split('\n').find(l=>/\s\.text\s/.test(l)).trim().split(/\s+/)[3],16);
const symbols=execFileSync(tool('nm'),['-S','--defined-only',elf]).toString().trim().split('\n').map(l=>l.split(/\s+/)).filter(p=>p.length===4&&/[tTwW]/.test(p[2])).map(([a,s,,n])=>({at:parseInt(a,16)&~1,size:parseInt(s,16),name:n})).sort((a,b)=>a.at-b.at);

// Blocks: their code (for placing the app) and executions in the windows.
const hexes=new Map(),runs=new Map();
for(const file of readdirSync(dir).filter(f=>/^\d{4}-.*\.log$/.test(f)).sort()){
  const counting=new RegExp(`^\\d{4}-window-.*~${kind}-\\d+\\.log$`).test(file);
  let pc=null,hex='';const close=()=>{if(pc!==null&&hex&&!hexes.has(pc))hexes.set(pc,hex);pc=null;hex='';};
  let inBlock=false;
  for await(const line of createInterface({input:createReadStream(join(dir,file)),crlfDelay:Infinity})){
    if(line.startsWith('Trace ')){
      close();inBlock=false;if(!counting)continue;
      const m=/\[[0-9a-f]+\/([0-9a-f]+)\/[0-9a-f]+\/[0-9a-f]+\]/.exec(line);if(m){const at=parseInt(m[1],16);if(inApp(at))runs.set(at,(runs.get(at)||0)+1);}
      continue;
    }
    if(line.startsWith('IN:')){close();inBlock=true;continue;}
    if(!inBlock)continue;
    if(line.startsWith('OBJD-T:')){hex+=line.slice(7).replace(/\s+/g,'');continue;}
    const m=/^0x([0-9a-f]+):\s*(.*)$/.exec(line);
    if(m){if(pc===null)pc=parseInt(m[1],16);const rest=m[2].trim();if(rest.startsWith('OBJD-T:'))hex+=rest.slice(7).replace(/\s+/g,'');}
  }
  close();
}
// The load address: where a long block's bytes sit in the app's code.
const [probe,probeHex]=[...hexes].filter(([at])=>inApp(at)).sort((a,b)=>b[1].length-a[1].length)[0];
const found=text.indexOf(Buffer.from(probeHex,'hex'));
if(found<0)throw new Error('The traced code is not this app build');
const base=probe-(textAt+found);
// Each executed block into its function.
const by=new Map();let total=0;
for(const [at,n] of runs){
  const hex=hexes.get(at);if(!hex)continue;
  const count=thumbCount(hex)*n,rel=at-base;total+=count;
  let lo=0,hi=symbols.length-1,sym=null;
  while(lo<=hi){const mid=(lo+hi)>>1;if(symbols[mid].at<=rel){sym=symbols[mid];lo=mid+1;}else hi=mid-1;}
  const name=sym&&rel<sym.at+Math.max(sym.size,1)?sym.name:'?';
  by.set(name,(by.get(name)||0)+count);
}
const windows=readdirSync(dir).filter(f=>new RegExp(`~${kind}-\\d+\\.log$`).test(f)).length||1;
console.log(`App instructions per ${kind} window: ${Math.round(total/windows).toLocaleString()}`);
for(const [name,n] of [...by].sort((a,b)=>b[1]-a[1]).slice(0,25))console.log(`${String(Math.round(n/windows).toLocaleString()).padStart(14)}  ${(100*n/total).toFixed(1).padStart(5)}%  ${name}`);
