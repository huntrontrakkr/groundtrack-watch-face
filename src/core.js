// The core: the watch's own chart builder and minute renderer (native/src/c),
// compiled to WebAssembly (tools/build-core.sh, public/core.wasm) behind
// native/host/core_api.c, so the study draws with the watch's code. An hour
// is built from the same input text the phone would give the watch
// (chart-input.js); a minute is drawn from the built scene.
import {chartInput} from './chart-input.js';
import {clockParts} from './render.js';
import {position,MINUTE} from './ephemeris.js';
import {civilHour} from './chart-render.js';
import network from '../data/tracking-stations.json' with {type:'json'};

export const W=200,H=228;
// core_layout's order (native/host/core_api.c).
const LAYOUT=['scene_size','point_size','minute_size','flags','body','view','forward','hour_start','heavy','fuller','zulu_x','zulu_baseline','top_x','top_baseline',
  'tape_x0','tape_x1','tape_baseline','tape_lo','tape_hi','home_x','home_y','home_box','mark_count','callout_left','callout_top','callout_bottom','hour_text','numerals',
  'c0','c1','station_count','stations','station_table','fig_box','tape_hour','tape_next','slide_minute','event_count','events','event_size',
  'minutes','m_mx','m_my','m_zulu','m_minute','m_top','m_index','m_height','track_count','track_t0','track_step','track','real_size'];
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
  }
  mem(){return this.x.memory.buffer;}
  // A resource's bytes, kept in the core's memory.
  source(kind,bytes){const at=this.x.core_alloc(bytes.length);new Uint8Array(this.mem(),at,bytes.length).set(bytes);this.x.core_source(kind,at,bytes.length);this.kept.push(at);}
  // Builds an hour from its input text; throws with the builder's reason.
  build(text){
    const bytes=new TextEncoder().encode(text),at=this.x.core_alloc(bytes.length);
    new Uint8Array(this.mem(),at,bytes.length).set(bytes);
    const ok=this.x.core_build(at,bytes.length);this.x.core_free(at);
    if(!ok)throw new Error('The core could not build the chart: '+this.string(this.x.core_failure()));
    return this.scene();
  }
  string(at,max=64){const b=new Uint8Array(this.mem(),at,max);let n=0;while(n<max&&b[n])n++;return new TextDecoder().decode(b.subarray(0,n));}
  // The scene as the study reads it (the struct's fields by core_layout).
  scene(){
    const L=this.layout,s=this.x.core_scene(),d=new DataView(this.mem()),u8=o=>d.getUint8(s+o),i8=o=>d.getInt8(s+o),i16=o=>d.getInt16(s+o,true),i32=o=>d.getInt32(s+o,true);
    const real=(base,o)=>L.real_size===8?d.getFloat64(base+o,true):d.getFloat32(base+o,true);
    const box=o=>({x:i16(o),y:i16(o+2),w:i16(o+4),h:i16(o+6)});
    const count=i16(L.track_count)&65535,t0=i32(L.track_t0),step=i16(L.track_step),tp=i32(L.track);
    const track=[];for(let k=0;k<count;k++){const p=tp+k*L.point_size;track.push({x:d.getInt16(p,true),y:d.getInt16(p+2,true),flags:d.getUint8(p+4),seconds:t0+k*step});}
    const stations=[];for(let k=0;k<u8(L.station_count);k++)stations.push({x:i16(L.stations+4*k),y:i16(L.stations+4*k+2),code:network.stations[u8(L.station_table+k)].code});
    const events=[];for(let k=0;k<u8(L.event_count);k++){const e=s+L.events+k*L.event_size;events.push({x:d.getInt16(e,true),y:d.getInt16(e+2,true),lx:d.getInt16(e+4,true),box:{x:d.getInt16(e+6,true),y:d.getInt16(e+8,true),w:d.getInt16(e+10,true),h:d.getInt16(e+12,true)},clear:!!d.getUint8(e+14),label:this.string(e+15,5)});}
    const minutes=[];for(let m=0;m<60;m++){const b=s+L.minutes+m*L.minute_size;minutes.push({x:real(b,L.m_mx),y:real(b,L.m_my),zulu:this.string(b+L.m_zulu,5),minute:this.string(b+L.m_minute,2),top:this.string(b+L.m_top,24),index:d.getInt16(b+L.m_index,true),height:this.string(b+L.m_height,8)});}
    const hx=i16(L.home_x);
    return {flags:u8(L.flags),body:u8(L.body),view:u8(L.view),forward:i8(L.forward),hourStart:i32(L.hour_start),heavy:!!u8(L.heavy),fuller:i32(L.fuller)!==0,
      zulu:{x:i16(L.zulu_x),baseline:i16(L.zulu_baseline)},top:{x:i16(L.top_x),baseline:i16(L.top_baseline)},
      tape:{x0:i16(L.tape_x0),x1:i16(L.tape_x1),baseline:i16(L.tape_baseline),lo:i16(L.tape_lo),hi:i16(L.tape_hi),hour:this.string(s+L.tape_hour,3),next:this.string(s+L.tape_next,3),slideMinute:u8(L.slide_minute)},
      home:hx>-1000?{x:hx,y:i16(L.home_y),box:box(L.home_box)}:null,
      callout:{left:i16(L.callout_left),top:i16(L.callout_top),bottom:i16(L.callout_bottom),hour:this.string(s+L.hour_text,3),numerals:u8(L.numerals)},
      c0:{x:i16(L.c0),y:i16(L.c0+2)},c1:{x:i16(L.c1),y:i16(L.c1+2)},stations,figureBoxes:[box(L.fig_box),box(L.fig_box+8)],events,minutes,track};
  }
  // A minute's frame as GColor8 bytes (a copy), or drawn over `frame` as the
  // minute `from` left it.
  render(minute){this.x.core_render(minute,this.frameAt);return new Uint8Array(this.mem(),this.frameAt,W*H).slice();}
  update(from,minute,frame){new Uint8Array(this.mem(),this.frameAt,W*H).set(frame);const drawn=this.x.core_render_update(from,minute,this.frameAt);frame.set(new Uint8Array(this.mem(),this.frameAt,W*H));return drawn;}
}

