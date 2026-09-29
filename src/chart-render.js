// Study 05 — Chart. A flat, north-up map with the hour's path drawn as a
// route between two stations. Every step works on whole RGB222 pixels in a
// plain buffer: no canvas smoothing, no spatial color mixing and no
// supersampled scene. A native port could keep one material code and one
// light code per pixel and look each color up in a small table.
import {position,sampleTrack,moonLight,MINUTE} from './ephemeris.js';
import {direction,dot,wrap,RAD} from './geometry.js';
import {clockParts} from './render.js';
import {SUNRISE_SINE,CIVIL_TWILIGHT_SINE} from './solar.js';
import numerals from '../data/chart-font.json' with {type:'json'};
import drafts from '../data/draft-font.json' with {type:'json'};

export const W=200,H=228;
// One material and one light zone per pixel.
export const SEA=0,LAND=1,COAST=2,WAVE=3,SPACE=4,DAY=0,DUSK=1,NIGHT=2;
const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const zones=rows=>rows.map(row=>row.map(hex));
// ground/shade: [light][sea, land, coast, waterline]. Inks: [day, dusk, night].
// shade is the same ground under a numeral's shadow.
export const CHARTS={
  shore:{name:'Shore',note:'Bone, sea glass, vermilion',
    ground:zones([['#55AAAA','#FFFFAA','#005555','#00AAAA'],['#005555','#AAAA55','#000055','#005555'],['#000055','#555500','#000000','#000055']]),
    shade:zones([['#005555','#AAAA55','#005555','#005555'],['#000055','#555500','#000055','#000055'],['#000055','#555500','#000000','#000055']]),
    hour:zones([['#005555','#FFFFAA','#FFFFAA']]),route:zones([['#FF5500','#FF5500','#FFAA55']]),mark:zones([['#005555','#FFFFAA','#FFFFAA']]),
    space:hex('#005555'),spaceInk:hex('#FFFFAA')},
  survey:{name:'Survey',note:'Olive land, deep water',
    ground:zones([['#005555','#AAAA55','#000000','#00AAAA'],['#005555','#555500','#000000','#005555'],['#000000','#555500','#000000','#000000']]),
    shade:zones([['#000000','#555500','#000000','#000000'],['#000000','#555500','#000000','#000000'],['#000000','#555500','#000000','#000000']]),
    hour:zones([['#FFFFFF','#FFFFFF','#FFFFAA']]),route:zones([['#FF5500','#FF5500','#FFAA00']]),mark:zones([['#FFFFFF','#FFFFFF','#FFFFAA']]),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  nocturne:{name:'Nocturne',note:'Cobalt water, lamp-lit type',
    ground:zones([['#0055AA','#55AAAA','#AAFFFF','#0055AA'],['#000055','#005555','#55AAAA','#000055'],['#000000','#000055','#0055AA','#000000']]),
    shade:zones([['#000055','#005555','#55AAAA','#000055'],['#000055','#005555','#55AAAA','#000055'],['#000000','#000055','#0055AA','#000000']]),
    hour:zones([['#FFFFAA','#FFFFAA','#FFFFAA']]),route:zones([['#FFAA00','#FFAA00','#FFAA00']]),mark:zones([['#FFFFAA','#FFFFAA','#FFFFAA']]),
    space:hex('#000000'),spaceInk:hex('#FFFFAA')}
};

// Two framings share one north-up equidistant cylindrical projection.
// Sun and Moon: the hour's stations sit SPAN pixels apart on a horizontal
// line at TRACK_Y. The ISS covers about 240 degrees of longitude in an hour,
// so it gets the whole world in a band, with its hours set in the margins.
export const SPAN=128,TRACK_Y=150,WORLD={south:-60,north:72,bottom:H-10};
export function chartCamera(body,start,{span=SPAN,center=null}={}){
  const world=body!=='sun'&&body!=='moon',step=world?MINUTE/4:MINUTE,lead=(world?20:40)*MINUTE;
  const raw=sampleTrack(body,start-lead,start+60*MINUTE+lead,step);
  // Unwrap longitude so the route is continuous across the antimeridian.
  let turn=0;const track=raw.map((p,i)=>{
    if(i){const d=p.lon-raw[i-1].lon;if(d>180)turn-=360;else if(d<-180)turn+=360;}
    return {...p,lon:p.lon+turn,hour:p.epoch>=start&&p.epoch<=start+60*MINUTE};
  });
  const hour=track.filter(p=>p.hour),lons=hour.map(p=>p.lon),lats=hour.map(p=>p.lat);
  // By default the view centres the hour; with center (an epoch) the world
  // slides under a fixed index instead, the body always in the middle.
  const here=center===null?null:track.reduce((a,b)=>Math.abs(b.epoch-center)<Math.abs(a.epoch-center)?b:a);
  const lon0=here?here.lon:(Math.max(...lons)+Math.min(...lons))/2;
  let scale,k,lat0,y0;
  if(world){
    // Fit the hour's longitudes; the band keeps its true proportions.
    scale=(W-16)/Math.max(180,Math.max(...lons)-Math.min(...lons));k=1;lat0=WORLD.south;y0=WORLD.bottom;
  }
  else{
    lat0=(Math.max(...lats)+Math.min(...lats))/2;k=Math.cos(lat0*RAD);
    scale=span/Math.max(1,(Math.max(...lons)-Math.min(...lons))*k);y0=TRACK_Y;
  }
  const toScreen=(lat,lon)=>({x:W/2+(lon-lon0)*k*scale,y:y0-(lat-lat0)*scale});
  const toGround=(x,y)=>({lat:lat0+(y0-y)/scale,lon:lon0+(x-W/2)/(k*scale)});
  for(const p of track)Object.assign(p,toScreen(p.lat,p.lon));
  // Any other direction is drawn on the copy nearest the middle of the view.
  const project=(lat,lon)=>{
    let best;for(const t of [-360,0,360]){const q=toScreen(lat,lon+t);if(!best||Math.abs(q.x-W/2)<Math.abs(best.x-W/2))best=q;}
    return best;
  };
  const band=world?{top:Math.ceil(toScreen(WORLD.north,0).y),bottom:Math.floor(toScreen(WORLD.south,0).y)}:{top:0,bottom:H};
  return {body,start,world,track,scale,band,toScreen,toGround,project,stations:[hour[0],hour.at(-1)],key:`${body}/${start}${here?`/${center}`:''}`};
}

// Land coverage by bilinear interpolation of the quarter-degree atlas. Each
// display pixel averages four samples and keeps the majority: the atlas's
// stair steps become smooth shorelines without inventing coastline detail.
function coverage(atlas,lat,lon){
  const u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
  const bit=(x,y)=>{x=((x%1440)+1440)%1440;y=Math.max(0,Math.min(719,y));const n=y*1440+x;return (atlas[n>>3]>>(n&7))&1;};
  return (bit(i,j)*(1-fu)+bit(i+1,j)*fu)*(1-fv)+(bit(i,j+1)*(1-fu)+bit(i+1,j+1)*fu)*fv;
}
const SAMPLES=[[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
export function groundLayer(camera,atlas){
  const land=new Uint8Array(W*H),dirs=new Array(W*H).fill(null),space=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x;
    if(y<camera.band.top||y>camera.band.bottom||camera.outside?.(x+.5,y+.5)){space[i]=1;continue;}
    let c=0;for(const [dx,dy] of SAMPLES){const g=camera.toGround(x+dx,y+dy);c+=coverage(atlas,g.lat,g.lon);}
    const g=camera.toGround(x+.5,y+.5);land[i]=c>=2?1:0;dirs[i]=direction(g.lat,g.lon);
  }
  // The coast is a sea-side outline. One waterline repeats it offshore, as
  // on engraved charts. Both are graphic devices, not measured depth.
  const dist=seaDistance(land),material=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++)material[i]=space[i]?SPACE:land[i]?LAND:dist[i]<=1?COAST:dist[i]===4?WAVE:SEA;
  return {material,dirs};
}
// Chessboard distance, in pixels, from each sea pixel to the nearest land.
function seaDistance(land){
  const d=new Uint16Array(W*H).fill(999);
  for(let i=0;i<W*H;i++)if(land[i])d[i]=0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x;if(x)d[i]=Math.min(d[i],d[i-1]+1);
    if(y){d[i]=Math.min(d[i],d[i-W]+1);if(x)d[i]=Math.min(d[i],d[i-W-1]+1);if(x<W-1)d[i]=Math.min(d[i],d[i-W+1]+1);}
  }
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){
    const i=y*W+x;if(x<W-1)d[i]=Math.min(d[i],d[i+1]+1);
    if(y<H-1){d[i]=Math.min(d[i],d[i+W]+1);if(x<W-1)d[i]=Math.min(d[i],d[i+W+1]+1);if(x)d[i]=Math.min(d[i],d[i+W-1]+1);}
  }
  return d;
}
// Day, civil twilight and night from the Sun at this minute, as flat zones.
export const sunAt=epoch=>position('sun',Math.floor(epoch/MINUTE)*MINUTE).dir;
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export function lightLayer(ground,epoch){
  const sun=sunAt(epoch),light=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){
    const d=ground.dirs[i];if(!d){light[i]=DAY;continue;}
    const a=dot(d,sun);
    if(a>=SUNRISE_SINE)light[i]=DAY;
    else if(a<CIVIL_TWILIGHT_SINE)light[i]=NIGHT;
    else{
      // Through civil twilight, a fixed ordered screen moves from dusk to
      // night: the band has direction without a new color.
      const t=(SUNRISE_SINE-a)/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE),x=i%W,y=(i-x)/W;
      light[i]=t*16>BAYER[(y&3)*4+(x&3)]+.5?NIGHT:DUSK;
    }
  }
  return light;
}

