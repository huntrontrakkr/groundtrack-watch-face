import {artCamera,civilHour,mapNorth} from './art-camera.js';
import {position,sampleTrack,MINUTE,moonLight} from './ephemeris.js';
import {landAt,clockParts} from './render.js';
import {dot,norm} from './geometry.js';
import {solarLight,castSunShadow,sunVolumeHit} from './art-light.js';
import {drawPixelLine,drawPixelRows} from './pixels.js';
import {drawBitmapText,textWidth} from './type.js';
import draft from '../data/draft-font.json' with {type:'json'};
import font from '../data/sculpture-font.json' with {type:'json'};
import dither from '../data/dither.json' with {type:'json'};

export const ART_W=200,ART_H=228;
const TOWER_HEIGHT=.014;
export const MATERIALS={
  chalk:{name:'Chalk',ocean:'#555555',land:'#AAAAAA',nightOcean:'#000000',nightLand:'#555555',shadow:'#000000',face:'#FFFFFF',side:'#555555',route:'#FFFFFF',accent:'#FFAA55',label:'#FFFFFF'},
  basalt:{name:'Basalt',ocean:'#000000',land:'#AAAAAA',nightOcean:'#000000',nightLand:'#555555',shadow:'#000000',face:'#FFFFFF',side:'#AAAAAA',route:'#FFFFFF',accent:'#FFAA55',label:'#FFFFFF'},
  copper:{name:'Ochre',ocean:'#550000',land:'#AA5500',nightOcean:'#000000',nightLand:'#550000',shadow:'#000000',face:'#FFAA55',side:'#FFAA55',route:'#FFFFAA',accent:'#FFFFFF',label:'#FFFFAA'}
};
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
function line(ctx,a,b,color,width=1){
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
  for(let i=0;i<width;i++)drawPixelLine(ctx,a.x-dy/length*i,a.y+dx/length*i,b.x-dy/length*i,b.y+dx/length*i,color);
}
function text(ctx,value,x,baseline,color,align='left'){
  drawBitmapText(ctx,draft.small,value,x,baseline,color,align);
}
function circle(ctx,x,y,r,color){
  ctx.fillStyle=color;x=Math.round(x);y=Math.round(y);
  for(let yy=-r;yy<=r;yy++)for(let xx=-r;xx<=r;xx++)if(xx*xx+yy*yy<=r*r)ctx.fillRect(x+xx,y+yy,1,1);
}
function maskText(value){
  const glyphs=[...value].map(c=>font.glyphs[c]),w=glyphs.reduce((s,g)=>s+g.width+font.gap,0)-font.gap,h=Math.max(...glyphs.map(g=>g.height));
  const bits=new Uint8Array(w*h);let x0=0;
  for(const g of glyphs){for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++)if(g.rows[y][x]==='#')bits[(y+h-g.height)*w+x+x0]=1;x0+=g.width+font.gap;}
  const edgeNormals=new Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(bits[y*w+x]){
    let nearest=Infinity,nx=0,ny=0;
    for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&bits[yy*w+xx])continue;
      const distance=dx*dx+dy*dy;
      if(distance<nearest){nearest=distance;nx=dx;ny=-dy;}
      else if(distance===nearest){nx+=dx;ny-=dy;}
    }
    const length=Math.hypot(nx,ny)||1;edgeNormals[y*w+x]={x:nx/length,y:ny/length,distance:Math.sqrt(nearest)};
  }
  return {w,h,bits,edgeNormals};
}
const numeralMasks=new Map();
function numeral(value){if(!numeralMasks.has(value))numeralMasks.set(value,maskText(value));return numeralMasks.get(value);}

