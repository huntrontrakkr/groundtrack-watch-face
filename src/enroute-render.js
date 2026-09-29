// Study 06 — Enroute. The chart language of the golden age of flight and
// spaceflight: contour relief from real elevation data, a magenta route
// between two reporting points, a compass rose on this hour's station, the
// time set like a chart's maximum elevation figure, and the tracking
// stations of NASA's early networks. Whole RGB222 pixels in a plain buffer.
import {position,moonLight,MINUTE} from './ephemeris.js';
import {dot,RAD} from './geometry.js';
import {clockParts} from './render.js';
import {SUNRISE_SINE,CIVIL_TWILIGHT_SINE} from './solar.js';
import {chartCamera,groundLayer,lightLayer,civilHour,LAND,SPACE,COAST,W,H} from './chart-render.js';
import {reliefAt} from './relief.js';
import numerals from '../data/chart-font.json' with {type:'json'};
import drafts from '../data/draft-font.json' with {type:'json'};
import network from '../data/tracking-stations.json' with {type:'json'};

export {W,H};
const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const inks=list=>list.map(hex);
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
  plotboard:{name:'Plotboard',note:'Mission control: lit lines on dark glass',night:'zones',
    water:inks(['#000055','#000055','#000000']),land:inks(['#005555','#005555','#000055']),coast:inks(['#55AAAA','#55AAAA','#0055AA']),
    contour:inks(['#00AAAA','#00AAAA','#0055AA']),shelf:inks(['#0055AA','#0055AA','#000055']),grid:inks(['#0055AA','#0055AA','#0055AA']),
    route:inks(['#FFAA00','#FFAA00','#FFAA00']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFAA']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')}
};
// Contours in meters; the lowest is dotted, as an intermediate contour.
export const CONTOURS=[500,1000,2000,3000,4000,5000],SHELF=-200;
// Acquisition circle: ground range at which a 410 km orbit rises 5 degrees
// above a station's horizon (about 15.6 degrees of arc).
const EARTH=6371,ORBIT=410,MASK=5*RAD;
export const ACQUISITION=(Math.acos(EARTH*Math.cos(MASK)/(EARTH+ORBIT))-MASK)/RAD;
export const FIGURE={hour:80,hourTwo:72,minute:36,next:36};

function plot(buf,x,y,c){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=W||y>=H)return;const i=(y*W+x)*3;buf[i]=c[0];buf[i+1]=c[1];buf[i+2]=c[2];}
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
const runWidth=(text,size)=>[...text].reduce((s,c)=>s+numerals.sizes[size][c].width,0)+gapFor(size)*(text.length-1);
const runHeight=size=>numerals.sizes[size]['0'].height;
// Figures sit on a shared baseline; the tallest glyph sets the top.
function figurePixels(text,size,x,y){
  const set=numerals.sizes[size],h=Math.max(...[...text].map(c=>set[c].height)),out=[];let cx=x;
  for(const c of text){const g=set[c];for(let yy=0;yy<g.height;yy++)for(let xx=0;xx<g.width;xx++)if(g.rows[yy][xx]==='#')out.push([cx+xx,y+h-g.height+yy]);cx+=g.width+gapFor(size);}
  return out;
}
const bounds=pixels=>{
  const xs=pixels.map(p=>p[0]),ys=pixels.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
  return {x,y,w:Math.max(...xs)-x+1,h:Math.max(...ys)-y+1};
};
// The point at an angular distance and bearing from a station.
function destination(lat,lon,distance,bearing){
  const p=lat*RAD,d=distance*RAD,b=bearing*RAD,q=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b));
  return {lat:q/RAD,lon:lon+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(q))/RAD};
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
export function contourLevel(relief,land,i){
  if(!land[i])return 0;
  const level=v=>CONTOURS.filter(c=>v>=c).length,k=level(relief[i]);
  if(!k)return 0;
  for(const j of [i-1,i+1,i-W,i+W])if(j>=0&&j<W*H&&land[j]&&level(relief[j])<k)return CONTOURS[k-1];
  return 0;
}