// Hour numerals are the map's lettering. The current hour is solid and the
// next hour is a two-pixel inline, so the pair reads in order at a glance.
export const HOUR_SIZE={one:104,two:80,world:80,worldTwo:72};
const glyphRun=(text,size)=>{
  const set=numerals.sizes[size],gap=Math.round(size/16);
  const glyphs=[...text].map(c=>set[c]),width=glyphs.reduce((s,g)=>s+g.width,0)+gap*(glyphs.length-1);
  return {glyphs,width,height:Math.max(...glyphs.map(g=>g.height)),gap};
};
export function hourLabels(camera,timeZone,clock24){
  const labels=camera.stations.map((station,i)=>{
    const raw=Number(clockParts(station.epoch,timeZone).h);
    return {station,text:String(clock24?raw:raw%12||12),next:i===1};
  });
  const two=labels.some(l=>l.text.length>1);
  const size=camera.world?(two?HOUR_SIZE.worldTwo:HOUR_SIZE.world):(two?HOUR_SIZE.two:HOUR_SIZE.one);
  for(const l of labels){
    l.run=glyphRun(l.text,size);
    const x=Math.round(Math.max(8,Math.min(W-8-l.run.width,l.station.x-l.run.width/2)));
    let y=Math.round(l.station.y-16-l.run.height);
    // Above the world band, each hour stands over its station.
    if(camera.world)y=Math.round((camera.band.top-l.run.height)/2);
    l.box={x,y,w:l.run.width,h:l.run.height};
  }
  if(overlap(labels[0].box,labels[1].box)){
    // A short hop (or a two-digit pair): spread the numerals apart evenly.
    const [a,b]=labels.map(l=>l.box),left=a.x<=b.x?a:b,right=left===a?b:a,gap=10;
    const excess=left.x+left.w+gap-right.x;left.x=Math.max(8,Math.round(left.x-excess/2));right.x=Math.min(W-8-right.w,left.x+left.w+gap);
  }
  return labels;
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
export function labelMask(label,solid=!label.next){
  const own=new Uint8Array(W*H);let x=label.box.x;
  for(const g of label.run.glyphs){
    const top=label.box.y+label.run.height-g.height;
    for(let yy=0;yy<g.height;yy++)for(let xx=0;xx<g.width;xx++)if(g.rows[yy][xx]==='#'){
      const px=x+xx,py=top+yy;if(px>=0&&px<W&&py>=0&&py<H)own[py*W+px]=1;
    }
    x+=g.width+label.run.gap;
  }
  if(solid)return own;
  let core=own;
  for(let pass=0;pass<2;pass++)core=core.map((v,i)=>v&&core[i-1]&&core[i+1]&&core[i-W]&&core[i+W]?1:0);
  return own.map((v,i)=>v&&!core[i]?1:0);
}

// A numeral stands a few pixels above the map. Its flat shadow falls away
// from the calculated Sun: short near the subsolar point, none at night.
export const NUMERAL_HEIGHT=3;
export function shadowOffset(camera,x,y,sun){
  const g=camera.toGround(x,y),up=direction(g.lat,g.lon),alt=dot(up,sun);
  if(alt<=.05)return null;
  const east=[-Math.sin(g.lon*RAD),Math.cos(g.lon*RAD),0];
  const north=[-Math.sin(g.lat*RAD)*Math.cos(g.lon*RAD),-Math.sin(g.lat*RAD)*Math.sin(g.lon*RAD),Math.cos(g.lat*RAD)];
  const e=dot(sun,east),n=dot(sun,north),flat=Math.hypot(e,n);
  if(flat<1e-6)return {dx:0,dy:0};
  const length=Math.min(4,NUMERAL_HEIGHT*flat/alt);
  // Screen x points east and screen y points south; shadows point away.
  return {dx:Math.round(-e/flat*length)||0,dy:Math.round(n/flat*length)||0};
}
function numeralShadows(camera,labels,sun){
  const shade=new Uint8Array(W*H);
  for(const l of labels){
    const o=shadowOffset(camera,l.box.x+l.box.w/2,l.box.y+l.box.h,sun);
    if(camera.world||l.next||!o||(!o.dx&&!o.dy))continue;
    const own=labelMask(l,true),steps=Math.max(Math.abs(o.dx),Math.abs(o.dy));
    // Sweep the whole offset so each shadow joins its numeral.
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(own[y*W+x])for(let s=1;s<=steps;s++){
      const px=x+Math.round(o.dx*s/steps),py=y+Math.round(o.dy*s/steps);
      if(px>=0&&px<W&&py>=0&&py<H&&!own[py*W+px])shade[py*W+px]=1;
    }
  }
  return shade;
}

// Whole-pixel drawing into an RGB buffer.
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

export function renderChart({camera,ground,light,labels,theme,epoch,timeZone}){
  const pal=CHARTS[theme],buf=new Uint8ClampedArray(W*H*3),sun=sunAt(epoch);
  const inked=new Uint8Array(W*H);for(const l of labels)labelMask(l).forEach((v,i)=>{if(v)inked[i]=1;});
  const shade=numeralShadows(camera,labels,sun);
  // Knockouts restore the plain ground color under marks, as a cartographer
  // clears linework beneath lettering; no extra halo color is introduced.
  const plain=i=>ground.material[i]===SPACE?pal.space:pal.ground[light[i]][ground.material[i]===COAST||ground.material[i]===WAVE?SEA:ground.material[i]];
  for(let i=0;i<W*H;i++){
    const m=ground.material[i];
    buf.set(inked[i]?(m===SPACE?pal.spaceInk:pal.hour[0][light[i]]):m===SPACE?pal.space:(shade[i]?pal.shade:pal.ground)[light[i]][m],i*3);
  }
  const clear=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x>=0&&y>=0&&x<W&&y<H)plot(buf,x,y,plain(y*W+x));};
  const zone=(x,y)=>light[Math.max(0,Math.min(H-1,Math.round(y)))*W+Math.max(0,Math.min(W-1,Math.round(x)))];
  const route=(x,y)=>pal.route[0][zone(x,y)],ink=(x,y)=>pal.mark[0][zone(x,y)];
  const track=camera.track,now=Math.floor(epoch/MINUTE)*MINUTE,[s0]=camera.stations;
  const jump=(a,b)=>Math.abs(b.x-a.x)>W/2;
  const occupied=new Uint8Array(W*H),mark=(x,y)=>{if(x>=0&&y>=0&&x<W&&y<H)occupied[y*W+x]=1;};
  // Before and after the hour: a sparse dotted line, the path continuing.
  for(let i=1;i<track.length;i++){
    const a=track[i-1],b=track[i];if(jump(a,b)||(a.hour&&b.hour))continue;
    segment(a,b,(x,y)=>{if(((x+y)&3)===0)plot(buf,x,y,route(x,y));});
  }
  // The hour: elapsed time is a bold line, the rest a fine one.
  for(let i=1;i<track.length;i++){
    const a=track[i-1],b=track[i];if(!a.hour||!b.hour||jump(a,b))continue;
    const bold=b.epoch<=now,steep=Math.abs(b.y-a.y)>Math.abs(b.x-a.x);
    segment(a,b,(x,y)=>{
      for(let k=bold?-1:0;k<=(bold?1:0);k++){const px=steep?x+k:x,py=steep?y:y+k;plot(buf,px,py,route(x,y));mark(px,py);}
    });
  }
  // Five-minute ticks on one side; quarter hours are longer.
  for(let i=1;i<track.length-1;i++){
    const p=track[i];if(!p.hour)continue;const m=Math.round((p.epoch-s0.epoch)/MINUTE);if(m%5||m===0||m===60)continue;
    const a=track[i-1],b=track[i+1],len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    let nx=-(b.y-a.y)/len,ny=(b.x-a.x)/len;if(ny<0||(Math.abs(ny)<1e-6&&nx<0)){nx=-nx;ny=-ny;}
    const size=m%15===0?6:4;for(let s=2;s<=size;s++){const x=Math.round(p.x+nx*s),y=Math.round(p.y+ny*s);plot(buf,x,y,route(p.x,p.y));mark(x,y);}
  }
  // Stations are stops on a transit map: this hour filled, the next open.
  camera.stations.forEach((s,n)=>{
    const x=Math.round(s.x),y=Math.round(s.y),c=route(x,y);
    for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){
      const r2=dx*dx+dy*dy;if(r2>27)continue;mark(x+dx,y+dy);
      if(r2>=11||n===0)plot(buf,x+dx,y+dy,c);else clear(x+dx,y+dy);
    }
  });
  // The present: the body's own glyph on a knockout, then the minute.
  const body=position(camera.body,epoch),p=camera.project(body.lat,body.lon),mx=Math.round(p.x),my=Math.round(p.y);
  drawMarker(buf,camera.body,mx,my,epoch,ink(mx,my),clear);
  for(let dy=-7;dy<=7;dy++)for(let dx=-7;dx<=7;dx++)mark(mx+dx,my+dy);
  const minute=clockParts(epoch,timeZone).m,font=drafts.medium,tw=textWidth(font,minute);
  const spots=[[0,24],[0,-12],[tw/2+14,6],[-tw/2-14,6]].map(([dx,dy])=>({x:Math.round(mx+dx-tw/2),y:Math.round(my+dy)}));
  const cost=({x,y})=>{
    let n=0;
    for(const [px,py] of textPixels(font,minute,x,y))for(let d=-2;d<=2;d++){const i=(py+d)*W+px;if(py+d<0||py+d>=H||px<2||px>=W-2)n+=5;else if(occupied[i]||inked[i])n++;}
    return n;
  };
  const spot=spots.reduce((best,s)=>cost(s)<cost(best)?s:best);
  const pixels=textPixels(font,minute,spot.x,spot.y);
  for(const [px,py] of pixels)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)clear(px+dx,py+dy);
  for(const [px,py] of pixels)plot(buf,px,py,ink(px,py));
  return {buf,marker:{x:p.x,y:p.y,lat:body.lat,lon:body.lon},minuteBox:{x:spot.x,y:spot.y-12,w:tw,h:12}};
}