// Render a bitmap glyph onto a physical tangent plane by inverse ray/plane
// intersection. Texture sampling is nearest-neighbor, at the final resolution.
// There is no Canvas font antialiasing or fractional-alpha composite.
function glyphGeometry(camera,dir,value,height){
  const mask=numeral(value),plane=camera.plane(dir,height),reference=camera.plane(dir,0),origin=camera.projectWorld(reference.origin);
  const probe=camera.projectWorld(reference.at(.01,0)),pixelsPerUnit=Math.hypot(probe.x-origin.x,probe.y-origin.y)/.01;
  const sx=1/pixelsPerUnit;
  const probeY=camera.projectWorld(reference.at(0,.01)),verticalScale=Math.hypot(probeY.x-origin.x,probeY.y-origin.y)/.01;
  // Modest compensation: keep the numeral recognizable while retaining a
  // visible, physical foreshortening. Never just shear a screen-space label.
  const sy=1/(verticalScale*1.04);
  const worldCorners=[[-mask.w/2,-mask.h/2],[mask.w/2,-mask.h/2],[mask.w/2,mask.h/2],[-mask.w/2,mask.h/2]]
    .map(([u,v])=>plane.at(u*sx,v*sy));
  const corners=worldCorners.map(camera.projectWorld);
  const x0=clamp(Math.floor(Math.min(...corners.map(p=>p.x)))-1,0,ART_W-1),x1=clamp(Math.ceil(Math.max(...corners.map(p=>p.x)))+1,0,ART_W-1);
  const y0=clamp(Math.floor(Math.min(...corners.map(p=>p.y)))-1,0,ART_H-1),y1=clamp(Math.ceil(Math.max(...corners.map(p=>p.y)))+1,0,ART_H-1);
  const pixels=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const local=plane.inverse(x+.5,y+.5);if(!local)continue;
    const u=Math.floor(local.x/sx+mask.w/2),v=Math.floor(mask.h/2-local.y/sy);
    if(u>=0&&u<mask.w&&v>=0&&v<mask.h&&mask.bits[v*mask.w+u])pixels.push([x,y,u,v]);
  }
  return {pixels,worldCorners,plane,mask,sx,sy,height,contains(local){
    if(!local)return false;
    const u=Math.floor(local.x/sx+mask.w/2),v=Math.floor(mask.h/2-local.y/sy);
    return u>=0&&u<mask.w&&v>=0&&v<mask.h&&mask.bits[v*mask.w+u]===1;
  }};
}

function paintPixels(ctx,pixels,color,dx=0,dy=0){ctx.fillStyle=color;for(const [x,y] of pixels)ctx.fillRect(x+dx,y+dy,1,1);}

function paintSunShadow(ctx,glyph,base,camera,sun,dirs,color){
  if(dot(glyph.plane.normal,sun)<=0)return 0;
  const corners=[...glyph.worldCorners,...base.worldCorners].map(p=>castSunShadow(p,sun));
  // At a grazing angle a corner may miss the globe. Test the full viewport
  // then; never shorten or redirect a real shadow just to fit the picture.
  const projected=corners.every(Boolean)?corners.map(p=>camera.project(p)):null;
  const x0=projected?clamp(Math.floor(Math.min(...projected.map(p=>p.x)))-2,0,ART_W-1):0;
  const x1=projected?clamp(Math.ceil(Math.max(...projected.map(p=>p.x)))+2,0,ART_W-1):ART_W-1;
  const y0=projected?clamp(Math.floor(Math.min(...projected.map(p=>p.y)))-2,0,ART_H-1):0;
  const y1=projected?clamp(Math.ceil(Math.max(...projected.map(p=>p.y)))+2,0,ART_H-1):ART_H-1;
  let pixels=0;ctx.fillStyle=color;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const ground=dirs[y*ART_W+x];
    if(ground&&sunVolumeHit(ground,sun,glyph)){ctx.fillRect(x,y,1,1);pixels++;}
  }
    return pixels;
}

function drawCompass(ctx,camera,pal){
  const x=177,y=203,north=mapNorth(camera,x,y);if(!north)return;
  const across={x:-north.y,y:north.x},tip={x:x+north.x*7,y:y+north.y*7};
  // A small filled north vane and an open tail; no motion-sensor subscription.
  for(let i=-2;i<=2;i++)line(ctx,{x:x+across.x*i,y:y+across.y*i},tip,pal.label);
  line(ctx,{x:x-across.x*2,y:y-across.y*2},{x:x-north.x*7,y:y-north.y*7},pal.label);
  line(ctx,{x:x+across.x*2,y:y+across.y*2},{x:x-north.x*7,y:y-north.y*7},pal.label);
  text(ctx,'N',x+north.x*14,y+north.y*14+3,pal.label,'center');
}

