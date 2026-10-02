// Which settings change what the watch draws, for each face and body: each
// setting's values are drawn (by the core, the watch's own code) in every
// context of the readout, the time scale and QZSS's span, and compared. A setting whose
// values all draw the same frame has no effect there, and the settings page
// must not offer it (tests/settings.test.mjs holds the page's rules to this).
//   node tools/audit-settings.mjs [face] [body]     prints JSON
import {readFileSync} from 'node:fs';
import {loadCore,CoreRenderer} from '../src/core.js';
import {PLATES,FIGURE_SETS} from '../src/plates.js';
import {CATALOG,bodyId,registerElements,viewOf} from '../src/satellites.js';
import {registerNominal} from '../src/nominal.js';
import {nameCode} from '../src/events.js';

export const SETTINGS={plate:Object.keys(PLATES),figures:FIGURE_SETS.map(f=>f[0]),clock24:[true,false],readout:['off','flag','callout'],numerals:['even','accent','mono','plain','colon'],
  corner:['day','point','light'],margin:['utc','body'],tape:['fixed','tape','slide','clock','route'],transfer:['off','vernier','comb','chevrons'],span:['day','hour'],home:['set','none'],events:['none','one']};
export const BODIES=['sun','moon',...CATALOG.map(c=>bodyId(c.norad))];
// tle: element sets (three lines each) to draw the satellites from; epoch: the minute drawn.
export async function audit({faces=['enroute','fuller'],bodies=BODIES,tle,epoch,zone='Europe/Berlin',home={code:'HOM',name:'Home',lat:52.52,lon:13.4}}){
  registerNominal();
  const lines=tle.trim().split('\n');for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','celestrak');
  const read=f=>new Uint8Array(readFileSync(f));
  const core=await loadCore({wasm:read('public/core.wasm'),map:read('native/resources/map.pack'),figures:read('native/resources/figures.bin'),tables:read('native/resources/tables.bin'),grids:read('public/fuller.bin'),land:read('native/resources/land.pack')});
  const out={};
  for(const face of faces)for(const body of bodies){
    const world=face==='enroute'&&viewOf(body)==='world';
    const frame=s=>{
      const r=new CoreRenderer(core);
      r.render({body,epoch,timeZone:zone,clock24:s.clock24,plate:s.plate,readout:s.readout==='off'?false:s.readout==='callout'?true:'flag',numerals:s.numerals,zone:s.margin,span:s.span,tape:s.tape,transfer:s.transfer,figures:s.figures,corner:s.corner,
        events:s.events==='one'?[{epoch:epoch+11*60000,label:nameCode('Dinner')}]:[],home:s.home==='set'?home:null,projection:face==='fuller'?'fuller':'chart'});
      return Buffer.from(r.last.frame).toString('latin1');
    };
    const base={plate:'enroute',figures:'michroma',clock24:true,readout:'flag',numerals:'even',corner:'day',margin:'utc',tape:'fixed',transfer:'off',span:'day',home:'set',events:'none'};
    const contexts=[];for(const readout of SETTINGS.readout)for(const tape of world?SETTINGS.tape:['fixed'])for(const span of viewOf(body)==='day'?SETTINGS.span:['day'])contexts.push({readout,tape,span});
    const result={};
    for(const [key,values] of Object.entries(SETTINGS)){
      const where=[];
      for(const c of contexts){
        // (A context differing only in the setting itself is the same one.)
        if(key in c&&contexts.some(o=>o!==c&&Object.keys(c).every(k=>k===key||o[k]===c[k])&&contexts.indexOf(o)<contexts.indexOf(c)))continue;
        const frames=new Set(values.map(v=>frame({...base,...c,[key]:v})));
        // How many of its values draw something of their own, in this context.
        where.push({...Object.fromEntries(Object.entries(c).filter(([k])=>k!==key)),distinct:frames.size,of:values.length});
      }
      result[key]=where;
    }
    out[`${face} ${body}`]=result;
  }
  return out;
}
if(process.argv[1]?.endsWith('audit-settings.mjs')){
  const [face,body]=process.argv.slice(2);
  const result=await audit({faces:face?[face]:undefined,bodies:body?[body]:undefined,tle:readFileSync(process.env.TLE_FILE||'tests/fixtures/celestrak-2026-09-29.tle','utf8'),epoch:Number(process.env.EPOCH)||Date.parse('2026-09-30T13:20:00Z')});
  console.log(JSON.stringify(result));
}