function disc(fn,cx,cy,r){const n=Math.ceil(r);for(let dy=-n;dy<=n;dy++)for(let dx=-n;dx<=n;dx++)if(dx*dx+dy*dy<=r*r)fn(cx+dx,cy+dy,dx,dy);}
// Markers name the body without a word: a Sun with eight rays, the Moon in
// its actual phase, or a small station for the ISS.
function drawMarker(buf,body,x,y,epoch,ink,clear){
  const dot_=(px,py)=>plot(buf,px,py,ink);
  if(body==='sun'){
    disc(clear,x,y,7.2);disc(dot_,x,y,3.6);
    for(let a=0;a<8;a++){const t=a*Math.PI/4;dot_(x+Math.round(Math.cos(t)*6),y+Math.round(Math.sin(t)*6));}
  }else if(body==='moon'){
    const {fraction,waxing}=moonLight(epoch),r=5.2;disc(clear,x,y,r+1.6);
    // The lit part in ink, bounded by the terminator ellipse; a rim keeps a
    // thin crescent or a new Moon visible.
    disc((px,py,dx,dy)=>{
      const edge=Math.sqrt(Math.max(0,r*r-dy*dy)),side=waxing?dx:-dx,lit=side>=(1-2*fraction)*edge;
      if(lit||dx*dx+dy*dy>(r-1.2)*(r-1.2))dot_(px,py);
    },x,y,r);
  }else{
    disc(clear,x,y,6.5);
    for(let k=-5;k<=5;k++){dot_(x+k,y);if(Math.abs(k)>=3){dot_(x+k,y-1);dot_(x+k,y+1);}}
    for(let k=-2;k<=2;k++){dot_(x-1,y+k);dot_(x+1,y+k);dot_(x,y+k);}
  }
}

