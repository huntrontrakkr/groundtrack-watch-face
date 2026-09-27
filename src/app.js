import {Renderer,THEMES,clockParts} from './render.js';
import {BODIES,MINUTE} from './ephemeris.js';
const $=id=>document.getElementById(id);
const state={body:'sun',view:'landscape',theme:'survey',dither:'stipple',night:true,cities:false,home:true,secondary:false,timeZone:'UTC',epoch:BODIES.sun.demo};
const names={landscape:'01 / LANDSCAPE',oblique:'02 / OVER THE HORIZON',globe:'03 / ORBITAL'};
let main,comparisons;
function render(){
  const result=main.render(state);
  for(const [view,renderer] of Object.entries(comparisons))renderer.render({...state,view});
  for(const [attribute,value] of [['body',state.body],['view',state.view],['theme',state.theme],['compare',state.view]])document.querySelectorAll(`[data-${attribute}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[attribute]===value)));
  const time=clockParts(state.epoch,state.timeZone);
  $('watch').setAttribute('aria-label',`${BODIES[state.body].name} ground track, ${time.text} in ${state.timeZone}. ${state.body==='iss'?'Archived orbit, June 5, 2019.':'Calculated study position.'}`);
  $('time-output').textContent=`${time.text} · ${state.timeZone==='UTC'?'UTC':state.timeZone.split('/')[1].replaceAll('_',' ')}`;
  $('view-name').textContent=names[state.view];
  $('body-note').textContent=state.body==='iss'?'A dated, propagated orbit from 5 June 2019. Study data, not live tracking.':`The point on Earth directly beneath the ${BODIES[state.body].name.toLowerCase()}. Calculated for ${new Date(state.epoch).toISOString().slice(0,10)}.`;
  $('scale-note').textContent=state.body==='iss'?'A 90-minute orbit needs a wide view. The far side is hidden; quarter-hour labels supplement any visible hour marks.':'A three-hour track in a close view. Hour marks can leave the frame as the camera holds its position.';
  $('scene-caption').textContent=`${state.body==='iss'?'Archived orbit':'Calculated study'} · ${new Date(state.epoch).toISOString().slice(0,10)}\n${result.homeVisible?'Norfolk example is in view':'Norfolk example is beyond this view'}`;
  $('diagnostics').textContent=`Main preview: ${main.stats.renders} renders, ${main.stats.mapBuilds} map builds, ${main.stats.trackBuilds} track builds. Last browser draw: ${main.stats.lastMs.toFixed(1)} ms. These are browser diagnostics, not watch power measurements.`;
}
for(const [id,pal] of Object.entries(THEMES)){
  const button=document.createElement('button');button.dataset.theme=id;button.setAttribute('aria-pressed',String(id===state.theme));
  const row=document.createElement('span');row.className='swatch-row';
  for(const color of [pal.sky,pal.water,pal.land,pal.accent]){const swatch=document.createElement('i');swatch.style.background=color;row.append(swatch);}
  button.append(row,document.createTextNode(pal.name));$('themes').append(button);
}
try{
  const response=await fetch(`${import.meta.env.BASE_URL}land.bin`);if(!response.ok)throw new Error(`Map download failed (${response.status})`);
  const atlas=new Uint8Array(await response.arrayBuffer());if(atlas.length!==129600)throw new Error('Incomplete offline atlas');
  main=new Renderer($('watch'),atlas);comparisons=Object.fromEntries(['landscape','oblique','globe'].map(view=>[view,new Renderer($(`small-${view}`),atlas)]));
  document.querySelectorAll('[data-body]').forEach(button=>button.addEventListener('click',()=>{
    state.body=button.dataset.body;state.epoch=BODIES[state.body].demo;state.view=state.body==='iss'?'globe':'landscape';$('minute').value=0;render();
  }));
  for(const key of ['view','compare','theme'])document.querySelectorAll(`[data-${key}]`).forEach(button=>button.addEventListener('click',()=>{state[key==='compare'?'view':key]=button.dataset[key];render();}));
  $('minute').addEventListener('input',()=>{state.epoch=BODIES[state.body].demo+Number($('minute').value)*MINUTE;render();});
  $('reset-time').addEventListener('click',()=>{$('minute').value=0;state.epoch=BODIES[state.body].demo;render();});
  for(const id of ['night','cities','home','secondary'])$(id).addEventListener('change',()=>{state[id]=$(id).checked;render();});
  $('dither').addEventListener('change',()=>{state.dither=$('dither').value;render();});
  $('zone').addEventListener('change',()=>{state.timeZone=$('zone').value;render();});
  render();
  // Deterministic test/capture hook. No interval, RAF loop, GPS, or remote
  // orbital request runs in the preview. Scrubbing is explicitly user-driven.
  window.groundtrack={state,main,comparisons,render,ready:true};
}catch(error){$('scene-caption').textContent=`The study could not load: ${error.message}. Please reload the page.`;console.error(error);}
