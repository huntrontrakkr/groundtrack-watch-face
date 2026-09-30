// Native scenes: an hour of Study 06 as the watch's native renderer takes
// it (native/src/c/enroute_core.c). Runs anywhere the renderer does: in
// Node for the tests and tools, and bundled into the phone app.
//
// Scene file (little-endian), version 3:
//   'GTS3', u16 W, u16 H, u8 flags (1 zones night, 2 scan, 4 terminator,
//   8 night dots, 16 minute flag, 32 time callout, 64 the world band's
//   sliding tape, 128 with the world sliding too), u8 body (0 Sun, 1 Moon, 2 satellite,
//   3 station), i8 forward, u8 view (0 the hour chart, 1 the world band, 2
//   the whole day),
//   i32 hour start (Unix seconds)
//   palette: water land coast contour shelf grid route ink mark (x3 zones),
//   then space spaceInk screen waterline terminator nightDots, tints[5],
//   depths[2], all as Pebble GColor8 (0b11rrggbb)
//   f64 rowCos[H], rowSin[H], colCos[W], colSin[W]
//   f64 c1x, normal x, normal y; i16 zulu x, zulu baseline, pass line x,
//   pass line baseline, height's right edge, height's baseline
//   the world band's tape: i16 x0, x1, baseline, the minutes' least and
//   greatest x; home: i16 x, y (-1000 without), box x, y, w, h
//   the day's time callout: i16 the track's least x less 8, the top and
//   bottom it keeps within (the hour chart's callout: 0), char hour[3] (the
//   hour's figures as the callout sets them, NUL-padded), u8 the figures'
//   style (0 colon, 1 plain, 2 even, 3 mono, 4 accent), u8 n and n boxes
//   (i16 x, y, w, h) of lettering its leader breaks for
//   the ink's anchors (symbols inked by one point's night, not their own
//   pixels'): i16 this hour's and the next hour's stations x, y; u8 n and n
//   network stations (i16 x, y)
//   the sliding tape's hours: char this hour[3], next hour[3] (NUL-padded);
//   u8 with the world sliding, the minute the scene is for (255 otherwise)
//   events: u8 n; per event i16 the fix's x, y, its name's x, the name's
//   box x, y, w, h, u8 whether the name is clear of what stays all hour,
//   char name[5]
//   60 minutes: f64 sun[3], f64 marker x, y, f64 moon fraction, u8 waxing,
//   char zulu[5], u8 minute text[2], char top line[24] (a satellite's pass
//   line, NUL-padded, '°' as 0x7f; empty when the line is fixed), i16 the
//   tape's index x, char height[8] ("412 KM", NUL-padded), u8 home's
//   acquisition circle (255 for none)
//   u16 circle count, then per circle u16 n and n (u8 x, u8 y)
//   u16 track count, i32 the first point's seconds from the hour, i16 the
//   seconds between points, then per point i16 x, y (rounded), u8 flags:
//   the step from the point before (1 steep, 2 a jump across the band's
//   seam), 4 within the hour
//   u16 row offsets[H+1] into the runs, then the class plane as runs of
//   (u8 count, u8 class) that never cross a row. Each class byte: low
//   nibble ground class, high nibble layer (0 plain,
//   1 contour, 2 coast, 3 shelf, 4 waterline, 5 knockout, 6 grid, 7 route,
//   8 ink, 9 mark, 10 ink over space, 11 grid drawn after home's
//   acquisition circle, 12 knockout and 13 ink drawn before the route, 14
//   knockout and 15 ink (or mark, round home) drawn after the body)
import {sin,cos} from './fmath.js';
import {EnrouteRenderer,renderEnroute,PLATES,passText,homeCircle,nauticalZone,W,H} from './enroute-render.js';
import {clockParts} from './render.js';
import {position,moonLight,MINUTE} from './ephemeris.js';
import {catalogEntry} from './satellites.js';
import {registerNominal} from './nominal.js';
import {RAD} from './geometry.js';

