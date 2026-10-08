// The core: the watch's own chart builder and minute renderer (native/src/c),
// compiled to WebAssembly (tools/build-core.sh, public/core.wasm) behind
// native/host/core_api.c, so the study draws with the watch's code. An hour
// is built from the same input text the phone would give the watch
// (chart-input.js); a minute is drawn from the built scene.
import {catalogEntry} from './satellites.js';
import {chartInput} from './chart-input.js';
import {clockParts} from './render.js';
import {position,MINUTE} from './ephemeris.js';
import {civilHour} from './chart-render.js';
import network from '../data/tracking-stations.json' with {type:'json'};
import {localDate} from './chart-text.js';
import {SCALE} from './plates.js';

export const W=200,H=228,SLOTS=32;
// core_layout's order (native/host/core_api.c).
const LAYOUT=['scene_size','point_size','minute_size','flags','body','view','forward','hour_start','heavy','fuller','zulu_x','zulu_baseline','top_x','top_baseline','height_right','height_baseline',
  'tape_x0','tape_x1','tape_baseline','tape_lo','tape_hi','home_x','home_y','home_box','mark_count','callout_left','callout_top','callout_bottom','hour_text','numerals',
  'c0','c1','station_count','stations','station_table','fig_box','tape_hour','tape_next','event_count','events','event_size',
  'minutes','m_mx','m_my','m_zulu','m_minute','m_top','m_index','m_corner','track_count','track_t0','track_step','track','real_size','f_tile_count','f_tile_face','counter'];
// Pebble's GColor8 (0b11rrggbb) to the study's RGB.
const RGB=Array.from({length:256},(_,c)=>[(c>>4&3)*85,(c>>2&3)*85,(c&3)*85]);

