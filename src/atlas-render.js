import {atlasCamera,localNorth} from './atlas-camera.js';
import {sculptureGeometry} from './art-render.js';
import {solarLight,sunVolumeHit} from './art-light.js';
import {clockParts,landAt} from './render.js';
import {position,MINUTE,sampleTrack} from './ephemeris.js';
import {dot,direction,lonLat,angularDistance} from './geometry.js';
import {EDGES,faceOf} from './fuller.js';
import {mapTrack} from './unfold.js';
import {drawPixelLine} from './pixels.js';
import {drawBitmapText,textWidth} from './type.js';
import draft from '../data/draft-font.json' with {type:'json'};
import cities from '../data/cities.json' with {type:'json'};
import dither from '../data/dither.json' with {type:'json'};
export const INKS={chalk:{name:'Graphite',dark:'#555555',light:'#FFFFFF'},blue:{name:'Cyanotype',dark:'#000055',light:'#AAAAFF'},ochre:{name:'Earthwork',dark:'#550000',light:'#FFAA55'}};
export const HOMES={norfolk:{name:'Norfolk',lat:36.85,lon:-76.29},london:{name:'London',lat:51.51,lon:-.13},tokyo:{name:'Tokyo',lat:35.68,lon:139.69},sydney:{name:'Sydney',lat:-33.87,lon:151.21}};
const W=200,H=228,clamp=x=>Math.max(0,Math.min(1,x));
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
export const lightPixel=(amount,x,y)=>amount>(dither.ranks[(y&31)*32+(x&31)]+.5)/1024;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export function groundTone(land,solar,shadow=false){
  // Posterize the response into broad quiet fields. Halftone belongs around
  // the terminator and the cast shadows, not as static across every ocean.
  const diffuse=smooth(-.07,.07,solar);
  return land?(shadow?0:diffuse):0;
}
const text=(ctx,s,x,y,color,align='left')=>drawBitmapText(ctx,draft.small,s,x,y,color,align);
const line=(ctx,a,b,col)=>drawPixelLine(ctx,a.x,a.y,b.x,b.y,col);
const inside=(p,pad=0)=>p&&p.x>=pad&&p.x<W-pad&&p.y>=pad&&p.y<H-pad;
function disk(ctx,x,y,r,c){ctx.fillStyle=c;x=Math.round(x);y=Math.round(y);for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)if(dx*dx+dy*dy<=r*r)ctx.fillRect(x+dx,y+dy,1,1);}
function outlinedLine(ctx,a,b,ink){
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-2,0],[2,0],[0,-2],[0,2]])line(ctx,{x:a.x+dx,y:a.y+dy},{x:b.x+dx,y:b.y+dy},ink.light);
  line(ctx,a,b,ink.dark);
}
function routeLines(ctx,segments,ink){
  // All under-strokes first. Stroking each tiny segment with its own halo
  // erases the preceding segment, turning a continuous path into fragments.
  for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1],[-2,0],[2,0],[0,-2],[0,2]])for(const [a,b] of segments)
    line(ctx,{x:a.x+dx,y:a.y+dy},{x:b.x+dx,y:b.y+dy},ink.light);
  for(const [a,b] of segments)line(ctx,a,b,ink.dark);
}
function cutEdge(ctx,a,b,ink,background,light){
  let x=Math.round(a.x),y=Math.round(a.y);const xx=Math.round(b.x),yy=Math.round(b.y);
  const dx=Math.abs(xx-x),sx=x<xx?1:-1,dy=-Math.abs(yy-y),sy=y<yy?1:-1;let error=dx+dy;
  while(true){
    if(x>=0&&x<W&&y>=0&&y<H){const i=(y*W+x)*4;
      ctx.fillStyle=background[i]===light[0]&&background[i+1]===light[1]&&background[i+2]===light[2]?ink.dark:ink.light;
      ctx.fillRect(x,y,1,1);
    }
    if(x===xx&&y===yy)break;const twice=2*error;if(twice>=dy){error+=dy;x+=sx;}if(twice<=dx){error+=dx;y+=sy;}
  }
}
const overlap=(a,b)=>a.x<b.x+b.w+3&&a.x+a.w+3>b.x&&a.y<b.y+b.h+3&&a.y+a.h+3>b.y;
function label(ctx,s,x,y,ink,occupied,align='left'){
  const w=textWidth(draft.small,s),left=Math.round(x-(align==='right'?w:align==='center'?w/2:0));
  const box={x:left-2,y:Math.round(y)-7,w:w+4,h:10};
  if(box.x<3||box.x+box.w>197||box.y<23||box.y+box.h>192||occupied.some(b=>overlap(box,b)))return false;
  ctx.fillStyle=ink.light;ctx.fillRect(box.x,box.y,box.w,box.h);text(ctx,s,left,y,ink.dark);occupied.push(box);return true;
}
function boundingBox(fragments){
  const xs=fragments.map(p=>p.x),ys=fragments.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs)+1,h:Math.max(...ys)-Math.min(...ys)+1};
}
export class AtlasRenderer{
  constructor(canvas,land){
    canvas.width=W;canvas.height=H;this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.land=land;
    this.stats={geometryBuilds:0,typeBuilds:0,lightingBuilds:0,renders:0};
  }
  buildGeometry(state){
    const key=[state.body,state.start,state.minutes,state.zoom,state.timeZone,state.clock24].join('/');
    if(this.geometryKey===key)return;
    this.geometryKey=key;this.stats.geometryBuilds++;
    const camera=this.camera=atlasCamera(state.body,state.start,state.minutes,state.zoom);
    this.ground=new Array(W*H);this.landMask=new Uint8Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,p=camera.at(x+.5,y+.5);this.ground[i]=p;
      this.landMask[i]=p?+landAt(this.land,p.dir):0;
    }
    this.hours=[];
    for(const station of camera.track){
      if(station.epoch%MINUTE!==0||Number(clockParts(station.epoch,state.timeZone).m)!==0||!inside(station,20))continue;
      const raw=Number(clockParts(station.epoch,state.timeZone).h),value=String(state.clock24?raw:raw%12||12);
      const offset=value.length===2?43:36;
      const centerY=Math.max(71,Math.min(162,station.y));
      // Give each monument a clear footprint beside its hour station. A
      // curving route must never run through the numeral's counters.
      const candidates=[];
      for(const sign of [-1,1])for(const extra of [0,14]){
        const cx=station.x+sign*(offset+extra);if(cx<24||cx>176)continue;
        const ground=camera.at(cx,centerY);if(!ground)continue;
        const local=camera.forTower(ground.dir,ground.tile),height=11/(camera.scale*.8);
        const sculpture=sculptureGeometry(local,ground.dir,value,height);if(!sculpture.fragments.length)continue;
        const box=boundingBox(sculpture.fragments);
        if(box.x<5||box.x+box.w>195||box.y<24||box.y+box.h>192||this.hours.some(h=>overlap(h.box,box)))continue;
        const collisions=camera.track.filter(p=>p.x>box.x-6&&p.x<box.x+box.w+6&&p.y>box.y-6&&p.y<box.y+box.h+6).length;
        candidates.push({ground,sculpture,box,score:collisions*100+extra+(ground.tile===station.tile?0:3)});
      }
      candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)continue;
      const {ground,sculpture,box}=candidates[0];
      this.hours.push({value,station,ground,sculpture,box,land:landAt(this.land,ground.dir)});this.stats.typeBuilds++;
      if(this.hours.length===3)break;
    }
    this.cityCopies=cities.cities.map(city=>({...city,dir:direction(city.lat,city.lon)})).map(city=>({...city,copies:camera.allCopies(city.dir).filter(p=>inside(p,5))}));
    this.sceneKey='';
  }
  current(state){
    const nearest=this.camera.track.reduce((best,p)=>Math.abs(p.epoch-state.epoch)<Math.abs(best.epoch-state.epoch)?p:best);
    const actual=position(state.body,state.epoch),face=faceOf(actual.dir);
    const tile=face===nearest.tile.face?nearest.tile:this.camera.project(actual.dir).tile;
    return {...actual,...this.camera.projectIn(tile,actual.dir),tile};
  }
  drawLocator(ctx,point,home,ink){
    // A tiny conventional world inset ties the repeated local atlas back to
    // a familiar whole Earth. Solid marker = body, hollow marker = home.
    const x0=8,y0=195,w=47,h=24;ctx.fillStyle=ink.light;ctx.fillRect(x0-2,y0-2,w+4,h+4);
    ctx.fillStyle=ink.dark;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(landAt(this.land,direction(90-(y+.5)*180/h,(x+.5)*360/w-180)))ctx.fillRect(x0+x,y0+y,1,1);
    const xy=d=>{const ll=lonLat(d);return {x:x0+(ll.lon+180)*w/360,y:y0+(90-ll.lat)*h/180};};
    const body=xy(point.dir),hp=xy(direction(home.lat,home.lon));
    disk(ctx,body.x,body.y,2,ink.light);disk(ctx,body.x,body.y,1,ink.dark);
    disk(ctx,hp.x,hp.y,2,ink.dark);disk(ctx,hp.x,hp.y,1,ink.light);
    return {body,home:hp};
  }
  render(state){
    this.buildGeometry(state);
    const sceneKey=[this.geometryKey,Math.floor(state.epoch/MINUTE),state.ink,state.home,state.cities,state.edges,state.secondary].join('/');
    if(sceneKey===this.sceneKey)return this.last;
    this.sceneKey=sceneKey;this.stats.lightingBuilds++;
    const ctx=this.ctx,camera=this.camera,ink=INKS[state.ink],colors=[rgb(ink.dark),rgb(ink.light)],sun=solarLight(state.epoch);
    const image=ctx.createImageData(W,H),shadowMask=new Uint8Array(W*H),tones=new Float32Array(W*H);
    let shadowPixels=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,ground=this.ground[i];let shade=.5;
      if(ground){
        const shadow=this.hours.some(h=>sunVolumeHit(ground.dir,sun,h.sculpture.cap));
        if(shadow){shadowMask[i]=1;shadowPixels++;}
        shade=groundTone(this.landMask[i],dot(ground.dir,sun));
      }
      tones[i]=shade;
    }
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      // A two-pixel penumbra is a display treatment at the shadow boundary.
      // Interiors remain solid. Never sprinkle ambient noise over flat areas.
      const i=y*W+x;let cover=0,count=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H){cover+=shadowMask[(y+dy)*W+x+dx];count++;}
      const col=colors[+lightPixel(tones[i]*(1-cover/count),x,y)];image.data.set([...col,255],i*4);
    }
    ctx.putImageData(image,0,0);
    let seams=0;const edges=new Set();
    for(const {tile,points} of camera.triangles)for(let e=0;e<3;e++){
      const [i,j]=EDGES[e],a={x:points[i][0],y:points[i][1]},b={x:points[j][0],y:points[j][1]};
      const id=[tile.key,tile.links[e].tile?.key||`edge${e}`].sort().join('/');if(edges.has(id))continue;edges.add(id);
      if(tile.links[e].seam){cutEdge(ctx,a,b,ink,image.data,colors[1]);seams++;}
      else if(state.edges){
        // One sparse, stable stipple at genuine folds; solid outlined edges
        // are reserved for geographical cuts. No antialiased dashed paths.
        const length=Math.hypot(b.x-a.x,b.y-a.y);ctx.fillStyle=ink.light;
        for(let t=0;t<=length;t+=5)ctx.fillRect(Math.round(a.x+(b.x-a.x)*t/length),Math.round(a.y+(b.y-a.y)*t/length),1,1);
      }
    }
    let nightLights=0;
    if(state.cities)for(const city of this.cityCopies)if(dot(city.dir,sun)<-.03&&nightLights<15&&city.population>2e6){
      const p=city.copies.sort((a,b)=>Math.hypot(a.x-100,a.y-114)-Math.hypot(b.x-100,b.y-114))[0];if(!p)continue;
      ctx.fillStyle=ink.light;ctx.fillRect(Math.round(p.x),Math.round(p.y),1,1);nightLights++;
    }
    for(const h of this.hours){
      const back=ctx.getImageData(0,0,W,H).data;
      const caps=h.sculpture.fragments.filter(p=>p.top);
      const lit=caps.reduce((sum,p)=>sum+ +(back[(p.y*W+p.x)*4]===colors[1][0]&&back[(p.y*W+p.x)*4+1]===colors[1][1]),0);
      const roof=lit>caps.length*.5?0:1;
      // A one-pixel roof bevel keeps the lettering whole where it crosses a
      // coastline or its own shadow. It is part of the numeral, not a panel.
      const capSet=new Set(caps.map(p=>p.y*W+p.x));
      ctx.fillStyle=roof?ink.dark:ink.light;
      for(const p of caps)for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])if(!capSet.has((p.y+dy)*W+p.x+dx))ctx.fillRect(p.x+dx,p.y+dy,1,1);
      for(const p of h.sculpture.fragments){
      // The same two inks and same fixed dither screen shade all surfaces.
      // The roof is clock lettering: use the opposite ink to its ground so
      // a white numeral cannot disappear into a sunlit white continent.
      const tone=p.top?roof:smooth(.08,.32,dot(p.normal,sun));
      ctx.fillStyle=lightPixel(tone,p.x,p.y)?ink.light:ink.dark;ctx.fillRect(p.x,p.y,1,1);
      }
      // Recessed counters keep 0/6/8/9 readable; an exaggerated extrusion
      // must not fill the openings with a brightly lit rear wall.
      ctx.fillStyle=roof?ink.dark:ink.light;
      for(const [x,y] of h.sculpture.cap.counterPixels)ctx.fillRect(x,y,1,1);
    }
    let secondarySegments=0;
    if(state.secondary!=='none'&&state.secondary!==state.body){
      // Secondary positions are calculated independently at the SAME dates.
      const track=mapTrack(camera.atlas,sampleTrack(state.secondary,state.start,camera.end,MINUTE*2));
      for(let i=1;i<track.length;i++)if(!track[i].cut){
        const a=camera.screen(track[i-1].xy),b=camera.screen(track[i].xy);
        const len=Math.hypot(b.x-a.x,b.y-a.y);ctx.fillStyle=ink.light;
        for(let n=0;n<len;n+=4){const x=Math.round(a.x+(b.x-a.x)*n/len),y=Math.round(a.y+(b.y-a.y)*n/len);disk(ctx,x,y,1,ink.dark);ctx.fillStyle=ink.light;ctx.fillRect(x,y,1,1);}
        secondarySegments++;
      }
    }
    const track=camera.track,cuts=[],segments=[];
    for(let i=1;i<track.length;i++){
      const a=track[i-1],b=track[i];if(b.cut){cuts.push({a,b});continue;}
      segments.push([a,b]);
    }
    const ticks=[];
    for(let i=0;i<track.length;i++){
      const p=track[i];if(p.epoch%MINUTE!==0||!inside(p,10))continue;
      const minute=Number(clockParts(p.epoch,state.timeZone).m),major=minute===0;
      if(minute%5)continue;
      const a=track[Math.max(0,i-1)],b=track[Math.min(track.length-1,i+1)];if(p.cut||b.cut)continue;
      const length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
      const size=major?7:3;
      segments.push([{x:p.x-nx*size,y:p.y-ny*size},{x:p.x+nx*size,y:p.y+ny*size}]);
      ticks.push({epoch:p.epoch,major,x:p.x,y:p.y});
    }
    routeLines(ctx,segments,ink);
    // Matching letters mark the ends of each jump; no invented connector.
    const current=this.current(state),clock=clockParts(state.epoch,state.timeZone);
    const occupied=[...this.hours.map(h=>h.box),{x:current.x-8,y:current.y-10,w:36,h:22}],cutLabels=[];
    cuts.forEach(({a,b},i)=>{
      const name=String.fromCharCode(65+i);
      for(const p of [a,b])if(inside(p,7)){
        disk(ctx,p.x,p.y,3,ink.light);disk(ctx,p.x,p.y,1,ink.dark);
        let placed=false;
        for(const [dx,dy] of [[6,-4],[-10,-4],[6,12],[-10,12]])if(label(ctx,name,p.x+dx,p.y+dy,ink,occupied)){placed=true;break;}
        if(!placed){ctx.fillStyle=ink.light;ctx.fillRect(Math.round(p.x)-4,Math.round(p.y)-4,9,9);text(ctx,name,p.x,p.y+3,ink.dark,'center');}
        cutLabels.push(name);
      }
    });
    const home=HOMES[state.home],homeDir=direction(home.lat,home.lon);
    const homeCopies=camera.allCopies(homeDir).filter(p=>inside(p,12)).sort((a,b)=>Math.hypot(a.x-current.x,a.y-current.y)-Math.hypot(b.x-current.x,b.y-current.y));
    let homeVisible=false;
    if(homeCopies.length){const p=homeCopies[0];
      outlinedLine(ctx,{x:p.x-3,y:p.y},{x:p.x,y:p.y-3},ink);outlinedLine(ctx,{x:p.x,y:p.y-3},{x:p.x+3,y:p.y},ink);
      ctx.fillStyle=ink.light;ctx.fillRect(Math.round(p.x)-2,Math.round(p.y),5,4);ctx.fillStyle=ink.dark;ctx.fillRect(Math.round(p.x)-1,Math.round(p.y)+1,3,2);
      homeVisible=true;label(ctx,'HOME',p.x+7,p.y+3,ink,occupied);
    }
    const named=[];
    if(state.cities){
      const choices=this.cityCopies.map(c=>({...c,p:c.copies.filter(p=>p.y>30&&p.y<183).sort((a,b)=>Math.hypot(a.x-current.x,a.y-current.y)-Math.hypot(b.x-current.x,b.y-current.y))[0]})).filter(c=>c.p&&c.population>=1e6).sort((a,b)=>angularDistance(a.dir,current.dir)-angularDistance(b.dir,current.dir));
      for(const c of choices){
        const name=c.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();if(name.length>14)continue;
        for(const dx of [5,-5])if(label(ctx,name,c.p.x+dx,c.p.y+2,ink,occupied,dx>0?'left':'right')){
          disk(ctx,c.p.x,c.p.y,2,ink.light);disk(ctx,c.p.x,c.p.y,1,ink.dark);named.push(name);break;
        }
        if(named.length===2)break;
      }
    }
    if(inside(current,5)){
      disk(ctx,current.x,current.y,6,ink.light);disk(ctx,current.x,current.y,4,ink.dark);disk(ctx,current.x,current.y,1,ink.light);
      // Always-readable minute, unshaded. The full time in the small heading
      // covers close views where an hour monument is outside the frame.
      const x=current.x>160?current.x-17:current.x+10,y=current.y+3;
      const w=textWidth(draft.small,clock.m);ctx.fillStyle=ink.light;ctx.fillRect(Math.round(x)-2,Math.round(y)-7,w+4,10);text(ctx,clock.m,x,y,ink.dark);
    }
    ctx.fillStyle=ink.light;ctx.fillRect(0,0,W,23);text(ctx,state.body==='iss'?'ISS / ARCHIVE':state.body.toUpperCase(),8,14,ink.dark);text(ctx,clock.text,192,14,ink.dark,'right');
    const locator=this.drawLocator(ctx,current,home,ink);
    ctx.fillStyle=ink.light;ctx.fillRect(62,195,138,33);
    text(ctx,home.name.toUpperCase(),65,204,ink.dark);text(ctx,`HOME ${homeVisible?'ON MAP':'IN INSET'}`,65,215,ink.dark);
    const north=localNorth(camera,current),x=183,y=210;
    line(ctx,{x:x-north.x*5,y:y-north.y*5},{x:x+north.x*6,y:y+north.y*6},ink.dark);
    line(ctx,{x:x+north.x*6,y:y+north.y*6},{x:x+north.x*2-north.y*2,y:y+north.y*2+north.x*2},ink.dark);
    text(ctx,'N',183,197,ink.dark,'center');
    this.stats.renders++;
    this.last={time:clock.text,current:{x:current.x,y:current.y,lat:current.lat,lon:current.lon,face:current.tile.face},hours:this.hours.map(h=>({value:h.value,epoch:h.station.epoch,...h.box})),ticks,cuts:cuts.length,cutLabels,seams,nightLights,cities:named,homeVisible,locator,shadowPixels,secondarySegments,north,unmappedPixels:this.ground.filter(p=>!p).length};
    return this.last;
  }
}
