// Native scenes: an hour of Study 06 as the watch's native renderer takes
// it (native/src/c/enroute_core.c). Runs anywhere the renderer does: in
// Node for the tests and tools, and bundled into the phone app.
//
// Scene file (little-endian), version 2:
//   'GTS2', u16 W, u16 H, u8 flags (1 zones night, 2 scan, 4 terminator,
//   8 night dots, 16 minute flag), u8 body (0 Sun, 1 Moon, 2 satellite,
//   3 station), i8 forward, u8 pad, i32 hour start (Unix seconds)
//   palette: water land coast contour shelf grid route ink mark (x3 zones),
//   then space spaceInk screen waterline terminator nightDots, tints[5],
//   depths[2], all as Pebble GColor8 (0b11rrggbb)
//   f64 rowCos[H], rowSin[H], colCos[W], colSin[W]
//   f64 c1x, normal x, normal y; i16 zulu x, zulu baseline
//   60 minutes: f64 sun[3], f64 marker x, y, f64 moon fraction, u8 waxing,
//   char zulu[5], u8 minute text[2], char top line[24] (a satellite's pass
//   line, NUL-padded, '°' as 0x7f; empty when the line is fixed)
//   u16 track count, then per point f64 x, y, i32 seconds from the hour, u8 hour
//   u16 row offsets[H+1] into the runs, then the class plane as runs of
//   (u8 count, u8 class) that never cross a row. Each class byte: low
//   nibble ground class, high nibble layer (0 plain,
//   1 contour, 2 coast, 3 shelf, 4 waterline, 5 knockout, 6 grid, 7 route,
//   8 ink, 9 mark, 10 ink over space, 11 space, 12 knockout and 13 ink
//   drawn before the route)
import {EnrouteRenderer,renderEnroute,PLATES,passText,W,H} from './enroute-render.js';
import {position,moonLight,MINUTE} from './ephemeris.js';
import {catalogEntry} from './satellites.js';
import {registerNominal} from './nominal.js';
import {RAD} from './geometry.js';