export class ArtRenderer{
  constructor(canvas,atlas){
    this.canvas=canvas;canvas.width=ART_W;canvas.height=ART_H;
    this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.atlas=atlas;
    this.base=document.createElement('canvas');this.base.width=ART_W;this.base.height=ART_H;this.baseCtx=this.base.getContext('2d');
    this.key='';this.stats={geometryBuilds:0,typeBuilds:0,sceneBuilds:0,renders:0};
  }
  buildGeometry(camera){
    if(this.geometryKey===camera.key)return;
    this.geometryKey=camera.key;this.stats.geometryBuilds++;
    const mask=new Uint8Array(ART_W*ART_H),dirs=new Array(mask.length);
    for(let y=0;y<ART_H;y++)for(let x=0;x<ART_W;x++){
      const i=y*ART_W+x,dir=camera.inverse(x+.5,y+.5);dirs[i]=dir;mask[i]=dir?landAt(this.atlas,dir):0;
    }
    const clean=mask.slice();
    for(let y=1;y<ART_H-1;y++)for(let x=1;x<ART_W-1;x++){
      let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)n+=mask[(y+dy)*ART_W+x+dx];
      if(n>=6)clean[y*ART_W+x]=1;else if(n<=3)clean[y*ART_W+x]=0;
    }
    this.geometry={clean,dirs};this.glyphs=new Map();this.sculptures=new Map();
  }
  glyph(camera,dir,value,height){
    const key=[...dir,value,height].join('/');
    if(!this.glyphs.has(key)){
      this.glyphs.set(key,glyphGeometry(camera,dir,value,height));this.stats.typeBuilds++;
    }
    return this.glyphs.get(key);
  }
  sculpture(camera,dir,value){
    const key=[...dir,value].join('/');if(this.sculptures.has(key))return this.sculptures.get(key);
    const base=this.glyph(camera,dir,value,0),cap=this.glyph(camera,dir,value,TOWER_HEIGHT);
    const lower=camera.project(dir),upper=camera.project(dir,TOWER_HEIGHT);
    const steps=Math.max(2,Math.ceil(Math.hypot(upper.x-lower.x,upper.y-lower.y)*2));
    const fragments=new Map();
    // Closely spaced horizontal sections rasterize a solid extrusion. Build
    // once per camera; retain only the final visible surface, not each slice.
    for(let step=0;step<=steps;step++){
      const t=step/steps,g=step===0?base:step===steps?cap:glyphGeometry(camera,dir,value,TOWER_HEIGHT*t);
      for(const [x,y,u,v] of g.pixels){
        const edge=g.mask.edgeNormals[v*g.mask.w+u],side=g.plane.u.map((q,i)=>q*edge.x+g.plane.v[i]*edge.y);
        const top=step===steps,bevel=top&&edge.distance<=1.5;
        let normal=top?g.plane.normal:Math.hypot(...side)>0?side:g.plane.normal;
        if(bevel)normal=norm(normal.map((q,i)=>q*1.8+side[i]));
        fragments.set(y*ART_W+x,{x,y,normal,height:t,top});
      }
    }
    const result={base,cap,fragments:[...fragments.values()]};this.sculptures.set(key,result);return result;
  }
  paintSculpture(ctx,sculpture,light,pal){
    const tone=rgb(pal.face);
    for(const p of sculpture.fragments){
      // Round the roof edge through its surface normal. Contact darkening is
      // nondirectional ambient occlusion; all highlights follow the Sun.
      const ambient=.32*(.8+.2*p.height),diffuse=.68*Math.sqrt(Math.max(0,dot(p.normal,light)));
      // Roof paint has a higher ambient floor so a night-side tower still
      // tells time. This display grading adds no directional light or shadow.
      const shade=Math.max(p.top ? .56 : 0,Math.min(1,1.15*(ambient+diffuse)));
      ctx.fillStyle=pal.name==='Ochre'?['#000000','#550000','#AA5500','#FFAA55'][Math.round(shade*3)]
        :'#'+tone.map(v=>clamp(Math.round(v*shade/85)*85,0,255).toString(16).padStart(2,'0')).join('');
      ctx.fillRect(p.x,p.y,1,1);
    }
  }
  buildScene(state,camera){
    const key=[camera.key,state.material,state.treatment,Math.floor(state.epoch/MINUTE),state.texture,state.timeZone,state.clock24,state.compass].join('/');
    if(this.key===key)return;
    this.key=key;this.stats.sceneBuilds++;
    this.buildGeometry(camera);
    const ctx=this.baseCtx,pal=MATERIALS[state.material],light=solarLight(state.epoch);
    const {clean,dirs}=this.geometry;
    const image=ctx.createImageData(ART_W,ART_H),colors=Object.fromEntries(Object.entries(pal).filter(([,v])=>v[0]==='#').map(([k,v])=>[k,rgb(v)]));
    for(let y=0;y<ART_H;y++)for(let x=0;x<ART_W;x++){
      const i=y*ART_W+x,dir=dirs[i],land=clean[i],tone=colors[land?'land':'ocean'];
      let col=tone;
      if(!dir)col=colors[state.material==='chalk'?'land':'nightOcean']; // Sky beyond the sphere.
      if(dir){
        // An ambient floor and display response curve preserve distinct land
        // and sea tones at RGB222 resolution. Neither adds a light direction.
        const strength=Math.sqrt(Math.max(0,dot(dir,light))),night=colors[land?'nightLand':'nightOcean'];
        const threshold=state.texture?(dither.ranks[(y&31)*32+(x&31)]+.5)/1024:.5;
        col=tone.map((v,k)=>clamp(Math.floor((night[k]+(v-night[k])*strength)/85+1-threshold)*85,0,255));
      }
      const o=i*4;image.data[o]=col[0];image.data[o+1]=col[1];image.data[o+2]=col[2];image.data[o+3]=255;
    }
    ctx.putImageData(image,0,0);
    const track=sampleTrack(state.body,camera.start-15*MINUTE,camera.end+20*MINUTE,MINUTE);
    this.track=track.map(p=>({...p,...camera.project(p.dir)}));
    this.tickMarks=[];
    for(let i=1;i<this.track.length-1;i++){
      const p=this.track[i];if(!p.visible||p.y<5||p.y>ART_H-5)continue;
      const m=Number(clockParts(p.epoch,state.timeZone).m),major=m===0;
      // Twelve deliberate divisions are legible all the way up the path.
      // The minute is read at the marker; avoid irregularly thinned hairlines.
      if(m%5!==0)continue;
      const a=this.track[i-1],b=this.track[i+1],length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
      const size=major?14:8;
      const from=major?{x:p.x-nx*5,y:p.y-ny*5}:p;
      const to={x:p.x+nx*size,y:p.y+ny*size};
      this.tickMarks.push({epoch:p.epoch,x:p.x,y:p.y,major,from,to});
    }
    this.hours=[];
    for(const epoch of [camera.start,camera.end]){
      const p=position(state.body,epoch),station=camera.project(p.dir),raw=Number(clockParts(epoch,state.timeZone).h);
      const value=String(state.clock24?raw:raw%12||12);
      // Place the numeral on the ground beside its actual time station.
      const centerX=station.x-(value.length===2?51:45),ground=camera.inverse(centerX,station.y);
      if(!ground)continue;
      const base=this.glyph(camera,ground,value,0);let shadowPixels=0;
      if(state.treatment==='relief'){
        const sculpture=this.sculpture(camera,ground,value);
        shadowPixels=paintSunShadow(ctx,sculpture.cap,base,camera,light,dirs,pal.shadow);
        this.paintSculpture(ctx,sculpture,light,pal);
      }else{
        paintPixels(ctx,base.pixels,pal.route);
      }
      this.hours.push({epoch,value,x:station.x,y:station.y,numeralX:centerX,shadowPixels,solarAltitude:Math.asin(dot(ground,light))*180/Math.PI,pixels:base.pixels.length});
    }
    // Printed time marks retain their contrast when a long shadow crosses
    // the route. The monuments stand beside it, outside this reading lane.
    for(let i=1;i<this.track.length;i++){
      const a=this.track[i-1],b=this.track[i];if(a.visible&&b.visible)line(ctx,a,b,pal.route);
    }
    for(const tick of this.tickMarks)line(ctx,tick.from,tick.to,pal.route,tick.major?2:1);
    // No title bar, coordinates, altitude, legend or boxed time on the face.
    text(ctx,state.body.toUpperCase(),13,18,pal.label);
    if(state.body==='moon'){
      const phase=moonLight(state.epoch),x=187,y=14;
      for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(dx*dx+dy*dy<=9){
        const edge=(1-2*phase.fraction)*Math.sqrt(9-dy*dy);
        if(phase.waxing?dx>=edge:dx<=-edge){ctx.fillStyle=pal.label;ctx.fillRect(x+dx,y+dy,1,1);}
      }
    }
    if(state.compass)drawCompass(ctx,camera,pal);
  }
  render(state){
    const key=`${state.body}/${civilHour(state.epoch,state.timeZone)}/${state.lens}`;
    if(this.camera?.key!==key)this.camera=artCamera(state.body,state.epoch,state.timeZone,state.lens);
    const camera=this.camera,pal=MATERIALS[state.material];
    this.buildScene(state,camera);
    const ctx=this.ctx;ctx.drawImage(this.base,0,0);
    const current=position(state.body,state.epoch),p=camera.project(current.dir),clock=clockParts(state.epoch,state.timeZone);
    // One accent in the composition: the present moment. The minute is kept
    // upright for immediate reading, distinct from the sculpted hour stations.
    circle(ctx,p.x,p.y,6,pal.ocean);circle(ctx,p.x,p.y,4,pal.accent);circle(ctx,p.x-1,p.y-1,1,pal.face);
    let minuteX=Math.round(p.x+17);
    for(const digit of clock.m){
      const glyph=font.minuteGlyphs[digit];
      drawPixelRows(ctx,glyph.rows,minuteX,Math.round(p.y-glyph.height/2),pal.route);
      minuteX+=glyph.width+1;
    }
    if(state.fullTime){
      const w=textWidth(draft.small,clock.text);ctx.fillStyle=pal.ocean;ctx.fillRect(11,207,w+6,14);
      text(ctx,clock.text,14,218,pal.label);
    }
    this.stats.renders++;this.last={cameraKey:camera.key,point:p,hours:this.hours,ticks:this.tickMarks,time:clock.text};
    return this.last;
  }
}