registerNominal();
// Build one hour's scene from the coastline atlas and the decoded relief.
// Returns the scene bytes, and the renderer and state, which can then draw
// the browser's frames of the same hour.
// Options as the browser's: readout ('flag', 'callout' or off; flag: true is
// 'flag'), numerals (the callout's figures), zone ('utc' or 'body': the
// margin's time), span ('day' or 'hour': QZSS's chart), clock24.
// With tape 'slide' the world scrolls under the index each minute: the
// scene is for one minute of the hour.
// events: [{epoch, label}] (label a five-letter name code, src/events.js).
export function buildScene({atlas,meters,body,start,plate:plateKey,flag=false,readout=flag?'flag':false,numerals='even',zone='utc',span='day',tape='fixed',transfer='off',minute=0,events=[],timeZone='UTC',clock24=true,home=null}){
  const state={body,epoch:start+(tape==='slide'?minute*MINUTE:0),timeZone,clock24,plate:plateKey,home,events,readout:readout==='callout'?true:readout,numerals,zone,span,tape,transfer};
  const r=new EnrouteRenderer(atlas,meters);r.render(state);
  const cam=r.camera,pal=PLATES[plateKey];
  if(cam.fuller)throw new Error('Rolling Fuller is not exported');

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
  const base=renderEnroute({camera:cam,ground:r.ground,relief:r.relief,light:r.light,plate:probe,epoch:start,timeZone,clock24,home:state.home,events,readout:state.readout,numerals,zone,tape,transfer,layers:'base'});
  const LAYER={[PROBE.grid]:6,[PROBE.route]:7,[PROBE.ink]:8,[PROBE.mark]:9,[PROBE.spaceInk]:10,[PROBE.space]:11};
  const key=i=>'#'+[0,1,2].map(k=>base.buf[i*3+k].toString(16).padStart(2,'0')).join('').toUpperCase();
  const classes=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    let layer=base.trace[i]===2?5:base.trace[i]===1?LAYER[key(i)]:base.overlay[i];
    const stage=base.trace[i]?base.stages[i]:0;
    // Space painted over space (the tape's panel) is plain space.
    if(layer===11){if(base.baseClass[i]!==2)throw new Error(`Space over ground at ${i%W},${Math.floor(i/W)}`);layer=0;}
    // Grid over home's acquisition circle: the network's circles.
    if(layer===6&&stage>=1)layer=11;
    // Knockouts and ink from before the route, which its bold line may cover.
    if(base.beforeRoute[i]&&layer===5)layer=12;else if(base.beforeRoute[i]&&layer===8)layer=13;
    // And after the body, which passes under them.
    if(stage===3){if(layer===5)layer=14;else if(layer===8||layer===9||layer===10)layer=15;else if(layer)throw new Error(`Layer ${layer} after the body at ${i%W},${Math.floor(i/W)}`);}
    if(layer===undefined)throw new Error(`Unclassified pixel ${i%W},${Math.floor(i/W)} ${key(i)}`);
    classes[i]=layer<<4|base.baseClass[i];
  }

  const bytes=[],scratch=new DataView(new ArrayBuffer(8)),u8=v=>bytes.push(v&255),i8=v=>u8(v<0?v+256:v),u16=v=>{u8(v);u8(v>>8);},i16=v=>u16(v<0?v+65536:v);
  const i32=v=>{scratch.setInt32(0,v,true);for(let k=0;k<4;k++)bytes.push(scratch.getUint8(k));},f64=v=>{scratch.setFloat64(0,v,true);for(let k=0;k<8;k++)bytes.push(scratch.getUint8(k));};
  const g8=c=>c?0xC0|(c[0]/85)<<4|(c[1]/85)<<2|c[2]/85:0;
  for(const c of 'GTS3')u8(c.charCodeAt(0));
  u16(W);u16(H);
  u8((pal.night==='zones'?1:0)|(pal.scan?2:0)|(pal.terminator?4:0)|(pal.nightDots?8:0)|(readout==='flag'?16:0)|(readout==='callout'?32:0)|(base.tapeAt?.mode==='tape'?64:0)|(base.tapeAt?.mode==='slide'?64|128:0));
  const kind=body==='sun'?0:body==='moon'?1:catalogEntry(body)?.symbol==='satellite'?2:3;u8(kind);
  const [s0,s1]=cam.stations,forward=Math.round(s1.x)>Math.round(s0.x);i8(forward?1:-1);u8(cam.world?1:cam.day?2:0);i32(Math.floor(start/1000));
  for(const k of ['water','land','coast','contour','shelf','grid','route','ink','mark'])for(let z=0;z<3;z++)u8(g8(pal[k][z]));
  for(const k of ['space','spaceInk','screen','waterline','terminator','nightDots'])u8(g8(pal[k]));
  for(let k=0;k<5;k++)u8(g8(pal.tints?.[k]?.[1]));for(let k=0;k<2;k++)u8(g8(pal.depths?.[k]?.[1]));
  // The chart is equidistant cylindrical: latitude by row, longitude by column.
  const rows=[],cols=[];
  for(let y=0;y<H;y++){const lat=cam.toGround(0.5,y+.5).lat*RAD;rows.push([cos(lat),sin(lat)]);}
  for(let x=0;x<W;x++){const lon=cam.toGround(x+.5,0.5).lon*RAD;cols.push([cos(lon),sin(lon)]);}
  for(const [c] of rows)f64(c);for(const [,s] of rows)f64(s);for(const [c] of cols)f64(c);for(const [,s] of cols)f64(s);
  f64(s1.x);f64(cam.normal?.x??0);f64(cam.normal?.y??-1);i16(base.zuluAt.x);i16(base.zuluAt.baseline);
  i16(base.topAt.x);i16(base.topAt.baseline);i16(base.altAt?.right??0);i16(base.altAt?.baseline??0);
  const fixed=base.tapeAt&&base.tapeAt.x0!==undefined?base.tapeAt:null;for(const v of fixed?[fixed.x0,fixed.x1,fixed.baseline,fixed.inner[0],fixed.inner[1]]:[0,0,0,0,0])i16(v);
  const hm=base.home;for(const v of hm?[hm.x,hm.y,hm.box.x,hm.box.y,hm.box.w,hm.box.h]:[-1000,-1000,0,0,0,0])i16(v);
  const co=base.calloutAt;for(const v of co?[Math.floor(co.left),co.top,co.bottom]:[0,0,0])i16(v);
  // The callout's hour, as its figures set it (two figures with 'even' on
  // the 24-hour clock), and the figures' style.
  const hh=numerals==='even'&&clock24?base.hour.padStart(2,'0'):base.hour;
  for(let k=0;k<3;k++)u8(co&&k<hh.length?hh.charCodeAt(k):0);
  u8(['colon','plain','even','mono','accent'].indexOf(numerals));
  u8(co?co.avoid.length:0);for(const b of co?co.avoid:[])for(const v of [b.x,b.y,b.w,b.h])i16(v);
  const an=base.anchors;for(const v of [an.c0.x,an.c0.y,an.c1.x,an.c1.y])i16(v);
  u8(an.stations.length);for(const q of an.stations){i16(q.x);i16(q.y);}
  for(const t of [base.tapeAt?.hour,base.tapeAt?.next])for(let k=0;k<3;k++)u8(t&&k<t.length?t.charCodeAt(k):0);
  u8(base.tapeAt?.mode==='slide'?minute:255);
  u8(base.fixes.length);for(const f of base.fixes){for(const v of [f.x,f.y,f.lx,f.box.x,f.box.y,f.box.w,f.box.h])i16(v);u8(f.clear?1:0);for(let k=0;k<5;k++)u8(k<f.label.length?f.label.charCodeAt(k):0);}
  // Home's acquisition circle on the world band, which changes with the
  // satellite's height; minutes that plot the same pixels share one.
  const circles=[],circleKeys=new Map();
  for(let m=0;m<60;m++){
    const t=start+m*MINUTE,sun=position('sun',t).dir,b=position(body,t),p=cam.project(b.lat,b.lon),moon=moonLight(t),d=new Date(t);
    for(const v of sun)f64(v);f64(p.x);f64(p.y);f64(moon.fraction);u8(moon.waxing?1:0);
    // The margin's time: Zulu, or the nautical zone's under the body.
    const zoned=zone==='body'?nauticalZone(b.lon):{hours:0,letter:'Z'},z=new Date(t+zoned.hours*3600000);
    for(const c of `${String(z.getUTCHours()).padStart(2,'0')}${String(z.getUTCMinutes()).padStart(2,'0')}${zoned.letter}`)u8(c.charCodeAt(0));
    for(const c of clockParts(t,timeZone).m)u8(c.charCodeAt(0));
    const top=body!=='sun'&&body!=='moon'&&state.home?passText(body,state.home,t,timeZone):'';
    for(let k=0;k<24;k++)u8(k<top.length?(top[k]==='°'?0x7f:top.charCodeAt(k)):0);
    const [x0,x1]=fixed?[fixed.x0,fixed.x1]:[0,0],ix=fixed?Math.round(forward?x0+(x1-x0)*m/60:x1-(x1-x0)*m/60):0;i16(ix);
    const height=cam.world?`${Math.round(b.altitude)} KM`:'';for(let k=0;k<8;k++)u8(k<height.length?height.charCodeAt(k):0);
    let circle=255;
    if(cam.world&&state.home){
      const px=homeCircle(cam,state.home,b.altitude),k=px.map(q=>q.join(',')).join(' ');
      if(!circleKeys.has(k)){circleKeys.set(k,circles.length);circles.push(px);}
      circle=circleKeys.get(k);
    }
    u8(circle);
  }
  u16(circles.length);for(const px of circles){u16(px.length);for(const [x,y] of px){u8(x);u8(y);}}
  const t0=Math.round((cam.track[0].epoch-start)/1000),dt=Math.round((cam.track[1].epoch-cam.track[0].epoch)/1000);
  u16(cam.track.length);i32(t0);i16(dt);cam.track.forEach((p,k)=>{
    if(Math.round((p.epoch-start)/1000)!==t0+k*dt)throw new Error('The track is not evenly spaced');
    const q=cam.track[k-1],step=!q?0:(Math.abs(p.y-q.y)>Math.abs(p.x-q.x)?1:0)|(Math.abs(p.x-q.x)>W/2?2:0);
    i16(Math.round(p.x));i16(Math.round(p.y));u8(step|(p.hour?4:0));
  });
  // The class plane as row runs: charts are mostly flat, so this is a
  // quarter of the plane's size or less.
  const runs=[],offsets=[0];
  for(let y=0;y<H;y++){for(let x=0;x<W;){let k=1;while(x+k<W&&k<255&&classes[y*W+x+k]===classes[y*W+x])k++;runs.push(k,classes[y*W+x]);x+=k;}offsets.push(runs.length);}
  for(const o of offsets)u16(o);
  bytes.push(...runs);
  return {scene:Uint8Array.from(bytes),renderer:r,state};
}
