import {ReliefRenderer,MATERIALS,W,H} from './relief-render.js';
import {quantizeImage} from './color-mix.js';
import {MINUTE} from './ephemeris.js';
import {clockParts} from './render.js';
import {civilHour} from './art-camera.js';
const $=id=>document.getElementById(id);
export const DEMOS={moon:Date.parse('2026-09-15T12:24:00Z'),sun:Date.parse('2026-09-27T08:24:00Z'),iss:Date.parse('2019-06-05T12:24:00Z')};
const observations={coast:DEMOS.moon,dusk:Date.parse('2026-09-18T08:24:00Z'),night:Date.parse('2026-09-20T08:24:00Z')};
const state={body:'moon',epoch:DEMOS.moon,start:civilHour(DEMOS.moon,'America/New_York'),material:'shore',mixing:true,timeZone:'America/New_York',clock24:false};
let main,studyEpoch=state.epoch;
function render(){
  state.start=civilHour(state.epoch,state.timeZone);
  const last=main.render(state),source=main.colorCtx.getImageData(0,0,W,H);
  for(const [id,mixing] of [['proof-direct',false],['proof-mixed',true]]){
    const ctx=$(id).getContext('2d');ctx.putImageData(new ImageData(quantizeImage(source,mixing),W,H),0,0);
    const original=main.ctx;main.ctx=ctx;main.paintReadingMarks(MATERIALS[state.material],main.current(state),clockParts(state.epoch,state.timeZone).m);main.ctx=original;
  }
  for(const key of ['body','material'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===state[key])));
  $('relief-minute').value=(state.epoch-state.start)/MINUTE;$('relief-time').textContent=last.time;
  $('range-start').textContent=clockParts(state.start,state.timeZone).text;$('range-end').textContent=clockParts(state.start+60*MINUTE,state.timeZone).text;
  $('relief-zone').value=state.timeZone;$('relief-24').checked=state.clock24;$('relief-mixing').checked=state.mixing;
  $('relief-observation').disabled=state.body!=='moon';
  $('relief-date').textContent=new Date(state.epoch).toISOString().slice(0,10);
  $('body-note').textContent=state.body==='iss'?'An archived orbit from 5 June 2019. Its ground track moves much farther in an hour, so the camera pulls back.':'The ground directly beneath the '+(state.body==='moon'?'Moon':'Sun')+', between two consecutive hour stations.';
  $('relief-caption').textContent=`${state.body==='iss'?'ISS · archived orbit':state.body==='moon'?'Moon · sublunar path':'Sun · subsolar path'} · ${last.current.lat.toFixed(1)}°, ${last.current.lon.toFixed(1)}°${last.cuts?` · ${last.cuts} marked map cut${last.cuts>1?'s':''}`:''}`;
  $('relief-watch').setAttribute('aria-label',`${state.body.toUpperCase()} ground track at ${last.time} ${state.timeZone}. Raised hour monuments ${last.hours.map(h=>h.value).join(' and ')}. ${MATERIALS[state.material].name}, ${state.mixing?'spatially mixed':'nearest native'} colors. ${last.cuts} geographical cuts.`);
  $('relief-diagnostics').textContent=`${last.colors} native colors in this frame. ${main.stats.geometryBuilds} geometry builds; ${main.stats.typeBuilds} towers; ${main.stats.lightingBuilds} lighting builds. No idle redraws.`;
}
for(const [key,pal] of Object.entries(MATERIALS)){
  const b=document.createElement('button');b.dataset.material=key;
  const row=document.createElement('span');row.className='swatch-row';
  for(const color of [pal.ocean,pal.shallows,pal.land,pal.stone,pal.track]){const i=document.createElement('i');i.style.backgroundColor=`rgb(${color.join(',')})`;row.append(i);}
  b.append(row,document.createTextNode(pal.name));$('relief-materials').append(b);
}
try{
  const response=await fetch(`${import.meta.env.BASE_URL}land.bin`);if(!response.ok)throw new Error(`Coastline unavailable (${response.status})`);
  const land=new Uint8Array(await response.arrayBuffer());if(land.length!==129600)throw new Error('Incomplete coastline data');
  main=new ReliefRenderer($('relief-watch'),land);
  for(const key of ['body','material'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.addEventListener('click',()=>{
    state[key]=b.dataset[key];if(key==='body'){state.epoch=state.body==='moon'?observations[$('relief-observation').value]:DEMOS[state.body];studyEpoch=state.epoch;}render();
  }));
  $('relief-minute').addEventListener('input',()=>{state.epoch=state.start+Number($('relief-minute').value)*MINUTE;render();});
  $('relief-reset').addEventListener('click',()=>{state.epoch=studyEpoch;render();});
  $('relief-mixing').addEventListener('change',()=>{state.mixing=$('relief-mixing').checked;render();});
  $('relief-zone').addEventListener('change',()=>{state.timeZone=$('relief-zone').value;render();});
  $('relief-24').addEventListener('change',()=>{state.clock24=$('relief-24').checked;render();});
  $('relief-observation').addEventListener('change',()=>{state.epoch=observations[$('relief-observation').value];studyEpoch=state.epoch;render();});
  render();window.groundtrackRelief={ready:true,state,main,render,demos:DEMOS,observations};
}catch(error){$('relief-caption').textContent=`The landscape could not load: ${error.message}. Please reload.`;console.error(error);}
