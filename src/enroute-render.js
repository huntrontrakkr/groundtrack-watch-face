// Study 06 — Enroute. The chart language of the golden age of flight and
// spaceflight: contour relief from real elevation data, a magenta route
// between two reporting points, a compass rose on this hour's station, the
// time set like a chart's maximum elevation figure, and the tracking
// stations of NASA's early networks. Whole RGB222 pixels in a plain buffer.
import {sin,cos,asin,acos,atan2,hypot} from './fmath.js';
import {position,moonLight,MINUTE} from './ephemeris.js';
import {dot,RAD,direction} from './geometry.js';
import {clockParts} from './render.js';
import {SUNRISE_SINE,CIVIL_TWILIGHT_SINE} from './solar.js';
import {chartCamera,groundLayer,lightLayer,civilHour,LAND,SPACE,COAST,W,H} from './chart-render.js';
import {reliefAt} from './relief.js';
import {rollCamera} from './roll.js';
import numerals from '../data/enroute-font.json' with {type:'json'};
import departure from '../data/departure-font.json' with {type:'json'};
import network from '../data/tracking-stations.json' with {type:'json'};
import {catalogEntry,elementsFor,viewOf} from './satellites.js';
import {riseSet,nextPass,reach} from './home.js';

export {W,H};
const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const inks=list=>list.map(hex),SHELF_DEPTH=-200;
// Printing plates. Each ink has a day, dusk and night value; paper plates
// keep their day colors and take a dot screen through twilight and night.
export const PLATES={
  enroute:{name:'Enroute',note:'IFR chart: white paper, blue and black',night:'screen',
    water:inks(['#AAFFFF','#55AAAA','#0055AA']),land:inks(['#FFFFFF','#AAAAAA','#555555']),coast:inks(['#0055AA','#005555','#55AAFF']),
    contour:inks(['#AAAAAA','#555555','#AAAAAA']),shelf:inks(['#55AAFF','#0055AA','#55AAFF']),grid:inks(['#0055AA','#005555','#55AAFF']),
    route:inks(['#FF00AA','#AA0055','#FF55FF']),ink:inks(['#000055','#000055','#FFFFFF']),mark:inks(['#000000','#000000','#FFFFFF']),
    screen:hex('#0055AA'),space:hex('#FFFFFF'),spaceInk:hex('#000055')},
  sectional:{name:'Sectional',note:'VFR chart: cream paper, blue type',night:'screen',
    water:inks(['#AAFFFF','#55AAAA','#000055']),land:inks(['#FFFFAA','#AAAA55','#005555']),coast:inks(['#0055AA','#005555','#0055AA']),
    contour:inks(['#AAAA55','#555500','#0055AA']),shelf:inks(['#55AAFF','#0055AA','#0055AA']),grid:inks(['#0055AA','#005555','#0055AA']),
    route:inks(['#FF00AA','#AA0055','#FF55FF']),ink:inks(['#0055AA','#000055','#AAFFFF']),mark:inks(['#000055','#000055','#FFFFAA']),
    screen:hex('#000055'),space:hex('#FFFFFF'),spaceInk:hex('#0055AA')},
  console:{name:'Console',note:'Mission control: lit lines on dark glass',night:'zones',
    water:inks(['#000055','#000055','#000000']),land:inks(['#005555','#005555','#000055']),coast:inks(['#55AAAA','#55AAAA','#0055AA']),
    contour:inks(['#00AAAA','#00AAAA','#0055AA']),shelf:inks(['#0055AA','#0055AA','#000055']),grid:inks(['#0055AA','#0055AA','#0055AA']),
    route:inks(['#FFAA00','#FFAA00','#FFAA00']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFAA']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // After the jet navigation charts: layer tints by height, green lowland
  // through tan to brown, and the sea tinted deeper off the shelf.
  hypsometric:{name:'Hypsometric',note:'Jet navigation chart: layer tints by height',night:'screen',
    tints:[[300,hex('#AAFFAA')],[1000,hex('#FFFFAA')],[2000,hex('#FFAA55')],[3500,hex('#AA5500')],[Infinity,hex('#AA5555')]],depths:[[SHELF_DEPTH,hex('#AAFFFF')],[-Infinity,hex('#55AAFF')]],
    water:inks(['#AAFFFF','#AAFFFF','#AAFFFF']),land:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),coast:inks(['#0055AA','#0055AA','#0055AA']),
    contour:inks(['#555500','#555500','#555500']),shelf:inks(['#0055AA','#0055AA','#0055AA']),grid:inks(['#005555','#005555','#005555']),
    route:inks(['#FF00AA','#FF00AA','#FF00AA']),ink:inks(['#000055','#000055','#000055']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#000055'),space:hex('#FFFFFF'),spaceInk:hex('#000055')},
  // Red cockpit lighting, which keeps the eye's night vision: reds only,
  // drawn as outlines on black; coasts dim where it is night.
  red:{name:'Night red',note:'Cockpit red: every ink a red, nothing to dazzle',night:'zones',terminator:hex('#FF5555'),nightDots:hex('#AA0000'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#000000','#000000','#000000']),coast:inks(['#AA0000','#AA0000','#550000']),
    contour:inks(['#550000','#550000','#550000']),shelf:inks(['#550000','#550000','#550000']),grid:inks(['#550000','#550000','#550000']),
    route:inks(['#FF0000','#FF0000','#FF0000']),ink:inks(['#FF5555','#FF5555','#FF5555']),mark:inks(['#FFAAAA','#FFAAAA','#FFAAAA']),
    space:hex('#000000'),spaceInk:hex('#FF5555')},
  // The green phosphor of the consoles: one green at several brightnesses,
  // and night drawn with dark scan lines, dusk with every fourth line.
  crt:{name:'Green CRT',note:'Console phosphor: one green, night in scan lines',night:'zones',scan:true,terminator:hex('#55FF55'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#005500','#005500','#005500']),coast:inks(['#00AA00','#00AA00','#00AA00']),
    contour:inks(['#00AA00','#00AA00','#00AA00']),shelf:inks(['#005500','#005500','#005500']),grid:inks(['#005500','#005500','#005500']),
    route:inks(['#00FF00','#00FF00','#00FF00']),ink:inks(['#AAFFAA','#AAFFAA','#AAFFAA']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#55FF55')},
  // For bright sun: black on white only. A band of waterlines follows the
  // coast, as on one-color charts; contours are dotted and the route is
  // cased in white so it leads.
  sunlight:{name:'Sunlight',note:'One ink: black on white, water lined',night:'screen',mono:true,waterline:hex('#000000'),dots:true,
    water:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),land:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),coast:inks(['#000000','#000000','#000000']),
    contour:inks(['#000000','#000000','#000000']),shelf:inks(['#000000','#000000','#000000']),grid:inks(['#000000','#000000','#000000']),
    route:inks(['#000000','#000000','#000000']),ink:inks(['#000000','#000000','#000000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#000000'),space:hex('#FFFFFF'),spaceInk:hex('#000000')}
};
// Contours in meters; the lowest is dotted, as an intermediate contour.
export const CONTOURS=[500,1000,2000,3000,4000,5000],SHELF=-200;
// Acquisition circle: ground range at which a 410 km orbit rises 5 degrees
// above a station's horizon (about 15.6 degrees of arc).
const EARTH=6371,ORBIT=410,MASK=5*RAD;
export const ACQUISITION=(acos(EARTH*cos(MASK)/(EARTH+ORBIT))-MASK)/RAD;
export const NUMERALS=['colon','plain','even','mono','accent'];
export const FIGURE={scale:40,hour:80,hourTwo:72,minute:28,callout:28,calloutMinute:20};
// The time scale registers with the route: its hour marks stand over the
// two stations, 120 px apart on the zoomed charts, so each minute is exactly
// two pixels and each graduation sits over its minute on the route. The ISS
// world band spans 180 px, three pixels a minute.
export const SPAN=120,SCALE={x0:10,x1:190,baseline:46,panel:67};
// Chart lettering: Departure Mono, drawn on the display's own pixel grid.
const LABEL=departure.regular;

// While a base layer is exported, every plotted pixel is marked, so the
// native renderer can tell drawn symbols from untouched ground, and with the
// stage of the drawing it was last drawn in: 0 the graticule, 1 the network
// (after home's acquisition circle), 2 the route and what follows, 3 all
// drawn after the body, which the body passes under.
let TRACE=null,EARLY=null,STAGE=null,early=false,stage=0;
function plot(buf,x,y,c){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=W||y>=H)return;const i=(y*W+x)*3;buf[i]=c[0];buf[i+1]=c[1];buf[i+2]=c[2];if(TRACE){TRACE[i/3]=1;EARLY[i/3]=early?1:0;STAGE[i/3]=stage;}}
function segment(a,b,fn){
  let x=Math.round(a.x),y=Math.round(a.y);const xx=Math.round(b.x),yy=Math.round(b.y);
  const dx=Math.abs(xx-x),sx=x<xx?1:-1,dy=-Math.abs(yy-y),sy=y<yy?1:-1;let err=dx+dy;
  for(let n=0;n<4000;n++){fn(x,y);if(x===xx&&y===yy)break;const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}
}
const textPixels=(font,text,x,baseline)=>{
  const out=[];let cx=Math.round(x);
  for(const c of text){const g=font[c];for(const [rx,ry,len] of g.r)for(let k=0;k<len;k++)out.push([cx+g.l+rx+k,Math.round(baseline)-g.t+ry]);cx+=g.a;}
  return out;
};
const textWidth=(font,text)=>[...text].reduce((s,c)=>s+font[c].a,0);
const gapFor=size=>Math.round(size/16);
// The figure set is digits only; the colon is drawn to match: two rounded
// square dots the weight of the strokes, one on the baseline and one at
// the height of the figures' middle bar.
const colons=new Map();
function glyph(size,c){
  const set=numerals.sizes[size];if(c!==':')return set[c];
  if(!colons.has(size)){
    const h=set['0'].height,d=Math.max(3,Math.round(h/7)),top=Math.round(h*.3),rows=[];
    for(let y=0;y<h;y++){const r=y>=top&&y<top+d?y-top:y>=h-d?y-(h-d):-1;rows.push(r<0?'.'.repeat(d):[...Array(d)].map((_,x)=>(x===0||x===d-1)&&(r===0||r===d-1)&&d>3?'.':'#').join(''));}
    colons.set(size,{width:d,height:h,rows});
  }
  return colons.get(size);
}
const runWidth=(text,size)=>[...text].reduce((s,c)=>s+glyph(size,c).width,0)+gapFor(size)*(text.length-1);
const runHeight=size=>numerals.sizes[size]['0'].height;
// Figures sit on a shared baseline; the tallest glyph sets the top.
function figurePixels(text,size,x,y){
  const h=Math.max(...[...text].map(c=>glyph(size,c).height)),out=[];let cx=x;
  for(const c of text){const g=glyph(size,c);for(let yy=0;yy<g.height;yy++)for(let xx=0;xx<g.width;xx++)if(g.rows[yy][xx]==='#')out.push([cx+xx,y+h-g.height+yy]);cx+=g.width+gapFor(size);}
  return out;
}
// Leaders are routed like circuit traces: a 45° run leaving the start,
// then a straight horizontal or vertical run to the end, and no other
// angle. The pixels within `clear` of the start (the body's knockout) are
// left out.
export function circuitPath(a,b,clearance=0){
  const ax=Math.round(a.x),ay=Math.round(a.y),bx=Math.round(b.x),by=Math.round(b.y),dx=bx-ax,dy=by-ay,diag=Math.min(Math.abs(dx),Math.abs(dy)),sx=Math.sign(dx),sy=Math.sign(dy),out=[];
  let x=ax,y=ay;out.push([x,y]);
  for(let k=0;k<diag;k++){x+=sx;y+=sy;out.push([x,y]);}
  while(x!==bx||y!==by){if(x!==bx)x+=sx;else y+=sy;out.push([x,y]);}
  return out.filter(([px,py])=>hypot(px-ax,py-ay)>=clearance);
}
const bounds=pixels=>{
  if(!pixels.length)return null;
  const xs=pixels.map(p=>p[0]),ys=pixels.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x+1,h:Math.max(...ys)-y+1};
};
// The point at an angular distance and bearing from a station.
export function destination(lat,lon,distance,bearing){
  const p=lat*RAD,d=distance*RAD,b=bearing*RAD,q=asin(sin(p)*cos(d)+cos(p)*sin(d)*cos(b));
  return {lat:q/RAD,lon:lon+atan2(sin(b)*sin(d)*cos(p),cos(d)-sin(p)*sin(q))/RAD};
}
// Home's acquisition circle for a satellite at altitude on the world views:
// the pixels plotted, every 3° of bearing, on the copy of each point
// nearest home's own.
export function homeCircle(camera,home,altitude){
  const q=camera.project(home.lat,home.lon),x=Math.round(q.x),r=reach(altitude),{top,bottom}=camera.band,out=[];
  for(let bearing=0;bearing<360;bearing+=3){
    const g=destination(home.lat,home.lon,r,bearing),c=camera.project(g.lat,g.lon);
    if(Math.abs(c.x-x)<W/2&&c.y>=top&&c.y<=bottom&&!camera.outside?.(c.x,c.y)){const px=Math.round(c.x),py=Math.round(c.y);if(px>=0&&py>=0&&px<W&&py<H)out.push([px,py]);}
  }
  return out;
}

// Height for each pixel, smoothed three times so contours read as drawn,
// generalized lines rather than the atlas's quarter-degree cells.
export function reliefLayer(camera,meters){
  let e=new Float32Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const g=camera.toGround(x+.5,y+.5);e[y*W+x]=Math.abs(g.lat)<=90?reliefAt(meters,g.lat,g.lon):0;}
  for(let pass=0;pass<3;pass++){
    const t=new Float32Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,n=0;for(let d=-1;d<=1;d++){const xx=x+d;if(xx>=0&&xx<W){s+=e[y*W+xx];n++;}}t[y*W+x]=s/n;}
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){let s=0,n=0;for(let d=-1;d<=1;d++){const yy=y+d;if(yy>=0&&yy<H){s+=t[yy*W+x];n++;}}e[y*W+x]=s/n;}
  }
  return e;
}
// A contour pixel is on the high side of a level that a neighbor falls below.
export function contourLevel(relief,land,i,levels=CONTOURS){
  if(!land[i])return 0;
  const level=v=>levels.filter(c=>v>=c).length,k=level(relief[i]);
  if(!k)return 0;
  for(const j of [i-1,i+1,i-W,i+W])if(j>=0&&j<W*H&&land[j]&&level(relief[j])<k)return levels[k-1];
  return 0;
}

// A compulsory reporting point: the filled triangle.
const FIX=['....#....','...###...','...###...','..#####..','..#####..','.#######.','#########'];
// An airport with services: a ring with four ticks, as on a sectional.
const AIRPORT=['.....#.....','.....#.....','....###....','...#...#...','..#.....#..','###.....###','..#.....#..','...#...#...','....###....','.....#.....','.....#.....'];
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const HEXAGON=['..###..','.#...#.','#.....#','.#...#.','..###..'],TRIANGLE=['....#....','...#.#...','...#.#...','..#...#..','..#...#..','.#.....#.','#########'];
// layers:'base' renders only what stays fixed through the hour, for the
// native watch renderer: no night, no body, no bold route behind it, no
// minute readout and no Zulu time. It also returns each pixel's ground
// class and what, if anything, was drawn over it.
export function renderEnroute({camera,ground,relief,light:zones,plate,epoch,timeZone,clock24,readout=false,home=null,events=[],tape='fixed',numerals='colon',zone='utc',layers='all'}){
  const baseOnly=layers==='base';if(baseOnly){readout=false;}
  // Pixels drawn before the route (early) may be covered by its bold line.
  const trace=baseOnly?new Uint8Array(W*H):null,overlay=baseOnly?new Uint8Array(W*H):null,beforeRoute=baseOnly?new Uint8Array(W*H):null,stages=baseOnly?new Uint8Array(W*H):null;TRACE=trace;EARLY=beforeRoute;STAGE=stages;early=true;stage=0;
  try{return drawEnroute();}finally{TRACE=null;EARLY=null;STAGE=null;}
  function drawEnroute(){
  const pal=typeof plate==='string'?PLATES[plate]:plate,buf=new Uint8ClampedArray(W*H*3),mat=ground.material,sun=position('sun',Math.floor(epoch/MINUTE)*MINUTE).dir;
  const light=pal.night==='screen'?new Uint8Array(W*H):zones,land=mat.map(m=>m===LAND?1:0);
  const zoneAt=(x,y)=>light[Math.max(0,Math.min(H-1,Math.round(y)))*W+Math.max(0,Math.min(W-1,Math.round(x)))];
  const tint=(table,v)=>table.find(([limit])=>table[0][0]<table.at(-1)[0]?v<limit:v>=limit)[1];
  const base=i=>mat[i]===SPACE?pal.space:pal.tints&&land[i]?tint(pal.tints,relief[i]):pal.depths&&!land[i]?tint(pal.depths,relief[i]):(land[i]?pal.land:pal.water)[light[i]];
  const ink=key=>(x,y)=>pal[key][zoneAt(x,y)];
  // Ground: water, land, coastline, contours and the continental shelf edge.
  // A whole-orbit Fuller sheet keeps only the 2,000 and 4,000 m contours.
  const levels=camera.wide?[2000,4000]:CONTOURS;
  // Distance from the shore, out to a few pixels, for waterlining.
  let shore=null;
  // At world scale coasts crowd together, so a one-ink plate keeps its
  // waterlines and shelf edge for the zoomed charts only.
  const sparse=pal.mono&&(camera.wide||camera.world);
  if(pal.waterline&&!sparse){
    shore=new Uint8Array(W*H).fill(255);let edge=[];
    for(let i=0;i<W*H;i++)if(land[i]&&mat[i]!==SPACE){shore[i]=0;edge.push(i);}
    for(let d=1;d<=5&&edge.length;d++){const next=[];for(const i of edge){const x=i%W;for(const j of [x>0?i-1:-1,x<W-1?i+1:-1,i-W,i+W])if(j>=0&&j<W*H&&shore[j]===255){shore[j]=d;next.push(j);}}edge=next;}
  }
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,z=light[i];let c=base(i);
    if(mat[i]!==SPACE){
      const level=contourLevel(relief,land,i,levels);
      if(level&&((level!==CONTOURS[0]&&!pal.dots)||((x+y)&1)===0)){c=pal.contour[z];if(overlay)overlay[i]=1;}
      else if(mat[i]===COAST){c=pal.coast[z];if(overlay)overlay[i]=2;}
      else if(!sparse&&!land[i]&&relief[i]<SHELF&&((x+y)&1)===0&&[i-1,i+1,i-W,i+W].some(j=>j>=0&&j<W*H&&!land[j]&&relief[j]>=SHELF)){c=pal.shelf[z];if(overlay)overlay[i]=3;}
      else if(shore&&!land[i]&&shore[i]>=2&&shore[i]<=5&&y%3===0){c=pal.waterline;if(overlay)overlay[i]=4;}
    }
    // Console night: dark scan lines, every other line by night and every
    // fourth through twilight.
    if(!baseOnly&&pal.scan&&z&&y%(z===2?2:4)===1)c=pal.space;
    // The dark plates draw the terminator itself, as the plotboards did:
    // dashed where the Sun sets, dotted where twilight ends.
    if(!baseOnly&&pal.terminator&&ground.dirs[i]){
      // Traced from the Sun's height at each pixel, not the dithered zones.
      const h=dot(ground.dirs[i],sun),cross=level=>[x>0?i-1:-1,x<W-1?i+1:-1,i-W,y<H-1?i+W:-1].some(j=>j>=0&&ground.dirs[j]&&(dot(ground.dirs[j],sun)>=level)!==(h>=level));
      if(cross(SUNRISE_SINE)&&((x+y)>>1)%3!==2)c=pal.terminator;
      else if(cross(CIVIL_TWILIGHT_SINE)&&(x+y)%3===0)c=pal.terminator;
      // Outline plates tint the night side with a sparse dot screen.
      else if(pal.nightDots&&z===2&&x%4===0&&y%4===((x>>2)&1)*2)c=pal.nightDots;
    }
    buf.set(c,i*3);
  }
  // Paper plates show night as a regular dot tint, deepening through civil
  // twilight to a 25 percent screen, printed under every symbol.
  if(!baseOnly&&pal.night==='screen')for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const d=ground.dirs[y*W+x];if(!d)continue;
    const t=Math.max(0,Math.min(1,(SUNRISE_SINE-dot(d,sun))/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE)));
    if(t>0&&BAYER[(y&3)*4+(x&3)]<t*4)plot(buf,x,y,pal.screen);
  }
  // Knockouts clear to plain paper under lettering, as on a printed chart.
  const clear=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<W&&y<H){plot(buf,x,y,base(y*W+x));if(trace)trace[y*W+x]=2;}};
  const letter=(pixels,color,halo=1)=>{
    for(const [a,b] of pixels)for(let dy=-halo;dy<=halo;dy++)for(let dx=-halo;dx<=halo;dx++)clear(a+dx,b+dy);
    for(const [a,b] of pixels)plot(buf,a,b,mat[Math.max(0,Math.min(H-1,b))*W+Math.max(0,Math.min(W-1,a))]===SPACE?pal.spaceInk:color(a,b));
  };
  // Graticule: small crosses every five degrees (thirty on the world band)
  // and degree ticks along the edges of the map, like a chart's neatline.
  const step=camera.world?30:camera.wide?10:5,minor=camera.world?10:camera.wide?5:1,{bottom}=camera.band,top=camera.band.top,inBand=y=>y>=top&&y<=bottom;
  if(camera.fuller){
    // Rolling Fuller: the net's outline in ink, folds inside it dotted.
    for(const t of camera.tiles)for(const e of t.edges){
      let n=0;segment(e.a,e.b,(x,y)=>{if(e.outline)plot(buf,x,y,pal.spaceInk);else if(e.cut||(n++%4===0))plot(buf,x,y,ink('grid')(x,y));});
    }
  }else{
  const g0=camera.toGround(0,bottom),g1=camera.toGround(W,top);
  for(let lat=Math.ceil(g0.lat/step)*step;lat<=g1.lat;lat+=step)for(let lon=Math.ceil(g0.lon/step)*step;lon<=g1.lon;lon+=step){
    const p=camera.toScreen(lat,lon),x=Math.round(p.x),y=Math.round(p.y);if(!inBand(y))continue;
    for(let d=-2;d<=2;d++){plot(buf,x+d,y,ink('grid')(x,y));plot(buf,x,y+d,ink('grid')(x,y));}
  }
  for(let lon=Math.ceil(g0.lon/minor)*minor;lon<=g1.lon;lon+=minor){
    const x=Math.round(camera.toScreen(0,lon).x),len=lon%step===0?4:2;
    for(let d=0;d<len;d++){plot(buf,x,top+d,ink('grid')(x,top+d));plot(buf,x,bottom-d,ink('grid')(x,bottom-d));}
  }
  for(let lat=Math.ceil(g0.lat/minor)*minor;lat<=g1.lat;lat+=minor){
    const y=Math.round(camera.toScreen(lat,0).y),len=lat%step===0?4:2;if(!inBand(y))continue;
    for(let d=0;d<len;d++){plot(buf,d,y,ink('grid')(d,y));plot(buf,W-1-d,y,ink('grid')(W-1-d,y));}
  }
  }
  // Tracking stations of the Mercury and Apollo networks, as small circled
  // points with their network codes. On the world band each also shows its
  // acquisition circle, as on the plotboards of the mission control rooms.
  const stations=[],taken=[],type=[];
  // The margins' lettering is reserved: the date line under the chart and,
  // with a home, the rise, set or pass line over it.
  const overlaps=box=>taken.some(b=>b.x<box.x+box.w&&box.x<b.x+b.w&&b.y<box.y+box.h&&box.y<b.y+b.h);
  if(!camera.world){taken.push({x:0,y:H-16,w:W,h:16});if(home)taken.push({x:0,y:0,w:W,h:14});}
  // Home: the wearer's own station, drawn first so the network gives way to
  // it. It takes the chart's airport symbol, a ring with four ticks, and on
  // the world views the acquisition circle within which the satellite
  // clears 10° above the home horizon.
  let homeMark=null;
  if(home){
    const q=camera.project(home.lat,home.lon),x=Math.round(q.x),y=Math.round(q.y),col=ink('mark');
    // It changes with the satellite's height: a base layer leaves it to
    // the native renderer, which draws it each minute.
    if(camera.world&&!baseOnly||camera.wide&&!camera.day)for(const [cx,cy] of homeCircle(camera,home,position(camera.body,epoch).altitude))plot(buf,cx,cy,col(cx,cy));
    const w=textWidth(LABEL,home.code),right=x+7+w<W-3,box={x:right?x-5:x-8-w,y:y-6,w:w+13,h:13};
    if(x>=4&&x<=W-5&&y>=top+6&&y<=bottom-6&&!camera.outside?.(x,y)&&!overlaps(box)){
      // Placed now so the network gives way; drawn last, over everything.
      const code=textPixels(LABEL,home.code,right?x+7:x-7-w,y+4);
      taken.push(box);type.push(bounds(code));homeMark={x,y,box,code};
    }
  }
  // On a whole-orbit Fuller sheet only the stations that can hear the
  // satellite during this hour are shown, each with its acquisition circle.
  stage=1;
  const heard=s=>camera.track.some(p=>p.hour&&dot(p.dir,direction(s.lat,s.lon))>=Math.cos(ACQUISITION*RAD));
  for(const s of network.stations){
    if(camera.day||(camera.wide&&!heard(s)))continue;
    const p=camera.project(s.lat,s.lon),x=Math.round(p.x),y=Math.round(p.y);
    if(x<4||x>W-5||y<top+6||y>bottom-6)continue;
    const w=textWidth(LABEL,s.code),right=x+5+w<W-3,box={x:right?x-3:x-6-w,y:y-5,w:w+9,h:11};
    if(overlaps(box))continue;
    taken.push(box);stations.push({code:s.code,x,y,box});
    if(camera.world||camera.wide)for(let bearing=0;bearing<360;bearing+=5){
      const q=destination(s.lat,s.lon,ACQUISITION,bearing),r=camera.project(q.lat,q.lon);
      if(Math.abs(r.x-x)<W/2&&inBand(r.y))plot(buf,r.x,r.y,ink('grid')(r.x,r.y));
    }
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const r=dx*dx+dy*dy;if(r<=5&&r>=3)plot(buf,x+dx,y+dy,ink('ink')(x,y));}
    plot(buf,x,y,ink('ink')(x,y));
    const code=textPixels(LABEL,s.code,right?x+5:x-5-w,y+4);type.push(bounds(code));letter(code,ink('ink'));
  }
  // The route, as the magenta line: bold behind the present, fine ahead,
  // dashed before and after the hour. Ticks every five minutes; the
  // quarter hours are longer and carry their minute, like a plotted track.
  const track=camera.track,now=baseOnly?-Infinity:Math.floor(epoch/MINUTE)*MINUTE,[s0,s1]=camera.stations,jump=(a,b)=>Math.abs(b.x-a.x)>W/2;
  // A one-ink plate cases the route in white, so it reads over waterlines.
  // On the Fuller sheets, where the route is small against busy faces, it
  // is also drawn heavier: two pixels ahead of the body, three behind.
  const heavy=pal.mono&&camera.fuller,casing=heavy?2:1;
  if(pal.mono)for(let i=1;i<track.length;i++){
    const a=track[i-1],b=track[i];if(jump(a,b)||!(a.hour&&b.hour))continue;
    segment(a,b,(x,y)=>{for(let dy=-casing-1;dy<=casing+1;dy++)for(let dx=-casing;dx<=casing;dx++)clear(x+dx,y+dy);});
  }
  early=false;stage=2;
  for(let i=1;i<track.length;i++){
    const a=track[i-1],b=track[i];if(jump(a,b))continue;
    const hour=a.hour&&b.hour,bold=hour&&b.epoch<=now,steep=Math.abs(b.y-a.y)>Math.abs(b.x-a.x);
    segment(a,b,(x,y)=>{
      if(!hour){if(((x+y)>>1)%2===0)plot(buf,x,y,ink('route')(x,y));return;}
      plot(buf,x,y,ink('route')(x,y));if(bold||heavy)plot(buf,steep?x+1:x,steep?y:y-1,ink('route')(x,y));
      if(bold&&heavy)plot(buf,steep?x-1:x,steep?y:y+1,ink('route')(x,y));
    });
  }
  // On the zoomed charts the route is itself the scale: a graduation every
  // minute, longer every five and fifteen, the quarters numbered beneath.
  // The world band keeps five-minute ties; its scale is in the panel above.
  // A whole-day strip is graduated in hours instead: a tick every hour,
  // longer and numbered every three, longest at the two midnights.
  const dayLabels=[];
  if(camera.day)for(const p of camera.day.hours){
    const i=track.indexOf(p),a=track[Math.max(0,i-1)],b=track[Math.min(track.length-1,i+1)],len=hypot(b.x-a.x,b.y-a.y)||1;
    let nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;if(ny<0){nx=-nx;ny=-ny;}
    const hr=Math.round((p.epoch-camera.day.start)/3600000),size=hr%24===0?7:hr%3===0?5:3;
    for(let s=1;s<=size;s++)plot(buf,p.x+nx*s,p.y+ny*s,ink('route')(p.x,p.y));
    if(hr%3===0){
      // Where a day's track crosses itself (QZSS's figure-8) two hours meet;
      // the later label gives way.
      const hh=Number(clockParts(p.epoch,timeZone).h),label=String(clock24?(hr===24?24:hh):hh%12||12),lw=textWidth(LABEL,label),q=textPixels(LABEL,label,Math.round(p.x+nx*9-lw/2)+1,Math.round(p.y+ny*9+9)),box=bounds(q);
      if(!dayLabels.some(o=>!(o.x+o.w+6<=box.x||box.x+box.w+6<=o.x||o.y+o.h+4<=box.y||box.y+box.h+4<=o.y))){dayLabels.push(box);type.push(box);letter(q,ink('route'),pal.mono?1:0);}
    }
  }
  for(let i=1;i<track.length-1&&!camera.day;i++){
    const p=track[i];if(!p.hour)continue;const m=Math.round((p.epoch-s0.epoch)/MINUTE);
    if((p.epoch-s0.epoch)%MINUTE||m<=0||m>=60||(camera.world&&m%5))continue;
    const a=track[i-1],b=track[i+1],len=hypot(b.x-a.x,b.y-a.y)||1;let nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;if(camera.normal?nx*camera.normal.x+ny*camera.normal.y>0:ny<0){nx=-nx;ny=-ny;}
    const size=camera.world?(m%15===0?4:2):m%15===0?6:m%5===0?4:2;for(let s=1;s<=size;s++)plot(buf,p.x+nx*s,p.y+ny*s,ink('route')(p.x,p.y));
    if(!camera.world&&m%15===0){const label=String(m),lw=textWidth(LABEL,label),q=textPixels(LABEL,label,Math.round(p.x+nx*8-lw/2)+1,Math.round(p.y+ny*8+9));type.push(bounds(q));letter(q,ink('route'),pal.mono?1:0);}
  }
  // This hour's station is a VOR: a hexagon inside a compass rose, north up.
  // The next hour is an open triangle, a reporting point.
  const c0={x:Math.round(s0.x),y:Math.round(s0.y)},c1={x:Math.round(s1.x),y:Math.round(s1.y)},col=ink('ink');
  if(!camera.world&&!camera.day){
    // The rose turns to true north at the station; north is up on the
    // cylindrical charts, and anywhere on a rolled Fuller sheet.
    const R=16,g=s0,q0=camera.project(g.lat,g.lon),q1=camera.project(Math.min(89.9,g.lat+.5),g.lon),nl=hypot(q1.x-q0.x,q1.y-q0.y)||1;
    const north=camera.fuller?Math.atan2((q1.x-q0.x)/nl,-(q1.y-q0.y)/nl):0,at=(t,r)=>[c0.x+Math.round(sin(t+north)*r),c0.y-Math.round(cos(t+north)*r)];
    for(let a=0;a<720;a++){const [x,y]=at(a*Math.PI/360,R);plot(buf,x,y,col(c0.x,c0.y));}
    for(let a=0;a<360;a+=30){const len=a%90===0?5:3;for(let r=R-len;r<R;r++){const [x,y]=at(a*RAD,r);plot(buf,x,y,col(c0.x,c0.y));}}
    for(let k=0;k<3;k++)for(let d=-k;d<=k;d++){const r=R+4-k,x=c0.x+Math.round(sin(north)*r+cos(north)*d),y=c0.y-Math.round(cos(north)*r-sin(north)*d);plot(buf,x,y,col(c0.x,c0.y));}
  }
  const symbol=(rows,cx,cy)=>rows.forEach((row,dy)=>[...row].forEach((v,dx)=>{
    const x=cx-(row.length>>1)+dx,y=cy-(rows.length>>1)+dy;
    if(v==='#')plot(buf,x,y,col(cx,cy));else if(row.indexOf('#')<dx&&dx<row.lastIndexOf('#'))clear(x,y);
  }));
  if(!camera.day){symbol(HEXAGON,c0.x,c0.y);plot(buf,c0.x,c0.y,col(c0.x,c0.y));symbol(TRIANGLE,c1.x,c1.y-1);}
  // The present: the body's own symbol on a knockout.
  const body=position(camera.body,epoch),p=camera.project(body.lat,body.lon),mx=Math.round(p.x),my=Math.round(p.y);
  const disc=(cx,cy,r,fn)=>{const n=Math.ceil(r);for(let dy=-n;dy<=n;dy++)for(let dx=-n;dx<=n;dx++)if(dx*dx+dy*dy<=r*r)fn(cx+dx,cy+dy,dx,dy);};
  const mk=ink('mark')(mx,my);
  if(!baseOnly){
  disc(mx,my,6.6,clear);
  if(camera.body==='sun'){disc(mx,my,5.2,(x,y,dx,dy)=>{if(dx*dx+dy*dy>3.6*3.6)plot(buf,x,y,mk);});disc(mx,my,1.5,(x,y)=>plot(buf,x,y,mk));}
  else if(camera.body==='moon'){
    // The Moon in its calculated phase; a rim keeps a new Moon visible.
    const {fraction,waxing}=moonLight(epoch),r=5.2;
    disc(mx,my,r,(x,y,dx,dy)=>{const edge=Math.sqrt(Math.max(0,r*r-dy*dy)),side=waxing?dx:-dx;if(side>=(1-2*fraction)*edge||dx*dx+dy*dy>(r-1.2)**2)plot(buf,x,y,mk);});
  }else if(catalogEntry(camera.body)?.symbol==='satellite'){
    // An uncrewed satellite: a small body between two panels.
    for(let k=-1;k<=1;k++)for(let d=-1;d<=1;d++)plot(buf,mx+d,my+k,mk);
    for(const side of [-1,1]){for(let k=2;k<=3;k++)plot(buf,mx+side*k,my,mk);for(let k=4;k<=6;k++)for(let d=-2;d<=2;d++)if(Math.abs(d)===2||k===4||k===6)plot(buf,mx+side*k,my+d,mk);}
  }else{
    for(let k=-5;k<=5;k++){plot(buf,mx+k,my,mk);if(Math.abs(k)>=3){plot(buf,mx+k,my-1,mk);plot(buf,mx+k,my+1,mk);}}
    for(let k=-2;k<=2;k++)for(let d=-1;d<=1;d++)plot(buf,mx+d,my+k,mk);
  }
  }
  stage=3;
  // The hour. On the zoomed charts the figures stand in the chart over their
  // stations, one size and one baseline: this hour solid, the next outlined,
  // and the body on the graduated route is the index. On the ISS world band
  // the same reading is set in a panel above the map, built like an
  // instrument tape: minute graduations, tall hour marks under the figures
  // and a solid triangular index, running the way the route runs.
  const parts=clockParts(epoch,timeZone),h=Number(parts.h),hour=String(clock24?h:h%12||12),next=String(clock24?(h+1)%24:(h+1)%12||12);
  const forward=c1.x>c0.x,X0=camera.world?(tape==='fixed'?SCALE.x0:0):Math.min(c0.x,c1.x),X1=camera.world?(tape==='fixed'?SCALE.x1:W-1):Math.max(c0.x,c1.x),at=m=>forward?X0+(X1-X0)*m/60:X1-(X1-X0)*m/60;
  const minutes=Math.max(0,Math.min(60,(epoch-s0.epoch)/MINUTE)),ix=Math.round(at(Math.floor(minutes)));
  const outline=(solid,ring)=>{const inside=new Set(solid.map(([a,b])=>a+','+b)),near=[];for(let r=1;r<=ring;r++)near.push([r,0],[-r,0],[0,r],[0,-r]);return solid.filter(([a,b])=>near.some(([dx,dy])=>!inside.has((a+dx)+','+(b+dy))));};
  const place=(end,w)=>Math.max(4,Math.min(W-4-w,Math.round(end-w/2)));
  let hourPixels,nextSolid,index,minuteBox=null,tapeAt=null,calloutAt=null;
  // A time callout, labelled the way a chart labels a feature: the time in
  // full, the minutes smaller on the same baseline as on a cockpit clock,
  // hung from a shoulder, the cartographer's elbow leader, that runs back
  // to the body. The leader is cased with a hairline of paper so it crosses
  // relief cleanly, and it breaks for lettering, as a printed line does.
  // The callout's time, in one of the styles under study: 'colon' (the
  // hour, a colon and smaller minutes), 'plain' (no colon), 'even' (four
  // figures at one size, the minutes outlined like the next hour's
  // figure), 'mono' (minutes in double-size Departure Mono) and 'accent'
  // (smaller minutes in the route's ink). Pixels are relative to the top
  // left of the hour figure; every style shares its baseline.
  const timeFigure=(big,small)=>{
    const fh=runHeight(big),gap=gapFor(big),hh=numerals==='even'&&clock24?hour.padStart(2,'0'):hour,solid=figurePixels(hh,big,0,0),hollow=[],accent=[];
    let x=runWidth(hh,big);const sh=runHeight(small),add=(px,to)=>{for(const q of px)to.push(q);};
    if(numerals==='colon'){x+=gap+1;add(figurePixels(':',small,x,fh-sh),solid);x+=glyph(small,':').width+gap+1;add(figurePixels(parts.m,small,x,fh-sh),solid);x+=runWidth(parts.m,small);}
    else if(numerals==='even'){x+=gap+3;add(outline(figurePixels(parts.m,big,x,0),1),hollow);x+=runWidth(parts.m,big);}
    else if(numerals==='mono'){x+=gap+3;add(textPixels(departure.double,parts.m,x,fh),solid);x+=textWidth(departure.double,parts.m)-2;}
    else{x+=gap+3;add(figurePixels(parts.m,small,x,fh-sh),numerals==='accent'?accent:solid);x+=runWidth(parts.m,small);}
    return {solid,hollow,accent,w:x,h:fh};
  };
  const setTime=(t,fx,fy)=>{
    const at=px=>px.map(([a,b])=>[a+fx,b+fy]),solid=at(t.solid),hollow=at(t.hollow),accent=at(t.accent);
    letter([...solid,...hollow],ink('ink'));if(accent.length)letter(accent,ink('route'));
    return [...solid,...hollow,...accent];
  };
  const calloutWidth=(big,small)=>timeFigure(big,small).w;
  const callout=({big,small,x:bx,y:by,up,reach,aside=null})=>{
    const t=timeFigure(big,small),fw=t.w,fh=t.h,sy=up?by-reach:by+reach;
    const open=([x,y])=>!type.some(b=>x>=b.x-2&&x<b.x+b.w+2&&y>=b.y-2&&y<b.y+b.h+2);
    if(aside){
      // Set aside in open map beside the track: the figure level with the
      // body, the shoulder ruled under it, and the leader run across to
      // the body from the shoulder's near end.
      const fx=aside.x,fy=Math.max(aside.top,Math.min(aside.bottom-fh-3,by-fh)),y=fy+fh+3,end={x:fx+fw+1,y},d=hypot(end.x-bx,end.y-by)||1,line=[];
      line.push(...circuitPath({x:bx,y:by},end,9));segment({x:fx-1,y},end,(x,y)=>line.push([x,y]));
      letter(line.filter(open),ink('ink'));const figure=setTime(t,fx,fy);
      return {figure,box:bounds(figure)};
    }
    // Hang the time on whichever side keeps it on the face and its leader
    // clearest of lettering, toward the middle of the face if both do.
    const layout=side=>{
      const sx=bx+side*10,fx=Math.max(4,Math.min(W-4-fw,side>0?sx+2:sx-2-fw)),d=hypot(sx-bx,sy-by),line=[];
      line.push(...circuitPath({x:bx,y:by},{x:sx,y:sy},9));segment({x:sx,y:sy},{x:side>0?fx+fw:fx-1,y:sy},(x,y)=>line.push([x,y]));
      const shown=line.filter(open),fits=side>0?sx+2+fw<=W-4:sx-2-fw>=4;
      return {fx,shown,score:(fits?0:1000)+(line.length-shown.length)*10+(side===(bx<W/2?1:-1)?0:1)};
    };
    const {fx,shown}=[layout(1),layout(-1)].sort((a,b)=>a.score-b.score)[0];
    const fy=up?sy-3-fh:sy+3;
    letter(shown,ink('ink'));const figure=setTime(t,fx,fy);
    return {figure,box:bounds(figure)};
  };
  if(camera.world&&tape!=='fixed'){
    // The sliding tape: the index stands still in the middle and the tape
    // runs past it, three pixels a minute, future to the right, as a date
    // or heading tape scrolls behind its lubber line. Hour figures ride the
    // tape on their marks, this hour solid and the next outlined, and are
    // cut off at the edges like any tape. With 'slide', the world scrolls
    // too, and the index line runs on down through the map to the body.
    const {baseline:B,panel:P}=SCALE,sc=()=>pal.spaceInk,fill=pal.route[0],IX=W/2,PX=3,now=Math.floor(minutes);
    for(let y=0;y<P;y++)for(let x=0;x<W;x++)plot(buf,x,y,pal.space);
    const hourAt=m=>{const q=Number(clockParts(s0.epoch+m*MINUTE,timeZone).h);return String(clock24?q:q%12||12);};
    // The whole tape moves each minute: a base layer leaves it to the
    // native renderer, with this hour's figures and the next's.
    if(baseOnly){tapeAt={mode:tape,hour:hourAt(0),next:hourAt(60)};hourPixels=[];nextSolid=[];index={x:IX,y:B};}
    else{
    for(let x=0;x<W;x++){plot(buf,x,P-1,sc());plot(buf,x,B,sc());if(x<=IX)plot(buf,x,B+1,fill);}
    for(let m=now-Math.ceil(IX/PX)-12;m<=now+Math.ceil(IX/PX)+12;m++){
      const x=IX+(m-now)*PX,mm=((m%60)+60)%60,len=mm===0?12:mm%15===0?6:mm%5===0?4:2;
      for(let d=1;d<=len;d++)plot(buf,x,B+d,sc());
      if(mm===0)for(let d=1;d<=6;d++)plot(buf,x,B-d,sc());
      else if(mm%15===0){const label=String(mm),lw=textWidth(LABEL,label);for(const [a,b] of textPixels(LABEL,label,x-Math.floor(lw/2)+1,B+17))plot(buf,a,b,sc());}
    }
    // This hour's figure rides its mark until the mark leaves the left edge,
    // then stays pinned there, as a tape's sticky label, until the next
    // hour's figure arrives and pushes it off.
    const m0=now-((now%60)+60)%60,size=FIGURE.scale,cur=hourAt(m0),nxt=hourAt(m0+60),cw=runWidth(cur,size),nw=runWidth(nxt,size);
    const nx=Math.round(IX+(m0+60-now)*PX-nw/2),cx=Math.min(Math.max(Math.round(IX+(m0-now)*PX-cw/2),4),nx-cw-8);
    const onTape=px=>px.filter(([a])=>a>=0&&a<W);hourPixels=onTape(figurePixels(cur,size,cx,4));nextSolid=onTape(figurePixels(nxt,size,nx,4));
    for(const [a,b] of hourPixels)plot(buf,a,b,sc());for(const [a,b] of outline(nextSolid,1))plot(buf,a,b,sc());
    // The index: a hairline in the route's ink through the whole tape, and
    // the solid pointer on the baseline.
    for(let y=0;y<P-1;y++)plot(buf,IX,y,fill);
    for(let k=0;k<6;k++)for(let d=-k;d<=k;d++)plot(buf,IX+d,B-7+k,pal.space);
    for(let k=0;k<5;k++)for(let d=-k;d<=k;d++)plot(buf,IX+d,B-6+k,sc());
    // The index line on down through the map to the body (the minute's).
    if(tape==='slide')for(let y=top;y<my-8;y++)if(((y-top)>>1)%2===0)plot(buf,IX,y,ink('route')(IX,y));
    index={x:IX,y:B};
    }
  }else if(camera.world){
    const {baseline:B,panel:P}=SCALE,sc=()=>pal.spaceInk,fill=pal.route[0];
    for(let y=0;y<P;y++)for(let x=0;x<W;x++)plot(buf,x,y,pal.space);
    for(let x=0;x<W;x++)plot(buf,x,P-1,sc());
    for(let x=X0;x<=X1;x++){plot(buf,x,B,sc());if(!baseOnly&&(forward?x<=ix:x>=ix))plot(buf,x,B+1,fill);}
    for(let m=0;m<=60;m++){
      const x=Math.round(at(m)),len=m%60===0?12:m%15===0?6:m%5===0?4:2;
      for(let d=1;d<=len;d++)plot(buf,x,B+d,sc());
      if(m%60===0)for(let d=1;d<=6;d++)plot(buf,x,B-d,sc());
      if(m%15===0&&m%60){const label=String(m),lw=textWidth(LABEL,label);for(const [a,b] of textPixels(LABEL,label,x-Math.floor(lw/2)+1,B+17))plot(buf,a,b,sc());}
    }
    const size=FIGURE.scale,hw=runWidth(hour,size),nw=runWidth(next,size),gx=place(forward?X0:X1,hw),nx=place(forward?X1:X0,nw);
    hourPixels=figurePixels(hour,size,gx,4);nextSolid=figurePixels(next,size,nx,4);
    for(const [a,b] of hourPixels)plot(buf,a,b,sc());for(const [a,b] of outline(nextSolid,1))plot(buf,a,b,sc());
    // The index, and the minutes over it, are the minute's own.
    if(!baseOnly){
      for(let k=0;k<6;k++)for(let d=-k;d<=k;d++)plot(buf,ix+d,B-7+k,pal.space);
      for(let k=0;k<5;k++)for(let d=-k;d<=k;d++)plot(buf,ix+d,B-6+k,sc());
    }
    index={x:ix,y:B};tapeAt={x0:X0,x1:X1,baseline:B,inner:[Math.min(gx+hw,nx+nw)+3,Math.max(gx,nx)-3-textWidth(LABEL,'00')]};
    if(readout){
      const lw=textWidth(LABEL,parts.m),inner=[Math.min(gx+hw,nx+nw)+3,Math.max(gx,nx)-3-lw],lx=Math.max(inner[0],Math.min(inner[1],Math.round(ix-lw/2)));
      for(const [a,b] of textPixels(LABEL,parts.m,lx,B-10))plot(buf,a,b,sc());minuteBox={x:lx,y:B-18,w:lw,h:8};
    }
  }else if(camera.day){
    // A whole day is too long a scale to read minutes from, so the strip
    // carries a time callout, in the open paper above the net where there
    // is room, otherwise below the body.
    const fh=runHeight(FIGURE.scale),head=home?14:0,netTop=camera.tiles?Math.max(0,Math.min(...camera.tiles.map(t=>t.box[1]))):-1,room=netTop-head>=fh+16,up=room||my-26-fh>=4+head;
    const reach=room?my-(head+Math.round((netTop-head-fh)/2)+fh+3):26;
    // On a north-up day chart there is no open paper above a net: the
    // callout takes whichever side of the body crosses less of the track.
    // A north-up day chart sets its track to the right, and the callout
    // stands aside in the open map to its left.
    let c;
    const left=Math.min(...track.map(q=>q.x))-8;
    // The callout is the minute's: a base layer leaves it to the native
    // renderer, with where it may go and the lettering it steers round.
    if(baseOnly){calloutAt={left,top:4+head,bottom:H-18,avoid:type.slice()};c={figure:[]};}
    else if(!camera.tiles){
      const big=calloutWidth(FIGURE.scale,FIGURE.minute)<=left-6;
      c=callout({big:big?FIGURE.scale:FIGURE.callout,small:big?FIGURE.minute:FIGURE.calloutMinute,x:mx,y:my,aside:{x:6,top:4+head,bottom:H-18}});
    }else c=callout({big:FIGURE.scale,small:FIGURE.minute,x:mx,y:my,up,reach});
    hourPixels=c.figure;nextSolid=[];index={x:mx,y:my};
  }else{
    const size=hour.length>1||next.length>1?FIGURE.hourTwo:FIGURE.hour,hw=runWidth(hour,size),nw=runWidth(next,size),fh=runHeight(size),gy=c0.y-26-fh;
    if(camera.normal){
      // A slow orbit's route runs any way: each figure stands off its
      // station on the route's open side, clear of the rose.
      const n=camera.normal,stand=(c,w)=>{const d=26+Math.abs(n.x)*w/2+Math.abs(n.y)*fh/2;return [Math.max(4,Math.min(W-4-w,Math.round(c.x+n.x*d-w/2))),Math.max(4,Math.min(H-18-fh,Math.round(c.y+n.y*d-fh/2)))];};
      hourPixels=figurePixels(hour,size,...stand(c0,hw));nextSolid=figurePixels(next,size,...stand(c1,nw));
    }else{hourPixels=figurePixels(hour,size,place(c0.x,hw),gy);nextSolid=figurePixels(next,size,place(c1.x,nw),gy);}
    letter(hourPixels,ink('ink'));letter(outline(nextSolid,2),ink('ink'));
    index={x:ix,y:c0.y};
    // An optional time callout is the minute's: a base layer leaves it to
    // the native renderer, with the lettering it steers round.
    if(baseOnly)calloutAt={left:0,top:0,bottom:0,avoid:type.slice()};
    if(readout==='flag'){
      // Optional minute flag: a staff rising from the body into the space
      // between the route and the hour figures, flying a small pennant with
      // the minutes reversed out of the route's ink in the chart's
      // lettering. It flies ahead, toward the next hour, and turns back as
      // the next station comes near.
      // On a slow orbit's steep route the staff leans out on the figures'
      // side instead, and the flag flies away from the route.
      const n=camera.normal||{x:0,y:-1},tw=textWidth(LABEL,parts.m)-1,fh2=11,fw=tw+6,point=6,ahead=forward?1:-1,room=forward?c1.x-mx:mx-c1.x;
      const sx=Math.round(mx+n.x*20),top=Math.round(my+n.y*20)-(n.y<=0?4:0)-(n.y>0?fh2-4:0);
      const d=Math.abs(n.x)>.5?Math.sign(n.x):room<fw+point+8?-ahead:ahead,staff=[],flag=[];
      staff.push(...circuitPath({x:mx,y:my},{x:sx,y:n.y<=0?top:top+fh2-1},8));
      for(let y=0;y<fh2;y++){const tip=Math.round(point*(1-Math.abs(2*y-(fh2-1))/(fh2-1)));for(let x=0;x<fw+tip;x++)flag.push([d>0?sx+1+x:sx-1-x,top+y]);}
      const digits=textPixels(LABEL,parts.m,d>0?sx+4:sx-fw+2,top+10);
      letter([...staff,...flag],ink('route'),1);for(const [a,b] of digits)clear(a,b);
      minuteBox=bounds(flag);
    }else if(readout){
      // Optional time callout, under the route, clear of the hour figures.
      minuteBox=callout({big:FIGURE.callout,small:FIGURE.calloutMinute,x:mx,y:my,up:false,reach:26}).box;
    }
  }
  // Events are compulsory reporting points: a filled triangle on the route
  // at the event's minute, where the open triangle is the next hour's
  // optional one, with its name set above. The name gives way to the hour
  // figures, the callout and the network; the triangle always shows.
  const fixes=[];
  for(const e of events){
    const i=track.findIndex((q,k)=>k>0&&track[k-1].epoch<=e.epoch&&q.epoch>=e.epoch);if(i<0)continue;
    const a=track[i-1],b=track[i];if(jump(a,b))continue;
    const f=(e.epoch-a.epoch)/((b.epoch-a.epoch)||1),x=Math.round(a.x+(b.x-a.x)*f),y=Math.round(a.y+(b.y-a.y)*f);
    if(x<5||x>W-6||y<top+8||y>bottom-4||camera.outside?.(x,y))continue;
    const col=ink('ink');
    FIX.forEach((row,dy)=>[...row].forEach((v,dx)=>{const px=x+dx-4,py=y+dy-4;if(v==='#')plot(buf,px,py,col(x,y));else if(row.indexOf('#')<dx&&dx<row.lastIndexOf('#'))clear(px,py);}));
    const name=e.label,lw=textWidth(LABEL,name),lx=Math.max(4,Math.min(W-4-lw,x-Math.floor(lw/2))),text=textPixels(LABEL,name,lx,y-7),box=bounds(text);
    const clearOf=[...taken,...type,...fixes.map(q=>q.box).filter(Boolean),hourPixels.length?bounds(hourPixels):null,nextSolid.length?bounds(nextSolid):null,minuteBox].filter(Boolean);
    const clear=list=>box.y>=(home?14:2)&&!list.some(o=>!(o.x+o.w+1<=box.x||box.x+box.w+1<=o.x||o.y+o.h+1<=box.y||box.y+box.h+1<=o.y));
    const free=clear(clearOf);
    // The name is the minute's (it gives way to the minute's flag, callout
    // or tape): a base layer leaves it to the native renderer, with whether
    // it is clear of what stays all hour.
    if(free&&!baseOnly)letter(text,col);
    fixes.push({label:name,epoch:e.epoch,x,y,box:free?box:null,text:{x:lx,box,clear:clear([...taken,...type,hourPixels.length?bounds(hourPixels):null,nextSolid.length?bounds(nextSolid):null].filter(Boolean))}});
  }
  // Home on top of the route and figures, on its own knockout.
  if(homeMark){
    const {x,y,code}=homeMark,col=ink('mark');
    for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++)if(dx*dx+dy*dy<=36)clear(x+dx,y+dy);
    AIRPORT.forEach((row,dy)=>[...row].forEach((v,dx)=>{if(v==='#')plot(buf,x+dx-5,y+dy-5,col(x,y));}));
    letter(code,col);delete homeMark.code;
  }
  // Margins: the ISS archive and altitude; otherwise the date in the chart's
  // own terms, with the day of the year as mission control kept it.
  // Each margin line sets text at the left and right edges; a middle entry
  // is centred in the space between them.
  const margins=[];
  const margin=(l,r,y,color,middle='')=>{
    const a=textPixels(LABEL,l,6,y),b=textPixels(LABEL,r,W-6-textWidth(LABEL,r),y),left=6+textWidth(LABEL,l),right=W-6-textWidth(LABEL,r);
    letter(a,color,1);letter(b,color,1);margins.push(...[a,b].filter(q=>q.length).map(bounds));
    if(middle){const mx0=Math.round((left+right-textWidth(LABEL,middle))/2);zuluAt={x:mx0,baseline:y};if(!baseOnly){const c=textPixels(LABEL,middle,mx0,y);letter(c,color,1);zulu={text:middle,box:bounds(c)};}}
  };
  // Zulu: the same moment in UTC, as pilots and mission control keep it.
  // With zone 'body', the margin shows instead the time in the nautical
  // time zone under the body, with the zone's letter: Z at Greenwich, R for
  // US Eastern, I for Japan. The Sun's is always near noon.
  const zoned=zone==='body'?nauticalZone(body.lon):{hours:0,letter:'Z'},utc=new Date(epoch+zoned.hours*3600000),Z=`${String(utc.getUTCHours()).padStart(2,'0')}${String(utc.getUTCMinutes()).padStart(2,'0')}${zoned.letter}`;let zulu=null,zuluAt=null,altAt=null,topAt={x:6,baseline:11};
  const MONTHS='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  if(camera.world){
    // Satellites say where their numbers come from: the 2019 archive, or
    // the epoch of the live element set in use.
    const elements=elementsFor(camera.body),date=new Date(elements?elements.epoch:epoch),day=String(date.getUTCDate()).padStart(2,'0');
    const source=elements?`${elements.catalog?.code||'SAT'} EL ${day} ${MONTHS[date.getUTCMonth()]} ${String(date.getUTCHours()).padStart(2,'0')}${String(date.getUTCMinutes()).padStart(2,'0')}Z`:`ARCHIVE ${day} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    // The height, the pass line and Zulu time change by the minute: a base
    // layer leaves them to the native renderer.
    margin(source,baseOnly?'':`${Math.round(body.altitude)} KM`,top-6,()=>pal.spaceInk);altAt={right:W-6,baseline:top-6};
    // Under the band, the next pass over home: acquisition of signal, its
    // length and its greatest elevation; or, while in view, loss of signal.
    // Under the band, Zulu time at the right.
    topAt={x:6,baseline:H-1};zuluAt={x:W-6-textWidth(LABEL,Z),baseline:H-1};
    if(!baseOnly){
      margin(home?passText(camera.body,home,epoch,timeZone):'','',H-1,()=>pal.spaceInk);
      const z=textPixels(LABEL,Z,zuluAt.x,H-1);letter(z,()=>pal.spaceInk,1);zulu={text:Z,box:bounds(z)};
    }
  }else{
    const d=localDate(epoch,timeZone);
    margin(`${String(d.day).padStart(2,'0')} ${MONTHS[d.month-1]} ${d.year}`,`DAY ${String(d.dayOfYear).padStart(3,'0')}`,H-5,ink('ink'),Z);
    // Over the chart, home's next satellite pass, or the day's rise and
    // set of the Sun or Moon there, in local time.
    // A satellite's pass line can change within the hour, so a base layer
    // leaves it to the native renderer, which sets it each minute.
    const risen=camera.body==='sun'||camera.body==='moon';
    if(home&&(risen||!baseOnly)){const [l,r]=risen?riseText(camera.body,home,epoch,timeZone):[passText(camera.body,home,epoch,timeZone),''];margin(l,r,11,ink('ink'));}
  }
  if(baseOnly){
    const tintIndex=(table,v)=>table.findIndex(([limit])=>table[0][0]<table.at(-1)[0]?v<limit:v>=limit);
    const baseClass=new Uint8Array(W*H);
    for(let i=0;i<W*H;i++)baseClass[i]=mat[i]===SPACE?2:pal.tints&&land[i]?3+tintIndex(pal.tints,relief[i]):pal.depths&&!land[i]?8+tintIndex(pal.depths,relief[i]):land[i]?1:0;
    return {buf,trace,overlay,baseClass,beforeRoute,stages,marker:{x:p.x,y:p.y},zuluAt,altAt,topAt,tapeAt,calloutAt,anchors:{c0,c1,stations:stations.map(s=>({x:s.x,y:s.y}))},fixes:fixes.map(f=>({x:f.x,y:f.y,label:f.label,lx:f.text.x,box:f.text.box,clear:f.text.clear})),hour,home:homeMark?{x:homeMark.x,y:homeMark.y,box:homeMark.box}:null};
  }
  return {buf,marker:{x:p.x,y:p.y,lat:body.lat,lon:body.lon},stations,home:homeMark,zulu,margins,events:fixes,
    figure:{hour,minute:parts.m,next,time:camera.day||readout===true?(numerals==='colon'?`${hour}:${parts.m}`:`${numerals==='even'&&clock24?hour.padStart(2,'0'):hour}${parts.m}`):null,box:bounds(hourPixels),nextBox:bounds(nextSolid),index,scale:{x0:X0,x1:X1},readout:minuteBox},rose:camera.world?null:{...c0,r:20}};
  }
}
// Nautical time zones: 15° wide, centred on multiples of 15°, lettered A–M
// east of Greenwich (no J), N–Y west, Z at Greenwich.
export function nauticalZone(lon){
  const hours=Math.max(-12,Math.min(12,Math.round((((lon+540)%360)-180)/15)));
  return {hours,letter:hours===0?'Z':hours>0?'ABCDEFGHIKLM'[hours-1]:'NOPQRSTUVWXY'[-hours-1]};
}
// Local clock time in the chart's four figures, 24-hour, no colon.
const hhmm=(t,timeZone)=>{const q=clockParts(t,timeZone);return `${String(q.h).padStart(2,'0')}${String(q.m).padStart(2,'0')}`;};
export function riseText(body,home,epoch,timeZone){
  const {rise,set}=riseSet(body,home,localDay(epoch,timeZone).start),[a,b]=body==='moon'?['MR','MS']:['SR','SS'];
  return [`${home.code} ${a} ${rise?hhmm(rise,timeZone):'----'}`,`${b} ${set?hhmm(set,timeZone):'----'}`];
}
export function passText(body,home,epoch,timeZone){
  const pass=nextPass(body,home,epoch);
  if(!pass)return `${home.code} NO PASS`;
  if(pass.aos<=epoch)return `${home.code} IN VIEW LOS ${hhmm(pass.los,timeZone)}`;
  return `${home.code} AOS ${hhmm(pass.aos,timeZone)} ${Math.max(1,Math.round((pass.los-pass.aos)/MINUTE))}M ${Math.round(pass.peak)}°`;
}
// The calendar date where the watch is, and its day of the year.
const dateFormats=new Map();
export function localDate(epoch,timeZone){
  if(!dateFormats.has(timeZone))dateFormats.set(timeZone,new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'numeric',day:'numeric'}));
  const parts=Object.fromEntries(dateFormats.get(timeZone).formatToParts(new Date(epoch)).map(p=>[p.type,Number(p.value)]));
  return {year:parts.year,month:parts.month,day:parts.day,dayOfYear:Math.round((Date.UTC(parts.year,parts.month-1,parts.day)-Date.UTC(parts.year,0,0))/86400000)};
}

// Caches follow the clock: map and relief by the hour, light by the minute.
export class EnrouteRenderer{
  constructor(atlas,meters){this.atlas=atlas;this.meters=meters;this.stats={geometryBuilds:0,lightBuilds:0,renders:0};}
  render(state){
    const {body,epoch,timeZone,clock24,plate}=state,readout=state.readout==='flag'?'flag':!!state.readout,home=state.home||null,events=state.events||[],tape=['tape','slide'].includes(state.tape)?state.tape:'fixed',numerals=NUMERALS.includes(state.numerals)?state.numerals:'colon',zone=state.zone==='body'?'body':'utc',start=civilHour(epoch,timeZone);
    const projection=state.projection==='fuller'?'fuller':'chart',view=viewOf(body)==='day'&&state.span==='hour'?'hour':viewOf(body),slide=tape==='slide'&&projection==='chart'&&view==='world',minute=Math.floor(epoch/MINUTE)*MINUTE,geometryKey=`${projection}/${view}/${body}/${start}/${timeZone}${slide?`/${minute}`:''}`,lightKey=`${geometryKey}/${Math.floor(epoch/MINUTE)}`;
    if(this.geometryKey!==geometryKey){
      this.camera=projection==='fuller'?(body==='sun'||body==='moon'||view==='day'?rollCamera(body,start,{span:192,day:localDay(epoch,timeZone)}):rollCamera(body,start,{span:180})):view==='day'?chartCamera(body,start,{day:localDay(epoch,timeZone)}):chartCamera(body,start,{span:SPAN,center:slide?minute:null});this.ground=groundLayer(this.camera,this.atlas);this.relief=reliefLayer(this.camera,this.meters);
      this.geometryKey=geometryKey;this.stats.geometryBuilds++;
    }
    if(this.lightKey!==lightKey){this.light=lightLayer(this.ground,epoch);this.lightKey=lightKey;this.stats.lightBuilds++;}
    const sceneKey=`${lightKey}/${timeZone}/${clock24}/${plate}/${readout}/${tape}/${numerals}/${zone}/${home?`${home.code}${home.lat},${home.lon}`:''}/${events.map(e=>`${e.epoch}${e.label}`).join('|')}`;if(this.sceneKey===sceneKey)return this.last;
    const out=renderEnroute({camera:this.camera,ground:this.ground,relief:this.relief,light:this.light,plate,epoch,timeZone,clock24,readout,home,events,tape,numerals,zone});
    const zones=[0,0,0];for(const z of this.light)zones[z]++;
    this.sceneKey=sceneKey;this.stats.renders++;
    const rgba=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){rgba.set(out.buf.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
    this.last={...out,rgba,start,zones,world:this.camera.world,time:clockParts(epoch,timeZone).text,stationsOnRoute:this.camera.stations.map(s=>({x:s.x,y:s.y,epoch:s.epoch}))};
    return this.last;
  }
}

// Local midnight to the next local midnight (23 or 25 hours across a DST
// change), for the whole-day strip.
export function localDay(epoch,timeZone){
  // Subtracting the wall-clock time is off by an hour on a changeover day,
  // so step until the local clock really reads midnight.
  const wall=t=>{const p=clockParts(t,timeZone);return Number(p.h)*60+Number(p.m);};
  const off=t=>{const m=wall(t);return m>12*60?m-24*60:m;};
  const floor=t=>{let c=Math.floor(t/MINUTE)*MINUTE-wall(t)*MINUTE;for(let i=0;i<3&&off(c);i++)c-=off(c)*MINUTE;return c;};
  const start=floor(epoch);return {start,end:floor(start+26*3600000)};
}
