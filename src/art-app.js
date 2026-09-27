import {ArtRenderer,MATERIALS} from './art-render.js';
import {ART_DEMOS,ART_OBSERVATIONS,civilHour} from './art-camera.js';
import {MINUTE} from './ephemeris.js';
import {solarLight} from './art-light.js';
import {dot} from './geometry.js';
const $=id=>document.getElementById(id);
const state={body:'moon',epoch:ART_DEMOS.moon,timeZone:'America/New_York',lens:'oblique',material:'chalk',treatment:'relief',texture:false,fullTime:false,clock24:false,compass:true};
let main,proofs;
let scrubStart=civilHour(state.epoch,state.timeZone);
let observationEpoch=state.epoch;
function setObservations(){
  $('art-observation').replaceChildren();
  for(const [date,label] of ART_OBSERVATIONS[state.body]){
    const option=document.createElement('option');option.value=date;option.textContent=`${date.slice(8)} Sep · ${label}`;
    $('art-observation').append(option);
  }
  $('art-observation').disabled=ART_OBSERVATIONS[state.body].length===1;
}
function resetScrubber(){
  scrubStart=civilHour(state.epoch,state.timeZone);
  $('art-minute').value=Math.floor((state.epoch-scrubStart)/MINUTE);
}
function render(){
  const result=main.render(state);
  for(const [material,renderer] of Object.entries(proofs))renderer.render({...state,material});
  for(const key of ['body','lens','material','treatment'])document.querySelectorAll(`[data-${key}]`).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset[key]===state[key])));
  $('art-watch').setAttribute('aria-label',`${state.body} track at ${result.time}, ${state.timeZone}. ${result.hours[0].value} at the bottom, ${result.hours[1].value} at the top. ${state.treatment==='relief'?'Raised':'Inlaid'} hour numerals.`);
  $('art-time').textContent=result.time;
  $('art-date').textContent=new Intl.DateTimeFormat('en-US',{timeZone:state.timeZone,month:'short',day:'numeric',year:'numeric'}).format(new Date(state.epoch)).toUpperCase();
  $('art-caption').textContent=`${state.body==='moon'?'The Moon’s path across Australia.':'The Sun’s path across the western Indian Ocean.'} ${new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(new Date(state.epoch))}.`;
  const altitude=Math.asin(dot(main.camera.center,solarLight(state.epoch)))*180/Math.PI;
  $('light-note').textContent=`The Sun is ${Math.abs(altitude).toFixed(0)}° ${altitude>=0?'above':'below'} the horizon at the landscape’s center. Its calculated direction lights the surface and casts the numerals’ shadows.`;
  $('art-diagnostics').textContent=`${main.stats.geometryBuilds} geography builds / ${main.stats.sceneBuilds} lighting builds / ${main.stats.renders} draws. The camera, ground geometry and numeral masks are cached; sunlight uses the selected minute. Browser study only; native battery cost is not measured.`;
}
for(const [material,pal] of Object.entries(MATERIALS)){
  const button=document.createElement('button');button.dataset.material=material;
  const swatches=document.createElement('span');swatches.className='swatch-row';
  for(const color of [pal.ocean,pal.land,pal.shadow,pal.accent]){const swatch=document.createElement('i');swatch.style.backgroundColor=color;swatches.append(swatch);}
  button.append(swatches,document.createTextNode(pal.name));$('art-materials').append(button);
}
try{
  const response=await fetch(`${import.meta.env.BASE_URL}land.bin`);if(!response.ok)throw new Error(`Atlas unavailable (${response.status})`);
  const atlas=new Uint8Array(await response.arrayBuffer());if(atlas.length!==129600)throw new Error('Incomplete atlas');
  main=new ArtRenderer($('art-watch'),atlas);proofs=Object.fromEntries(Object.keys(MATERIALS).map(key=>[key,new ArtRenderer($(`proof-${key}`),atlas)]));
  for(const key of ['body','lens','material','treatment'])document.querySelectorAll(`[data-${key}]`).forEach(button=>button.addEventListener('click',()=>{
    state[key]=button.dataset[key];
    if(key==='body'){state.epoch=ART_DEMOS[state.body];observationEpoch=state.epoch;setObservations();resetScrubber();}
    render();
  }));
  $('art-minute').addEventListener('input',()=>{state.epoch=scrubStart+Number($('art-minute').value)*MINUTE;render();});
  $('art-reset').addEventListener('click',()=>{state.epoch=observationEpoch;resetScrubber();render();});
  $('art-observation').addEventListener('change',()=>{
    state.epoch=Date.parse(`${$('art-observation').value}T08:24:00Z`);observationEpoch=state.epoch;resetScrubber();render();
  });
  for(const key of ['texture','fullTime','clock24','compass'])$(key).addEventListener('change',()=>{state[key]=$(key).checked;render();});
  $('art-zone').addEventListener('change',()=>{state.timeZone=$('art-zone').value;resetScrubber();render();});
  setObservations();render();window.groundtrackArt={ready:true,state,main,proofs,render};
}catch(error){$('art-caption').textContent=`The study could not load: ${error.message}. Please reload.`;console.error(error);}