const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const HEXAGON=['..###..','.#...#.','#.....#','.#...#.','..###..'],TRIANGLE=['....#....','...#.#...','...#.#...','..#...#..','..#...#..','.#.....#.','#########'];
export function renderEnroute({camera,ground,relief,light:zones,plate,epoch,timeZone,clock24}){
  const pal=PLATES[plate],buf=new Uint8ClampedArray(W*H*3),mat=ground.material,sun=position('sun',Math.floor(epoch/MINUTE)*MINUTE).dir;
  const light=pal.night==='screen'?new Uint8Array(W*H):zones,land=mat.map(m=>m===LAND?1:0);
  const zoneAt=(x,y)=>light[Math.max(0,Math.min(H-1,Math.round(y)))*W+Math.max(0,Math.min(W-1,Math.round(x)))];
  const base=i=>mat[i]===SPACE?pal.space:(land[i]?pal.land:pal.water)[light[i]];
  const ink=key=>(x,y)=>pal[key][zoneAt(x,y)];
  // Ground: water, land, coastline, contours and the continental shelf edge.
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,z=light[i];let c=base(i);
    if(mat[i]!==SPACE){
      const level=contourLevel(relief,land,i);
      if(level&&(level!==CONTOURS[0]||((x+y)&1)===0))c=pal.contour[z];
      else if(mat[i]===COAST)c=pal.coast[z];
      else if(!land[i]&&relief[i]<SHELF&&((x+y)&1)===0&&[i-1,i+1,i-W,i+W].some(j=>j>=0&&j<W*H&&!land[j]&&relief[j]>=SHELF))c=pal.shelf[z];
    }
    buf.set(c,i*3);
  }
  // Paper plates show night as a regular dot tint, deepening through civil
  // twilight to a 25 percent screen, printed under every symbol.
  if(pal.night==='screen')for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const d=ground.dirs[y*W+x];if(!d)continue;
    const t=Math.max(0,Math.min(1,(SUNRISE_SINE-dot(d,sun))/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE)));
    if(t>0&&BAYER[(y&3)*4+(x&3)]<t*4)plot(buf,x,y,pal.screen);
  }
  // Knockouts clear to plain paper under lettering, as on a printed chart.
  const clear=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<W&&y<H)plot(buf,x,y,base(y*W+x));};
  const letter=(pixels,color,halo=1)=>{
    for(const [a,b] of pixels)for(let dy=-halo;dy<=halo;dy++)for(let dx=-halo;dx<=halo;dx++)clear(a+dx,b+dy);
    for(const [a,b] of pixels)plot(buf,a,b,mat[Math.max(0,Math.min(H-1,b))*W+Math.max(0,Math.min(W-1,a))]===SPACE?pal.spaceInk:color(a,b));
  };
  // Graticule: small crosses every five degrees (thirty on the world band)
  // and degree ticks along the edges of the map, like a chart's neatline.
  const step=camera.world?30:5,minor=camera.world?10:1,{top,bottom}=camera.band,inBand=y=>y>=top&&y<=bottom;
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
  // Tracking stations of the Mercury and Apollo networks, as small circled
  // points with their network codes. On the world band each also shows its
  // acquisition circle, as on the plotboards of the mission control rooms.
  const stations=[],taken=[];
  for(const s of network.stations){
    const p=camera.project(s.lat,s.lon),x=Math.round(p.x),y=Math.round(p.y);
    if(x<4||x>W-5||y<top+6||y>bottom-6)continue;
    const w=textWidth(drafts.small,s.code),right=x+5+w<W-3,box={x:right?x-3:x-6-w,y:y-4,w:w+9,h:9};
    if(taken.some(b=>b.x<box.x+box.w&&box.x<b.x+b.w&&b.y<box.y+box.h&&box.y<b.y+b.h))continue;
    taken.push(box);stations.push({code:s.code,x,y,box});
    if(camera.world)for(let bearing=0;bearing<360;bearing+=5){
      const q=destination(s.lat,s.lon,ACQUISITION,bearing),r=camera.project(q.lat,q.lon);
      if(Math.abs(r.x-x)<W/2&&inBand(r.y))plot(buf,r.x,r.y,ink('grid')(r.x,r.y));
    }
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const r=dx*dx+dy*dy;if(r<=5&&r>=3)plot(buf,x+dx,y+dy,ink('ink')(x,y));}
    plot(buf,x,y,ink('ink')(x,y));
    letter(textPixels(drafts.small,s.code,right?x+5:x-5-w,y+3),ink('ink'));
  }
  // The route, as the magenta line: bold behind the present, fine ahead,
  // dashed before and after the hour. Ticks every five minutes; the
  // quarter hours are longer and carry their minute, like a plotted track.
  const track=camera.track,now=Math.floor(epoch/MINUTE)*MINUTE,[s0,s1]=camera.stations,jump=(a,b)=>Math.abs(b.x-a.x)>W/2;
  for(let i=1;i<track.length;i++){
    const a=track[i-1],b=track[i];if(jump(a,b))continue;
    const hour=a.hour&&b.hour,bold=hour&&b.epoch<=now,steep=Math.abs(b.y-a.y)>Math.abs(b.x-a.x);
    segment(a,b,(x,y)=>{
      if(!hour){if(((x+y)>>1)%2===0)plot(buf,x,y,ink('route')(x,y));return;}
      plot(buf,x,y,ink('route')(x,y));if(bold)plot(buf,steep?x+1:x,steep?y:y-1,ink('route')(x,y));
    });
  }
  for(let i=1;i<track.length-1;i++){
    const p=track[i];if(!p.hour)continue;const m=Math.round((p.epoch-s0.epoch)/MINUTE);if(m%5||m===0||m===60)continue;
    const a=track[i-1],b=track[i+1],len=Math.hypot(b.x-a.x,b.y-a.y)||1;let nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;if(ny<0){nx=-nx;ny=-ny;}
    const size=m%15===0?4:2;for(let s=1;s<=size;s++)plot(buf,p.x+nx*s,p.y+ny*s,ink('route')(p.x,p.y));
    if(m%15===0&&!camera.world){const label=String(m);letter(textPixels(drafts.small,label,Math.round(p.x+nx*9-textWidth(drafts.small,label)/2),Math.round(p.y+ny*9+3)),ink('route'),0);}
  }
  // This hour's station is a VOR: a hexagon inside a compass rose, north up.
  // The next hour is an open triangle, a reporting point.
  const c0={x:Math.round(s0.x),y:Math.round(s0.y)},c1={x:Math.round(s1.x),y:Math.round(s1.y)},col=ink('ink');
  if(!camera.world){
    const R=16;
    for(let a=0;a<720;a++){const t=a*Math.PI/360;plot(buf,c0.x+Math.round(Math.sin(t)*R),c0.y-Math.round(Math.cos(t)*R),col(c0.x,c0.y));}
    for(let a=0;a<360;a+=30){const t=a*RAD,len=a%90===0?5:3;for(let r=R-len;r<R;r++)plot(buf,c0.x+Math.round(Math.sin(t)*r),c0.y-Math.round(Math.cos(t)*r),col(c0.x,c0.y));}
    for(let k=0;k<3;k++)for(let d=-k;d<=k;d++)plot(buf,c0.x+d,c0.y-R-4+k,col(c0.x,c0.y));
  }
  const symbol=(rows,cx,cy)=>rows.forEach((row,dy)=>[...row].forEach((v,dx)=>{
    const x=cx-(row.length>>1)+dx,y=cy-(rows.length>>1)+dy;
    if(v==='#')plot(buf,x,y,col(cx,cy));else if(row.indexOf('#')<dx&&dx<row.lastIndexOf('#'))clear(x,y);
  }));
  symbol(HEXAGON,c0.x,c0.y);plot(buf,c0.x,c0.y,col(c0.x,c0.y));symbol(TRIANGLE,c1.x,c1.y-1);
  // The present: the body's own symbol on a knockout.
  const body=position(camera.body,epoch),p=camera.project(body.lat,body.lon),mx=Math.round(p.x),my=Math.round(p.y),mk=ink('mark')(mx,my);
  const disc=(r,fn)=>{const n=Math.ceil(r);for(let dy=-n;dy<=n;dy++)for(let dx=-n;dx<=n;dx++)if(dx*dx+dy*dy<=r*r)fn(mx+dx,my+dy,dx,dy);};
  disc(6.6,clear);
  if(camera.body==='sun'){disc(5.2,(x,y,dx,dy)=>{if(dx*dx+dy*dy>3.6*3.6)plot(buf,x,y,mk);});disc(1.5,(x,y)=>plot(buf,x,y,mk));}
  else if(camera.body==='moon'){
    // The Moon in its calculated phase; a rim keeps a new Moon visible.
    const {fraction,waxing}=moonLight(epoch),r=5.2;
    disc(r,(x,y,dx,dy)=>{const edge=Math.sqrt(Math.max(0,r*r-dy*dy)),side=waxing?dx:-dx;if(side>=(1-2*fraction)*edge||dx*dx+dy*dy>(r-1.2)**2)plot(buf,x,y,mk);});
  }else{
    for(let k=-5;k<=5;k++){plot(buf,mx+k,my,mk);if(Math.abs(k)>=3){plot(buf,mx+k,my-1,mk);plot(buf,mx+k,my+1,mk);}}
    for(let k=-2;k<=2;k++)for(let d=-1;d<=1;d++)plot(buf,mx+d,my+k,mk);
  }
  // The time, set like a chart's maximum elevation figure: the hour large,
  // its minutes raised and small. The next hour stands over its point.
  const parts=clockParts(epoch,timeZone),h=Number(parts.h),hour=String(clock24?h:h%12||12),next=String(clock24?(h+1)%24:(h+1)%12||12);
  const big=hour.length>1?FIGURE.hourTwo:FIGURE.hour,gap=4,width=runWidth(hour,big)+gap+runWidth(parts.m,FIGURE.minute);
  const gx=Math.max(8,Math.min(W-8-width,Math.round(c0.x-runWidth(hour,big)/2)));
  const gy=camera.world?Math.round((top-runHeight(big))/2):c0.y-26-runHeight(big);
  const hourPixels=figurePixels(hour,big,gx,gy),minutePixels=figurePixels(parts.m,FIGURE.minute,gx+runWidth(hour,big)+gap,gy);
  letter([...hourPixels,...minutePixels],ink('ink'));
  const nw=runWidth(next,FIGURE.next),nx=Math.max(6,Math.min(W-6-nw,Math.round(c1.x-nw/2)));
  const ny=camera.world?gy+runHeight(big)-runHeight(FIGURE.next):c1.y-10-runHeight(FIGURE.next);
  const nextPixels=figurePixels(next,FIGURE.next,nx,ny);letter(nextPixels,ink('ink'));
  // The ISS is an archived orbit: say so, with its altitude, in the margin.
  if(camera.world){
    const date=new Date(epoch),month='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[date.getUTCMonth()];
    const archive=`ARCHIVE ${String(date.getUTCDate()).padStart(2,'0')} ${month} ${date.getUTCFullYear()}`,altitude=`ALT ${Math.round(body.altitude)} KM`;
    letter(textPixels(drafts.small,archive,8,top-8),()=>pal.spaceInk,0);
    letter(textPixels(drafts.small,altitude,W-8-textWidth(drafts.small,altitude),top-8),()=>pal.spaceInk,0);
  }
  return {buf,marker:{x:p.x,y:p.y,lat:body.lat,lon:body.lon},stations,
    figure:{hour,minute:parts.m,next,box:bounds([...hourPixels,...minutePixels]),nextBox:bounds(nextPixels)},rose:camera.world?null:{...c0,r:20}};
}