registerNominal();
// Build one hour's scene from the coastline atlas and the decoded relief.
// Returns the scene bytes, and the renderer and state, which can then draw
// the browser's frames of the same hour.
export function buildScene({atlas,meters,body,start,plate:plateKey,flag=false,timeZone='UTC',clock24=true,home=null}){
  const state={body,epoch:start,timeZone,clock24,plate:plateKey,home,events:[],readout:flag?'flag':false};
  const r=new EnrouteRenderer(atlas,meters);r.render(state);
  const cam=r.camera,pal=PLATES[plateKey];
  if(cam.world||cam.fuller||cam.day)throw new Error('Only the hour chart is exported');

  // A probe plate: the target plate's structure, every color unique, so each
  // drawn pixel's class can be read back from its color.
  const PROBE={water:'#000055',land:'#0000AA',coast:'#0000FF',contour:'#005500',shelf:'#005555',grid:'#0055AA',route:'#0055FF',ink:'#00AA00',mark:'#00AA55',space:'#00AAAA',spaceInk:'#00AAFF',screen:'#00FF00',waterline:'#00FF55'};
  const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
  const probe={...pal};
  for(const k of ['water','land','coast','contour','shelf','grid','route','ink','mark'])probe[k]=[0,1,2].map(()=>hex(PROBE[k]));
  for(const k of ['space','spaceInk','screen'])probe[k]=hex(PROBE[k]);
  if(pal.waterline)probe.waterline=hex(PROBE.waterline);
  const tintProbe=['#550000','#550055','#5500AA','#5500FF','#555500','#555555','#5555AA'];
  if(pal.tints)probe.tints=pal.tints.map(([l],k)=>[l,hex(tintProbe[k])]);
  if(pal.depths)probe.depths=pal.depths.map(([l],k)=>[l,hex(tintProbe[5+k])]);
  const base=renderEnroute({camera:cam,ground:r.ground,relief:r.relief,light:r.light,plate:probe,epoch:start,timeZone,clock24,home:state.home,events:[],readout:state.readout,layers:'base'});
  const LAYER={[PROBE.grid]:6,[PROBE.route]:7,[PROBE.ink]:8,[PROBE.mark]:9,[PROBE.spaceInk]:10,[PROBE.space]:11};
  const key=i=>'#'+[0,1,2].map(k=>base.buf[i*3+k].toString(16).padStart(2,'0')).join('').toUpperCase();
  const classes=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    let layer=base.trace[i]===2?5:base.trace[i]===1?LAYER[key(i)]:base.overlay[i];
    // Knockouts and ink from before the route, which its bold line may cover.
    if(base.beforeRoute[i]&&layer===5)layer=12;else if(base.beforeRoute[i]&&layer===8)layer=13;
    if(layer===undefined)throw new Error(`Unclassified pixel ${i%W},${Math.floor(i/W)} ${key(i)}`);
    classes[i]=layer<<4|base.baseClass[i];
  }

  const bytes=[],scratch=new DataView(new ArrayBuffer(8)),u8=v=>bytes.push(v&255),i8=v=>u8(v<0?v+256:v),u16=v=>{u8(v);u8(v>>8);},i16=v=>u16(v<0?v+65536:v);
  const i32=v=>{scratch.setInt32(0,v,true);for(let k=0;k<4;k++)bytes.push(scratch.getUint8(k));},f64=v=>{scratch.setFloat64(0,v,true);for(let k=0;k<8;k++)bytes.push(scratch.getUint8(k));};
  const g8=c=>c?0xC0|(c[0]/85)<<4|(c[1]/85)<<2|c[2]/85:0;
  for(const c of 'GTS2')u8(c.charCodeAt(0));
  u16(W);u16(H);
  u8((pal.night==='zones'?1:0)|(pal.scan?2:0)|(pal.terminator?4:0)|(pal.nightDots?8:0)|(flag?16:0));
  const kind=body==='sun'?0:body==='moon'?1:catalogEntry(body)?.symbol==='satellite'?2:3;u8(kind);
  const [s0,s1]=cam.stations;i8(s1.x>s0.x?1:-1);u8(0);i32(Math.floor(start/1000));
  for(const k of ['water','land','coast','contour','shelf','grid','route','ink','mark'])for(let z=0;z<3;z++)u8(g8(pal[k][z]));
  for(const k of ['space','spaceInk','screen','waterline','terminator','nightDots'])u8(g8(pal[k]));
  for(let k=0;k<5;k++)u8(g8(pal.tints?.[k]?.[1]));for(let k=0;k<2;k++)u8(g8(pal.depths?.[k]?.[1]));
  // The chart is equidistant cylindrical: latitude by row, longitude by column.
  const rows=[],cols=[];
  for(let y=0;y<H;y++){const lat=cam.toGround(0.5,y+.5).lat*RAD;rows.push([Math.cos(lat),Math.sin(lat)]);}
  for(let x=0;x<W;x++){const lon=cam.toGround(x+.5,0.5).lon*RAD;cols.push([Math.cos(lon),Math.sin(lon)]);}
  for(const [c] of rows)f64(c);for(const [,s] of rows)f64(s);for(const [c] of cols)f64(c);for(const [,s] of cols)f64(s);
  f64(s1.x);f64(cam.normal?.x??0);f64(cam.normal?.y??-1);i16(base.zuluAt.x);i16(base.zuluAt.baseline);
  for(let m=0;m<60;m++){
    const t=start+m*MINUTE,sun=position('sun',t).dir,b=position(body,t),p=cam.project(b.lat,b.lon),moon=moonLight(t),d=new Date(t);
    for(const v of sun)f64(v);f64(p.x);f64(p.y);f64(moon.fraction);u8(moon.waxing?1:0);
    for(const c of `${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}Z`)u8(c.charCodeAt(0));
    for(const c of String(d.getUTCMinutes()).padStart(2,'0'))u8(c.charCodeAt(0));
    const top=body!=='sun'&&body!=='moon'&&state.home?passText(body,state.home,t,timeZone):'';
    for(let k=0;k<24;k++)u8(k<top.length?(top[k]==='°'?0x7f:top.charCodeAt(k)):0);
  }
  u16(cam.track.length);for(const p of cam.track){f64(p.x);f64(p.y);i32(Math.round((p.epoch-start)/1000));u8(p.hour?1:0);}
  // The class plane as row runs: charts are mostly flat, so this is a
  // quarter of the plane's size or less.
  const runs=[],offsets=[0];
  for(let y=0;y<H;y++){for(let x=0;x<W;){let k=1;while(x+k<W&&k<255&&classes[y*W+x+k]===classes[y*W+x])k++;runs.push(k,classes[y*W+x]);x+=k;}offsets.push(runs.length);}
  for(const o of offsets)u16(o);
  bytes.push(...runs);
  return {scene:Uint8Array.from(bytes),renderer:r,state};
}
