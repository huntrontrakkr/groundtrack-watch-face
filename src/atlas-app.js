import {AtlasRenderer,INKS} from './atlas-render.js';
import {MINUTE} from './ephemeris.js';
import {clockParts} from './render.js';
import {civilHour} from './art-camera.js';
const $=id=>document.getElementById(id);
export const ATLAS_DEMOS={iss:{start:Date.parse('2019-06-05T12:00:00Z'),minutes:60,offset:24},moon:{start:Date.parse('2026-09-16T08:00:00Z'),minutes:60,offset:24},sun:{start:Date.parse('2026-09-27T08:00:00Z'),minutes:60,offset:24}};
const state={body:'moon',...ATLAS_DEMOS.moon,epoch:ATLAS_DEMOS.moon.start+24*MINUTE,ink:'chalk',zoom:'wide',home:'norfolk',cities:true,edges:false,secondary:'none',timeZone:'America/New_York',clock24:false};
let main,proofs;
let studyEpoch=state.epoch;
function render(){
  state.start=civilHour(state.epoch,state.timeZone);
  const last=main.render(state);
  // Share one immutable scene geometry among palette proofs. Lighting work
  // still happens per proof; the watch would only draw its selected palette.
  for(const [ink,p] of Object.entries(proofs)){
    for(const key of ['camera','geometryKey','ground','landMask','hours','cityCopies'])p[key]=main[key];
    p.render({...state,ink});
  }
  for(const key of ['body','ink','zoom'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===state[key])));
  $('atlas-minute').max=59;$('atlas-minute').value=(state.epoch-state.start)/MINUTE;
  $('atlas-zone').value=state.timeZone;
  $('atlas-time').textContent=last.time;$('range-start').textContent=clockParts(state.start,state.timeZone).text;$('range-end').textContent=clockParts(state.start+state.minutes*MINUTE,state.timeZone).text;
  $('atlas-date').textContent=new Date(state.epoch).toISOString().slice(0,10);
  $('body-note').textContent=state.body==='iss'?'The current hour to the next hour, from the archived 5 June 2019 ISS orbit. This is not a live position.':'The current hour and the next hour. Only this part of the ground track sets the framing.';
  $('atlas-caption').textContent=`${state.body==='iss'?'ISS · archived orbit':state.body==='moon'?'Moon · sublunar path':'Sun · subsolar path'} · ${last.current.lat.toFixed(1)}° ${last.current.lon.toFixed(1)}°. ${last.cuts?`${last.cuts} marked geographical jump${last.cuts>1?'s':''}.`:'The path stays on continuous joins.'}`;
  $('atlas-watch').setAttribute('aria-label',`${state.body.toUpperCase()} ground track at ${last.time} ${state.timeZone}, on a repeated Fuller atlas. ${last.hours.length} raised hour numerals. ${last.cities.join(', ')}. Example home ${state.home}. ${last.cuts} cuts in the path.`);
  $('atlas-diagnostics').textContent=`${main.stats.geometryBuilds} geography builds / ${main.stats.typeBuilds} tower builds / ${main.stats.lightingBuilds} lighting builds. ${last.seams} visible atlas cut edges; ${last.nightLights} night-side city copies. No idle redraws. Native energy use has not been measured.`;
}
for(const [ink,p] of Object.entries(INKS)){
  const b=document.createElement('button');b.dataset.ink=ink;
  const row=document.createElement('span');row.className='swatch-row';
  for(const c of [p.dark,p.light]){const i=document.createElement('i');i.style.backgroundColor=c;row.append(i);}
  b.append(row,document.createTextNode(p.name));$('atlas-inks').append(b);
}
try{
  const response=await fetch(`${import.meta.env.BASE_URL}land.bin`);if(!response.ok)throw new Error(`Atlas unavailable (${response.status})`);
  const land=new Uint8Array(await response.arrayBuffer());if(land.length!==129600)throw new Error('Incomplete land data');
  main=new AtlasRenderer($('atlas-watch'),land);proofs=Object.fromEntries(Object.keys(INKS).map(ink=>[ink,new AtlasRenderer($(`proof-${ink}`),land)]));
  for(const key of ['body','ink','zoom'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.addEventListener('click',()=>{
    state[key]=b.dataset[key];if(key==='body'){Object.assign(state,ATLAS_DEMOS[state.body]);state.epoch=state.start+state.offset*MINUTE;studyEpoch=state.epoch;}render();
  }));
  $('atlas-minute').addEventListener('input',()=>{state.epoch=state.start+Number($('atlas-minute').value)*MINUTE;render();});
  $('atlas-reset').addEventListener('click',()=>{state.epoch=studyEpoch;render();});
  for(const key of ['cities','edges'])$(`atlas-${key}`).addEventListener('change',()=>{state[key]=$(`atlas-${key}`).checked;render();});
  for(const [id,key] of [['home','home'],['secondary','secondary'],['zone','timeZone']])$(`atlas-${id}`).addEventListener('change',()=>{state[key]=$(`atlas-${id}`).value;render();});
  $('atlas-24').addEventListener('change',()=>{state.clock24=$('atlas-24').checked;render();});
  render();window.groundtrackAtlas={ready:true,state,main,proofs,render,demos:ATLAS_DEMOS};
}catch(error){$('atlas-caption').textContent=`The atlas could not load: ${error.message}. Please reload.`;console.error(error);}