// The study's renderer over the core: render(state) as the page and the
// tests read it. An hour's scene is kept until the state changes it.
export class CoreRenderer{
  constructor(core){this.core=core;this.stats={geometryBuilds:0,renders:0};this.key=null;}
  render(state){
    const {body,epoch,timeZone,clock24}=state,start=civilHour(epoch,timeZone),minute=Math.floor((epoch-start)/MINUTE);
    const slide=state.tape==='slide'&&(state.projection||'chart')!=='fuller';
    const text=chartInput({body,start,plate:state.plate,readout:state.readout===true?'callout':state.readout||false,numerals:state.numerals||'colon',margin:state.zone||'utc',
      span:state.span||'day',tape:state.tape||'fixed',transfer:state.transfer||'off',minute:slide?minute:0,events:state.events||[],clock24,zone:timeZone,home:state.home||null,projection:state.projection||'chart'});
    if(text!==this.key){this.scene=this.core.build(text);this.key=text;this.stats.geometryBuilds++;}
    const frame=this.core.render(minute),buf=new Uint8ClampedArray(W*H*3),rgba=new Uint8ClampedArray(W*H*4);
    for(let i=0;i<W*H;i++){const c=RGB[frame[i]];buf[i*3]=c[0];buf[i*3+1]=c[1];buf[i*3+2]=c[2];rgba[i*4]=c[0];rgba[i*4+1]=c[1];rgba[i*4+2]=c[2];rgba[i*4+3]=255;}
    this.stats.renders++;
    const s=this.scene,m=s.minutes[minute],parts=clockParts(epoch,timeZone),h=Number(parts.h);
    const hour=String(clock24?h:h%12||12),next=String(clock24?(h+1)%24:(h+1)%12||12);
    const b=position(body,Math.floor(epoch/MINUTE)*MINUTE);
    const track=s.track.map(p=>({epoch:start+p.seconds*1000,x:p.x,y:p.y,hour:!!(p.flags&4)}));
    const world=s.view===1,day=s.view===2;
    this.last={buf,rgba,frame,start,time:parts.text,world,day,fuller:s.fuller,scene:s,
      marker:{x:m.x,y:m.y,lat:b.lat,lon:b.lon},stations:s.stations,events:s.events,home:s.home,
      stationsOnRoute:[{x:s.c0.x,y:s.c0.y,epoch:start},{x:s.c1.x,y:s.c1.y,epoch:start+60*MINUTE}],
      figure:{hour,minute:parts.m,next,box:s.figureBoxes[0].w?s.figureBoxes[0]:null,nextBox:s.figureBoxes[1].w?s.figureBoxes[1]:null,index:world?{x:m.index,y:s.tape.baseline}:{x:m.x,y:m.y}},
      camera:{track,stations:[track.find(p=>p.epoch===start),track.find(p=>p.epoch===start+60*MINUTE)],world,day,fuller:s.fuller}};
    return this.last;
  }
}