// Loads the core with its resources: {wasm, map, figures, tables, grids,
// land} as bytes (grids and land for the Fuller sheets).
export async function loadCore({wasm,map,figures,tables,grids=null,land=null}){
  const stubs={wasi_snapshot_preview1:{fd_close:()=>0,fd_seek:()=>0,fd_write:()=>0}};
  const {instance}=await WebAssembly.instantiate(wasm,stubs);
  instance.exports._initialize();
  const core=new Core(instance);
  [map,figures,tables,grids,land].forEach((bytes,kind)=>{if(bytes)core.source(kind,bytes);});
  return core;
}
export class Core{
  constructor(instance){
    this.x=instance.exports;this.kept=[];
    const at=this.x.core_alloc(4*64),n=this.x.core_layout(at,64);
    const v=new Int32Array(this.mem(),at,n);this.layout=Object.fromEntries(LAYOUT.map((k,i)=>[k,v[i]]));this.x.core_free(at);
    this.frameAt=this.x.core_alloc(W*H);
    // The scenes built, by their input text, each in one of the core's slots.
    this.slots=new Map();this.tick=0;
  }
  // The scene for an input text: built if it isn't held (the oldest held
  // let go), or as held. Returns {slot, scene, built}.
  sceneFor(text){
    let held=this.slots.get(text),built=false;
    if(!held){
      let slot=this.slots.size;
      if(slot>=SLOTS){let oldest=null;for(const [k,v] of this.slots)if(!oldest||v.used<oldest[1].used)oldest=[k,v];slot=oldest[1].slot;this.slots.delete(oldest[0]);}
      held={slot,scene:this.build(text,slot),used:0};this.slots.set(text,held);built=true;
    }
    held.used=++this.tick;return {...held,built};
  }
  mem(){return this.x.memory.buffer;}
  // A resource's bytes, kept in the core's memory.
  source(kind,bytes){const at=this.x.core_alloc(bytes.length);new Uint8Array(this.mem(),at,bytes.length).set(bytes);this.x.core_source(kind,at,bytes.length);this.kept.push(at);}
  // Builds an hour from its input text into one of the core's scene slots;
  // throws with the builder's reason.
  build(text,slot=0){
    const bytes=new TextEncoder().encode(text),at=this.x.core_alloc(bytes.length);
    new Uint8Array(this.mem(),at,bytes.length).set(bytes);
    const ok=this.x.core_build(at,bytes.length,slot);this.x.core_free(at);
    if(!ok)throw new Error('The core could not build the chart: '+this.string(this.x.core_failure()));
    return this.scene(slot);
  }
  string(at,max=64){const b=new Uint8Array(this.mem(),at,max);let n=0;while(n<max&&b[n])n++;return new TextDecoder().decode(b.subarray(0,n));}
  // The scene as the study reads it (the struct's fields by core_layout).
  scene(slot=0){
    const L=this.layout,s=this.x.core_scene(slot),d=new DataView(this.mem()),u8=o=>d.getUint8(s+o),i8=o=>d.getInt8(s+o),i16=o=>d.getInt16(s+o,true),i32=o=>d.getInt32(s+o,true);
    const real=(base,o)=>L.real_size===8?d.getFloat64(base+o,true):d.getFloat32(base+o,true);
    const box=o=>({x:i16(o),y:i16(o+2),w:i16(o+4),h:i16(o+6)});
    const count=i16(L.track_count)&65535,t0=i32(L.track_t0),step=i16(L.track_step),tp=i32(L.track);
    const track=[];for(let k=0;k<count;k++){const p=tp+k*L.point_size;track.push({x:d.getInt16(p,true),y:d.getInt16(p+2,true),flags:d.getUint8(p+4),seconds:t0+k*step});}
    const stations=[];for(let k=0;k<u8(L.station_count);k++)stations.push({x:i16(L.stations+4*k),y:i16(L.stations+4*k+2),code:network.stations[u8(L.station_table+k)].code});
    const events=[];for(let k=0;k<u8(L.event_count);k++){const e=s+L.events+k*L.event_size;events.push({x:d.getInt16(e,true),y:d.getInt16(e+2,true),lx:d.getInt16(e+4,true),box:{x:d.getInt16(e+6,true),y:d.getInt16(e+8,true),w:d.getInt16(e+10,true),h:d.getInt16(e+12,true)},clear:!!d.getUint8(e+14),label:this.string(e+15,5)});}
    const minutes=[];for(let m=0;m<60;m++){const b=d.getUint32(s+L.minutes,true)+m*L.minute_size;minutes.push({x:real(b,L.m_mx),y:real(b,L.m_my),zulu:this.string(b+L.m_zulu,5),minute:this.string(b+L.m_minute,2),top:this.string(b+L.m_top,24),index:d.getInt16(b+L.m_index,true),corner:this.string(b+L.m_corner,14)});}
    const hx=i16(L.home_x),fp=i32(L.fuller);
    const tiles=fp?Array.from({length:d.getUint8(fp+L.f_tile_count)},(_,k)=>({face:d.getUint8(fp+L.f_tile_face+k)})):[];
    return {flags:u8(L.flags),body:u8(L.body),view:u8(L.view),forward:i8(L.forward),hourStart:i32(L.hour_start),heavy:!!u8(L.heavy),counter:u8(L.counter),fuller:i32(L.fuller)!==0,
      zulu:{x:i16(L.zulu_x),baseline:i16(L.zulu_baseline)},top:{x:i16(L.top_x),baseline:i16(L.top_baseline)},
      tape:{x0:i16(L.tape_x0),x1:i16(L.tape_x1),baseline:i16(L.tape_baseline),lo:i16(L.tape_lo),hi:i16(L.tape_hi),hour:this.string(s+L.tape_hour,3),next:this.string(s+L.tape_next,3)},
      home:hx>-1000?{x:hx,y:i16(L.home_y),box:box(L.home_box)}:null,
      callout:{left:i16(L.callout_left),top:i16(L.callout_top),bottom:i16(L.callout_bottom),hour:this.string(s+L.hour_text,3),numerals:u8(L.numerals)},
      height:{right:i16(L.height_right),baseline:i16(L.height_baseline)},
      c0:{x:i16(L.c0),y:i16(L.c0+2)},c1:{x:i16(L.c1),y:i16(L.c1+2)},stations,figureBoxes:[box(L.fig_box),box(L.fig_box+8)],events,minutes,track,tiles};
  }
  // The study's measures: where a minute's moving part falls (MEASURE's
  // parts), lettering's box and width, a pixel's class and night zone.
  measure(slot,minute,part){const at=this.x.core_alloc(8);this.x.core_measure(slot,minute,part,at);const b=new Int16Array(this.mem(),at,4),box=b[2]?{x:b[0],y:b[1],w:b[2],h:b[3]}:null;this.x.core_free(at);return box;}
  textBox(text,x,baseline){const bytes=new TextEncoder().encode(text),at=this.x.core_alloc(bytes.length),out=this.x.core_alloc(8);new Uint8Array(this.mem(),at,bytes.length).set(bytes);this.x.core_text_box(at,bytes.length,x,baseline,out);const b=new Int16Array(this.mem(),out,4),box=b[2]?{x:b[0],y:b[1],w:b[2],h:b[3]}:null;this.x.core_free(at);this.x.core_free(out);return box;}
  textWidth(text){const bytes=new TextEncoder().encode(text),at=this.x.core_alloc(bytes.length);new Uint8Array(this.mem(),at,bytes.length).set(bytes);const w=this.x.core_text_width(at,bytes.length);this.x.core_free(at);return w;}
  // The watch's own state in the margins' corner (NO LINK, BAT 18; '' for none).
  // The battery for the fuel line along the top edge (as the watch tells the
  // renderer): percent, charging, and whether the phone is in reach.
  power(percent=100,{charging=false,linked=true,fuel=true}={}){this.x.core_power(percent,(charging?1:0)|(linked?0:2)|(fuel?0:4));}
  status(text){const bytes=new TextEncoder().encode(text||''),at=this.x.core_alloc(bytes.length||1);new Uint8Array(this.mem(),at,bytes.length).set(bytes);this.x.core_status(at,bytes.length);this.x.core_free(at);}
  classAt(slot,x,y){return this.x.core_class(slot,x,y);}
  zoneAt(slot,minute,x,y){return this.x.core_zone(slot,minute,x,y);}
  // A minute's frame as GColor8 bytes (a copy), or drawn over `frame` as the
  // minute `from` left it.
  render(minute,slot=0){this.x.core_render(slot,minute,this.frameAt);return new Uint8Array(this.mem(),this.frameAt,W*H).slice();}
  update(from,minute,frame,slot=0){new Uint8Array(this.mem(),this.frameAt,W*H).set(frame);const drawn=this.x.core_render_update(slot,from,minute,this.frameAt);frame.set(new Uint8Array(this.mem(),this.frameAt,W*H));return drawn;}
}