export function toRGBA(buf){
  const out=new Uint8ClampedArray(W*H*4);
  for(let i=0;i<W*H;i++){out[i*4]=buf[i*3];out[i*4+1]=buf[i*3+1];out[i*4+2]=buf[i*3+2];out[i*4+3]=255;}
  return out;
}

// Caches follow the clock: the camera and ground change with the civil hour,
// the light zones with the minute, and lettering with the clock format.
export class ChartRenderer{
  constructor(atlas){this.atlas=atlas;this.stats={geometryBuilds:0,lightBuilds:0,labelBuilds:0,renders:0};}
  render(state){
    const {body,epoch,timeZone,clock24,theme}=state,start=civilHour(epoch,timeZone);
    const geometryKey=`${body}/${start}`,lightKey=`${geometryKey}/${Math.floor(epoch/MINUTE)}`,labelKey=`${geometryKey}/${timeZone}/${clock24}`;
    if(this.geometryKey!==geometryKey){
      this.camera=chartCamera(body,start);this.ground=groundLayer(this.camera,this.atlas);this.geometryKey=geometryKey;this.stats.geometryBuilds++;
    }
    if(this.lightKey!==lightKey){this.light=lightLayer(this.ground,epoch);this.lightKey=lightKey;this.stats.lightBuilds++;}
    if(this.labelKey!==labelKey){this.labels=hourLabels(this.camera,timeZone,clock24);this.labelKey=labelKey;this.stats.labelBuilds++;}
    const sceneKey=`${lightKey}/${labelKey}/${theme}`;if(this.sceneKey===sceneKey)return this.last;
    const out=renderChart({camera:this.camera,ground:this.ground,light:this.light,labels:this.labels,theme,epoch,timeZone});
    const zones=[0,0,0];for(const z of this.light)zones[z]++;
    this.sceneKey=sceneKey;this.stats.renders++;
    this.last={...out,rgba:toRGBA(out.buf),start,time:clockParts(epoch,timeZone).text,hours:this.labels.map(l=>({value:l.text,next:l.next,box:{...l.box}})),
      stations:this.camera.stations.map(s=>({x:s.x,y:s.y,epoch:s.epoch})),zones,world:this.camera.world};
    return this.last;
  }
}
// The start of the civil hour containing an instant, in any time zone,
// including half- and quarter-hour offsets.
export function civilHour(epoch,timeZone){
  if(!Number.isFinite(epoch))throw new RangeError('Invalid time');
  return Math.floor(epoch/MINUTE)*MINUTE-Number(clockParts(epoch,timeZone).m)*MINUTE;
}
