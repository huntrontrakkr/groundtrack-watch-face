import {ChartRenderer,renderChart,toRGBA,CHARTS,W,H} from './chart-render.js';
import {MINUTE} from './ephemeris.js';
import {clockParts} from './render.js';
const $=id=>document.getElementById(id);
// Frozen study moments. Moonlight is the same Moon over three evenings,
// before, across and after the edge of night.
export const OBSERVATIONS={day:Date.parse('2026-09-17T08:24:00Z'),dusk:Date.parse('2026-09-19T09:24:00Z'),night:Date.parse('2026-09-20T10:24:00Z')};
export const DEMOS={sun:Date.parse('2026-09-27T08:24:00Z'),moon:OBSERVATIONS.day,iss:Date.parse('2019-06-05T12:24:00Z')};
const NOTES={
  sun:'The ground directly beneath the Sun. It is always noon on the route; the route runs west, so the next hour lies to the left.',
  moon:'The ground directly beneath the Moon. It also runs west, a little more slowly than the Sun.',
  iss:'An archived orbit from 5 June 2019. The station laps most of the world in an hour, so the whole world is the map.'
};
const state={body:'sun',observation:'day',epoch:DEMOS.sun,timeZone:'America/New_York',clock24:false,theme:'shore'};
let main,studyEpoch=state.epoch;
const proofs={};
function paint(canvas,rgba){canvas.getContext('2d').putImageData(new ImageData(rgba,W,H),0,0);}
function render(){
  const r=main.render(state);paint($('chart-watch'),r.rgba);
  for(const theme of Object.keys(CHARTS)){
    const out=theme===state.theme?r:renderChart({camera:main.camera,ground:main.ground,light:main.light,labels:main.labels,theme,epoch:state.epoch,timeZone:state.timeZone});
    paint(proofs[theme],out.rgba||toRGBA(out.buf));
  }
  for(const key of ['body','observation','theme'])document.querySelectorAll(`[data-${key}]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset[key]===state[key])));
  document.querySelectorAll('[data-observation]').forEach(b=>b.disabled=state.body!=='moon');$('moon-light').classList.toggle('muted',state.body!=='moon');
  $('chart-minute').value=Math.round((state.epoch-r.start)/MINUTE);$('chart-time').textContent=r.time;
  $('range-start').textContent=clockParts(r.start,state.timeZone).text;$('range-end').textContent=clockParts(r.start+60*MINUTE,state.timeZone).text;
  $('chart-zone').value=state.timeZone;$('chart-24').checked=state.clock24;
  $('chart-date').textContent=new Date(state.epoch).toISOString().slice(0,10);$('body-note').textContent=NOTES[state.body];
  const lat=r.marker.lat,lon=((r.marker.lon+540)%360)-180,place=`${Math.abs(lat).toFixed(1)}°${lat<0?'S':'N'} ${Math.abs(lon).toFixed(1)}°${lon<0?'W':'E'}`;
  const light=r.zones[2]>r.zones[0]?'mostly night':r.zones[2]||r.zones[1]?'edge of night in view':'daylight';
  $('chart-caption').textContent=`${state.body==='iss'?'ISS · archived orbit':state.body==='moon'?'Moon · sublunar route':'Sun · subsolar route'} · ${place} · ${light}`;
  const [now,next]=r.hours;
  $('chart-watch').setAttribute('aria-label',`${state.body.toUpperCase()} route at ${r.time}, ${state.timeZone}. Hour ${now.value}, next hour ${next.value}. ${CHARTS[state.theme].name} palette.`);
  const colors=new Set();for(let i=0;i<r.buf.length;i+=3)colors.add((r.buf[i]<<16)|(r.buf[i+1]<<8)|r.buf[i+2]);
  $('chart-diagnostics').textContent=`${colors.size} native colors in this frame. ${main.stats.geometryBuilds} map builds; ${main.stats.lightBuilds} light builds; ${main.stats.renders} renders. No idle redraws.`;
}
for(const [key,pal] of Object.entries(CHARTS)){
  const b=document.createElement('button');b.dataset.theme=key;
  const row=document.createElement('span');row.className='swatch-row';
  for(const color of [pal.ground[0][0],pal.ground[0][1],pal.hour[0][0],pal.route[0][0],pal.ground[2][0]]){const i=document.createElement('i');i.style.backgroundColor=`rgb(${color.join(',')})`;row.append(i);}
  b.append(row,document.createTextNode(pal.name));$('chart-palettes').append(b);
  const proof=document.createElement('button');proof.dataset.theme=key;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.setAttribute('aria-hidden','true');proofs[key]=canvas;
  const label=document.createElement('span');label.textContent=`${pal.name} / ${pal.note}`;
  proof.append(canvas,label);$('chart-proofs').append(proof);
}
try{
  const response=await fetch(`${import.meta.env.BASE_URL}land.bin`);if(!response.ok)throw new Error(`Coastline unavailable (${response.status})`);
  const land=new Uint8Array(await response.arrayBuffer());if(land.length!==129600)throw new Error('Incomplete coastline data');
  main=new ChartRenderer(land);
  document.querySelectorAll('[data-body]').forEach(b=>b.addEventListener('click',()=>{
    state.body=b.dataset.body;state.epoch=state.body==='moon'?OBSERVATIONS[state.observation]:DEMOS[state.body];studyEpoch=state.epoch;render();
  }));
  document.querySelectorAll('[data-observation]').forEach(b=>b.addEventListener('click',()=>{
    state.observation=b.dataset.observation;state.epoch=OBSERVATIONS[state.observation];studyEpoch=state.epoch;render();
  }));
  document.querySelectorAll('[data-theme]').forEach(b=>b.addEventListener('click',()=>{state.theme=b.dataset.theme;render();}));
  $('chart-minute').addEventListener('input',()=>{state.epoch=main.last.start+Number($('chart-minute').value)*MINUTE;render();});
  $('chart-reset').addEventListener('click',()=>{state.epoch=studyEpoch;render();});
  $('chart-zone').addEventListener('change',()=>{state.timeZone=$('chart-zone').value;render();});
  $('chart-24').addEventListener('change',()=>{state.clock24=$('chart-24').checked;render();});
  render();window.groundtrackChart={ready:true,state,main,render,demos:DEMOS,observations:OBSERVATIONS};
}catch(error){$('chart-caption').textContent=`The chart could not load: ${error.message}. Please reload.`;console.error(error);}