// The study's renderer over the core: render(state) as the page and the
// tests read it. The last few hours' scenes are kept (the page's proofs
// show one hour on every plate), each in a slot of the core's.
export const MEASURE={body:0,flag:1,callout:2,tapeHour:3,tapeNext:4,index:5,counter:6};
export class CoreRenderer{
  constructor(core){this.core=core;this.stats={geometryBuilds:0,renders:0};}
  render(state){
    const {body,epoch,timeZone,clock24}=state,start=civilHour(epoch,timeZone),minute=Math.floor((epoch-start)/MINUTE);
    const text=chartInput({body,start,plate:state.plate,readout:state.readout===true?'callout':state.readout||false,numerals:state.numerals||'colon',margin:state.zone||'utc',
      span:state.span||'day',tape:state.tape||'fixed',transfer:state.transfer||'off',figures:state.figures||'michroma',corner:state.corner||'day',events:state.events||[],clock24,zone:timeZone,home:state.home||null,projection:state.projection||'chart',face:state.face,also:state.also||[],bare:!!state.bare,legend:!!state.legend,north:!!state.north,extra:state.extra||[],tracks:state.tracks||[]});
    const held=this.core.sceneFor(text);if(held.built)this.stats.geometryBuilds++;this.scene=held.scene;
    const frame=this.core.render(minute,held.slot),buf=new Uint8ClampedArray(W*H*3),rgba=new Uint8ClampedArray(W*H*4);
    for(let i=0;i<W*H;i++){const c=RGB[frame[i]];buf[i*3]=c[0];buf[i*3+1]=c[1];buf[i*3+2]=c[2];rgba[i*4]=c[0];rgba[i*4+1]=c[1];rgba[i*4+2]=c[2];rgba[i*4+3]=255;}
    this.stats.renders++;
    const s=this.scene,m=s.minutes[minute],parts=clockParts(epoch,timeZone),h=Number(parts.h);
    const hour=String(clock24?h:h%12||12),next=String(clock24?(h+1)%24:(h+1)%12||12);
    const b=position(body,Math.floor(epoch/MINUTE)*MINUTE);
    // With the world sliding the band is the world round, W columns, turned
    // under the index each minute: the scene's places come round with it.
    const off=(s.flags&128)?((Math.round(m.x)-W/2)%W+W)%W:0,turned=x=>off?((x-off)%W+W)%W:x,turnedBox=b=>b&&off?{...b,x:turned(b.x)}:b;
    const track=s.track.map(p=>({epoch:start+p.seconds*1000,x:turned(p.x),y:p.y,hour:!!(p.flags&4)}));
    const world=s.view===1,day=s.view===2,numerals=state.numerals||'colon',sliding=!!(s.flags&64),core=this.core,slot=held.slot;
    // The minute readout drawn: the flag or the time callout (a day chart's
    // always), and its box.
    const readout=day||(s.flags&32)?'callout':s.counter?'counter':(s.flags&16)?'flag':null;
    const readoutBox=readout==='flag'?core.measure(slot,minute,MEASURE.flag):readout==='counter'?core.measure(slot,minute,MEASURE.counter):readout?core.measure(slot,minute,MEASURE.callout):null;
    const time=readout==='callout'?(numerals==='colon'?`${hour}:${parts.m}`:`${numerals==='even'&&clock24?hour.padStart(2,'0'):hour}${parts.m}`):null;
    const dayStart=day&&track.length?track[0].epoch:0;
    // The hour figures' boxes: on the sliding tape the minute's; on a day
    // chart the callout's.
    const box=sliding?core.measure(slot,minute,MEASURE.tapeHour):day||readout==='counter'?readoutBox:s.figureBoxes[0].w?s.figureBoxes[0]:null;
    const nextBox=sliding?core.measure(slot,minute,MEASURE.tapeNext):day?null:s.figureBoxes[1].w?s.figureBoxes[1]:null;
    // The time scale's ends and the index over the minute.
    const scale=world?(sliding?{x0:0,x1:W-1}:{x0:s.tape.x0,x1:s.tape.x1}):{x0:Math.min(s.c0.x,s.c1.x),x1:Math.max(s.c0.x,s.c1.x)};
    const forward=s.forward>0,step=(scale.x1-scale.x0)/60;
    const index=world?{x:sliding?W/2:m.index,y:SCALE.baseline}:day?{x:m.x,y:m.y}:{x:forward?scale.x0+step*minute:scale.x1-step*minute,y:s.c0.y};
    // Lettering's boxes: the stations' codes, the margins and Zulu time.
    const stations=s.stations.map(st=>{const w=core.textWidth(st.code),right=st.x+5+w<W-3;return {...st,x:turned(st.x),box:turnedBox({x:right?st.x-3:st.x-6-w,y:st.y-5,w:w+9,h:11})};});
    const margins=[];
    if(!world){const d=localDate(start,timeZone),MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],WEEKDAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
      const left=`${s.body>=2?(catalogEntry(body)?.code||(body==='iss'?'ISS':'SAT')):WEEKDAYS[new Date(Date.UTC(d.year,d.month-1,d.day)).getUTCDay()]} ${String(d.day).padStart(2,'0')} ${MONTHS[d.month-1]}`,right=m.corner;
      for(const b of [core.textBox(left,6,H-5),right&&core.textBox(right,W-6-core.textWidth(right),H-5)])if(b)margins.push(b);}
    const zuluBox=core.textBox(m.zulu,s.zulu.x,s.zulu.baseline);
    this.last={buf,rgba,frame,start,time:parts.text,world,day,fuller:s.fuller,scene:s,slot,minute,zulu:{text:m.zulu,box:zuluBox},margins,
      marker:{x:turned(m.x),y:m.y,lat:b.lat,lon:b.lon},stations,events:s.events.map(e=>({...e,x:turned(e.x),lx:turned(e.lx),box:e.clear?turnedBox(e.box):null})),home:s.home&&{...s.home,x:turned(s.home.x),box:turnedBox(s.home.box)},rose:world||day?null:{x:s.c0.x,y:s.c0.y,r:20},
      stationsOnRoute:[{x:turned(s.c0.x),y:s.c0.y,epoch:start},{x:turned(s.c1.x),y:s.c1.y,epoch:start+60*MINUTE}],
      figure:{hour,minute:parts.m,next,time,readout:readoutBox?{kind:readout,...readoutBox}:null,box,nextBox,index,scale},
      camera:{track,stations:[track.find(p=>p.epoch===start),track.find(p=>p.epoch===start+60*MINUTE)],world,fuller:s.fuller||undefined,band:world?{top:s.height.baseline+6,bottom:H-10}:{top:0,bottom:H},tiles:s.tiles,day:day?{start:dayStart,hours:track.filter(p=>(p.epoch-dayStart)%3600000===0)}:null}};
    this.camera=this.last.camera;
    return this.last;
  }
}