// Caches follow the clock: map and relief by the hour, light by the minute.
export class EnrouteRenderer{
  constructor(atlas,meters){this.atlas=atlas;this.meters=meters;this.stats={geometryBuilds:0,lightBuilds:0,renders:0};}
  render(state){
    const {body,epoch,timeZone,clock24,plate}=state,start=civilHour(epoch,timeZone);
    const geometryKey=`${body}/${start}`,lightKey=`${geometryKey}/${Math.floor(epoch/MINUTE)}`;
    if(this.geometryKey!==geometryKey){
      this.camera=chartCamera(body,start);this.ground=groundLayer(this.camera,this.atlas);this.relief=reliefLayer(this.camera,this.meters);
      this.geometryKey=geometryKey;this.stats.geometryBuilds++;
    }
    if(this.lightKey!==lightKey){this.light=lightLayer(this.ground,epoch);this.lightKey=lightKey;this.stats.lightBuilds++;}
    const sceneKey=`${lightKey}/${timeZone}/${clock24}/${plate}`;if(this.sceneKey===sceneKey)return this.last;
    const out=renderEnroute({camera:this.camera,ground:this.ground,relief:this.relief,light:this.light,plate,epoch,timeZone,clock24});
    const zones=[0,0,0];for(const z of this.light)zones[z]++;
    this.sceneKey=sceneKey;this.stats.renders++;
    const rgba=new Uint8ClampedArray(W*H*4);for(let i=0;i<W*H;i++){rgba.set(out.buf.subarray(i*3,i*3+3),i*4);rgba[i*4+3]=255;}
    this.last={...out,rgba,start,zones,world:this.camera.world,time:clockParts(epoch,timeZone).text,stationsOnRoute:this.camera.stations.map(s=>({x:s.x,y:s.y,epoch:s.epoch}))};
    return this.last;
  }
}
