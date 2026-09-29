import {EnrouteRenderer,renderEnroute,PLATES,W,H} from './enroute-render.js';
import {decodeRelief,RELIEF_BYTES} from './relief.js';
import {MINUTE} from './ephemeris.js';
import {clockParts} from './render.js';
import {CATALOG,registerElements,elementsFor,bodyId,catalogEntry,FRESH} from './satellites.js';
const $=id=>document.getElementById(id);
// Frozen study moments; Moonlight is one Moon over three evenings.
export const OBSERVATIONS={day:Date.parse('2026-09-15T12:24:00Z'),dusk:Date.parse('2026-09-19T09:24:00Z'),night:Date.parse('2026-09-20T10:24:00Z')};
export const DEMOS={sun:Date.parse('2026-09-27T08:24:00Z'),moon:OBSERVATIONS.day,iss:Date.parse('2019-06-05T12:24:00Z')};
const NOTES={
  sun:'The ground directly beneath the Sun, where it is noon. The route runs west, so the next hour lies to the left.',
  moon:'The ground directly beneath the Moon. It also runs west, a little more slowly than the Sun.',
  iss:'An archived orbit from 5 June 2019. The station laps most of the world in an hour, so the whole world is the chart.'
};
const state={body:'sun',observation:'day',epoch:DEMOS.sun,timeZone:'America/New_York',clock24:false,plate:'enroute',readout:false};
let main,studyEpoch=state.epoch;
const proofs={};
function paint(canvas,buf){
  const rgba=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){rgba.set(buf.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
  canvas.getContext('2d').putImageData(new ImageData(rgba,W,H),0,0);
}
function render(){
  const r=main.render(state);$('enroute-watch').getContext('2d').putImageData(new ImageData(r.rgba,W,H),0,0);
  for(const plate of Object.keys(PLATES))paint(proofs[plate],plate===state.plate?r.buf:renderEnroute({camera:main.camera,ground:main.ground,relief:main.relief,light:main.light,plate,epoch:state.epoch,timeZone:state.timeZone,clock24:state.clock24,readout:state.readout}).buf);
  for(const key of ['body','observation','plate'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===state[key])));
  document.querySelectorAll('[data-observation]').forEach(b=>b.disabled=state.body!=='moon');$('moon-light').classList.toggle('muted',state.body!=='moon');
  $('enroute-minute').value=Math.round((state.epoch-r.start)/MINUTE);$('enroute-time').textContent=r.time;
  $('range-start').textContent=clockParts(r.start,state.timeZone).text;$('range-end').textContent=clockParts(r.start+60*MINUTE,state.timeZone).text;
  $('enroute-zone').value=state.timeZone;$('enroute-24').checked=state.clock24;$('enroute-readout').checked=state.readout;
  const sat=catalogEntry(state.body),elements=elementsFor(state.body);
  $('enroute-date').textContent=new Date(state.epoch).toISOString().slice(0,10);$('body-note').textContent=sat?sat.note:NOTES[state.body];
  const lat=r.marker.lat,lon=((r.marker.lon+540)%360)-180,place=`${Math.abs(lat).toFixed(1)}°${lat<0?'S':'N'} ${Math.abs(lon).toFixed(1)}°${lon<0?'W':'E'}`;
  const heard=r.stations.length?` · stations ${r.stations.map(s=>s.code).join(', ')}`:'';
  const age=elements?`live elements ${Math.round(Math.abs(state.epoch-elements.epoch)/3600000)} h from epoch`:'';
  $('enroute-caption').textContent=`${sat?`${sat.name} · ${age}`:state.body==='iss'?'ISS · archived orbit':state.body==='moon'?'Moon · sublunar route':'Sun · subsolar route'} · ${place}${heard}`;
  $('enroute-watch').setAttribute('aria-label',`${state.body.toUpperCase()} route at ${r.time}, ${state.timeZone}. Hour ${r.figure.hour}, minute ${r.figure.minute}, next hour ${r.figure.next}. ${PLATES[state.plate].name} plate.`);
  const colors=new Set();for(let i=0;i<r.buf.length;i+=3)colors.add((r.buf[i]<<16)|(r.buf[i+1]<<8)|r.buf[i+2]);
  $('enroute-diagnostics').textContent=`${colors.size} native colors in this frame. ${main.stats.geometryBuilds} chart builds; ${main.stats.lightBuilds} light builds; ${main.stats.renders} renders. No idle redraws.`;
}
for(const [key,pal] of Object.entries(PLATES)){
  const b=document.createElement('button');b.dataset.plate=key;
  const row=document.createElement('span');row.className='swatch-row';
  for(const color of [pal.land[0],pal.water[0],pal.contour[0],pal.ink[0],pal.route[0]]){const i=document.createElement('i');i.style.backgroundColor=`rgb(${color.join(',')})`;row.append(i);}
  b.append(row,document.createTextNode(pal.name));$('enroute-plates').append(b);
  const proof=document.createElement('button');proof.dataset.plate=key;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.setAttribute('aria-hidden','true');proofs[key]=canvas;
  const label=document.createElement('span');label.textContent=`${pal.name} / ${pal.note}`;
  proof.append(canvas,label);$('enroute-proofs').append(proof);
}
async function load(name,bytes){
  const response=await fetch(`${import.meta.env.BASE_URL}${name}`);if(!response.ok)throw new Error(`${name} unavailable (${response.status})`);
  const data=new Uint8Array(await response.arrayBuffer());if(data.length!==bytes)throw new Error(`Incomplete ${name}`);return data;
}
for(const c of CATALOG){const o=document.createElement('option');o.value=c.norad;o.textContent=`${c.code} · ${c.name}`;$('sat-select').append(o);}
// CelesTrak asks that the same data not be requested more than once every two
// hours; elements are cached here and reused until then.
const CACHE_AGE=2*3600000;
async function elementsText(norad){
  const key=`groundtrack-tle-${norad}`;let cached=null;
  try{cached=JSON.parse(localStorage.getItem(key));}catch{}
  if(cached&&Date.now()-cached.fetched<CACHE_AGE)return {text:cached.text,from:'cache'};
  try{
    const response=await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=TLE`);
    if(!response.ok)throw new Error(`CelesTrak answered ${response.status}`);
    const text=await response.text();registerElements(text,'celestrak');
    try{localStorage.setItem(key,JSON.stringify({text,fetched:Date.now()}));}catch{}
    return {text,from:'CelesTrak'};
  }catch(error){
    if(cached)return {text:cached.text,from:'an older cached copy'};
    throw error;
  }
}
async function track(norad){
  const c=CATALOG.find(x=>x.norad===norad);$('sat-status').textContent=`Requesting ${c.name} elements…`;
  try{
    const {text,from}=await elementsText(norad),e=registerElements(text,from),now=Math.floor(Date.now()/MINUTE)*MINUTE;
    if(Math.abs(now-e.epoch)>FRESH)throw new Error('the newest elements are more than three days old');
    state.body=bodyId(norad);state.epoch=now;studyEpoch=now;render();
    $('sat-status').textContent=`${c.name}: elements from ${from}, epoch ${new Date(e.epoch).toISOString().slice(0,16).replace('T',' ')} UTC. Frozen at this minute; choose Now to catch up.`;
  }catch(error){$('sat-status').textContent=`Could not track ${c.name}: ${error.message}. The 2019 ISS archive remains available offline.`;}
}
try{
  const [land,relief]=await Promise.all([load('land.bin',129600),load('relief.bin',RELIEF_BYTES)]);
  main=new EnrouteRenderer(land,decodeRelief(relief));
  document.querySelectorAll('[data-body]').forEach(b=>b.addEventListener('click',()=>{
    state.body=b.dataset.body;state.epoch=state.body==='moon'?OBSERVATIONS[state.observation]:DEMOS[state.body];studyEpoch=state.epoch;render();
  }));
  document.querySelectorAll('[data-observation]').forEach(b=>b.addEventListener('click',()=>{
    state.observation=b.dataset.observation;state.epoch=OBSERVATIONS[state.observation];studyEpoch=state.epoch;render();
  }));
  document.querySelectorAll('[data-plate]').forEach(b=>b.addEventListener('click',()=>{state.plate=b.dataset.plate;render();}));
  $('enroute-now').addEventListener('click',()=>{
    try{state.epoch=Math.floor(Date.now()/MINUTE)*MINUTE;render();}
    catch(error){$('sat-status').textContent=`${error.message}. Choose Track now to refresh the elements.`;state.epoch=studyEpoch;render();}
  });
  $('sat-track').addEventListener('click',()=>track(Number($('sat-select').value)));
  $('enroute-minute').addEventListener('input',()=>{state.epoch=main.last.start+Number($('enroute-minute').value)*MINUTE;render();});
  $('enroute-reset').addEventListener('click',()=>{state.epoch=studyEpoch;render();});
  $('enroute-zone').addEventListener('change',()=>{state.timeZone=$('enroute-zone').value;render();});
  $('enroute-24').addEventListener('change',()=>{state.clock24=$('enroute-24').checked;render();});
  $('enroute-readout').addEventListener('change',()=>{state.readout=$('enroute-readout').checked;render();});
  render();window.groundtrackEnroute={ready:true,state,main,render,track,demos:DEMOS,observations:OBSERVATIONS};
}catch(error){$('enroute-caption').textContent=`The chart could not load: ${error.message}. Please reload.`;console.error(error);}
