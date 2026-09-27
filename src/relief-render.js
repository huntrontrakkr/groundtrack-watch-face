import {atlasCamera} from './atlas-camera.js';
import {sculptureGeometry} from './art-render.js';
import {solarLight,sunVolumeHit} from './art-light.js';
import {clockParts,landAt} from './render.js';
import {position,MINUTE} from './ephemeris.js';
import {dot} from './geometry.js';
import {EDGES,faceOf} from './fuller.js';
import {mix,clamp,smooth,quantizeImage,coastDistance,soften} from './color-mix.js';
import font from '../data/sculpture-font.json' with {type:'json'};

export const W=200,H=228,S=3;
export const MATERIALS={
  shore:{name:'Shorelight',land:[215,211,192],nightLand:[83,93,91],ocean:[0,85,85],nightOcean:[0,22,35],shallows:[97,155,145],stone:[252,249,223],shadow:[81,99,99],track:[255,170,85],trackOnLight:[170,85,0]},
  clay:{name:'Terracotta',land:[209,151,113],nightLand:[98,69,80],ocean:[85,85,170],nightOcean:[0,0,85],shallows:[154,158,182],stone:[255,222,183],shadow:[101,83,103],track:[255,255,170],trackOnLight:[85,0,0]},
  jade:{name:'Celadon',land:[170,197,159],nightLand:[61,90,94],ocean:[0,85,85],nightOcean:[0,0,85],shallows:[106,162,161],stone:[240,239,207],shadow:[63,97,109],track:[255,170,85],trackOnLight:[85,85,0]}
};
const css=c=>`rgb(${c.map(Math.round).join(',')})`;
function canvas(w,h){const cv=document.createElement('canvas');cv.width=w;cv.height=h;return cv;}
function line(ctx,a,b,width,color){ctx.strokeStyle=css(color);ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
function scaledCamera(local,scale){
  const point=p=>({...p,x:p.x*S,y:p.y*S});
  return {width:W*S,heightPx:H*S,glyphScale:S*scale,projectWorld:p=>point(local.projectWorld(p)),project:(p,h)=>point(local.project(p,h)),plane:(p,h)=>{
    const plane=local.plane(p,h);return {...plane,inverse:(x,y)=>plane.inverse(x/S,y/S)};
  }};
}
const bbox=fragments=>{
  const xs=fragments.map(p=>p.x/S),ys=fragments.map(p=>p.y/S);
  return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs)+1,h:Math.max(...ys)-Math.min(...ys)+1};
};
function minuteText(ctx,value,x,y,color){
  const glyphs=[...value].map(c=>font.minuteGlyphs[c]);
  ctx.fillStyle=css(color);
  for(const g of glyphs){for(let yy=0;yy<g.height;yy++)for(let xx=0;xx<g.width;xx++)if(g.rows[yy][xx]==='#')ctx.fillRect(Math.round(x)+xx,Math.round(y)+yy,1,1);x+=g.width+2;}
}

export class ReliefRenderer{
  constructor(target,land){
    this.canvas=target;target.width=W;target.height=H;this.ctx=target.getContext('2d',{willReadFrequently:true});this.land=land;
    this.groundCanvas=canvas(W,H);this.groundCtx=this.groundCanvas.getContext('2d');
    this.high=canvas(W*S,H*S);this.highCtx=this.high.getContext('2d',{willReadFrequently:true});
    this.continuous=canvas(W,H);this.colorCtx=this.continuous.getContext('2d',{willReadFrequently:true});
    this.stats={geometryBuilds:0,typeBuilds:0,lightingBuilds:0,colorBuilds:0,renders:0};
  }
  buildGeometry(state){
    const key=[state.body,state.start,state.timeZone,state.clock24].join('/');if(key===this.geometryKey)return;
    this.geometryKey=key;this.stats.geometryBuilds++;
    const camera=this.camera=atlasCamera(state.body,state.start,60,'wide',{cx:124,cy:129,width:114,height:160,minWidth:.14,aspect:1,perspective:.0009});
    const ground=this.ground=new Array(W*H),mask=this.mask=new Uint8Array(W*H);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,p=camera.at(x+.5,y+.5);ground[i]=p;mask[i]=p?landAt(this.land,p.dir):0;
    }
    // One gentle coverage pass removes isolated subpixel coastline defects.
    this.coverage=soften(mask,W,H,1);this.distance=coastDistance(mask,W,H);
    this.hours=[];
    for(const station of [camera.track[0],camera.track.at(-1)]){
      const raw=Number(clockParts(station.epoch,state.timeZone).h),value=String(state.clock24?raw:raw%12||12);
      const cy=clamp(station.y,44,192),half=value.length===2?36:22;
      let selected;
      const candidates=[50,65,-50,80,-65].flatMap(offset=>[0,-16,16].map(dy=>({offset,dy})));
      for(const {offset,dy} of candidates){
        const cx=clamp(station.x-offset,half+9,W-half-9),p=camera.at(cx,clamp(cy+dy,44,192));if(!p)continue;
        const local=camera.forTower(p.dir,p.tile,true),scale=value.length===2?1.17:1.48;
        const height=3.5/(camera.scale*.8),sculpture=sculptureGeometry(scaledCamera(local,scale),p.dir,value,height);
        if(!sculpture.fragments.length)continue;
        const box=bbox(sculpture.fragments),collisions=camera.track.filter(q=>q.x>box.x-7&&q.x<box.x+box.w+7&&q.y>box.y-7&&q.y<box.y+box.h+7).length;
        const score=collisions*1000+Math.abs(offset-50)+Math.abs(dy)+(box.y<6||box.y+box.h>H-6?500:0);
        if(!selected||score<selected.score)selected={value,station,ground:p,sculpture,box,score,local};
        if(collisions===0&&box.y>=6&&box.y+box.h<=H-6)break;
      }
      if(selected){this.hours.push(selected);this.stats.typeBuilds++;}
    }
    this.lightKey='';this.sceneKey='';
  }
  buildLighting(state){
    const key=[this.geometryKey,Math.floor(state.epoch/MINUTE)].join('/');if(this.lightKey===key)return;
    this.lightKey=key;this.stats.lightingBuilds++;
    this.sun=solarLight(state.epoch);const raw=new Float32Array(W*H);let count=0;
    for(let i=0;i<raw.length;i++)if(this.ground[i]&&this.hours.some(h=>sunVolumeHit(this.ground[i].dir,this.sun,h.sculpture.cap))){raw[i]=1;count++;}
    this.shadow=soften(raw,W,H,1);this.shadowPixels=count;
  }
  paintGround(pal){
    const img=this.groundCtx.createImageData(W,H),sun=this.sun;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,p=this.ground[i],solar=p?dot(p.dir,sun):0,day=smooth(-.16,.62,solar),dist=this.distance[i];
      const water=mix(pal.nightOcean,pal.ocean,smooth(-.12,.12,solar)),land=mix(pal.nightLand,pal.land,day);
      // Nearshore color is an artistic material gradient, not ocean depth.
      const shallows=mix(water,pal.shallows,day*.45),sea=mix(water,shallows,Math.exp(-Math.max(0,-dist)/5));
      let stone=mix(land,pal.stone,day*.06*Math.exp(-Math.max(0,dist)/6));
      const coverage=smooth(.13,.87,this.coverage[i]);
      let col=mix(sea,stone,coverage);
      // The same solar volume shadow falls on both materials; preserve their
      // color instead of painting a second, disconnected black silhouette.
      const shadowColor=mix(water.map(v=>v*.62),mix(pal.shadow,land,.15),coverage);
      col=mix(col,shadowColor,this.shadow[i]*.48);
      img.data.set([...col,255],i*4);
    }
    this.groundCtx.putImageData(img,0,0);
  }
  paintSeams(ctx,pal){
    const seen=new Set();let seams=0;
    for(const {tile,points} of this.camera.triangles)for(let e=0;e<3;e++){
      if(!tile.links[e].seam)continue;
      const id=[tile.key,tile.links[e].tile?.key||`edge${e}`].sort().join('/');if(seen.has(id))continue;seen.add(id);
      const [i,j]=EDGES[e],a={x:points[i][0],y:points[i][1]},b={x:points[j][0],y:points[j][1]};
      ctx.save();ctx.globalAlpha=.28;line(ctx,a,b,1.5,pal.shadow);line(ctx,a,b,.5,pal.stone);ctx.restore();seams++;
    }
    return seams;
  }
  paintRoute(ctx,pal){
    const track=this.camera.track;ctx.lineCap='round';this.ticks=[];this.cuts=[];
    // A flat graphic route. Collect its divisions here; paint in whole
    // pixels after color mixing so no shading can break up the hairline.
    for(let i=1;i<track.length;i++){
      const a=track[i-1],b=track[i];
      if(b.cut)this.cuts.push([a,b]);
    }
    for(let i=0;i<track.length;i++){
      const p=track[i],minute=Number(clockParts(p.epoch,this.timeZone).m);if(minute%5)continue;
      const a=track[Math.max(0,i-1)],b=track[Math.min(track.length-1,i+1)];
      if(a.cut||b.cut)continue;
      this.ticks.push(p);
    }
    for(const [a,b] of this.cuts)for(const p of [a,b]){
      // Paired open diamonds distinguish a map discontinuity from time ticks.
      ctx.strokeStyle=css(pal.stone);ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(p.x,p.y-2.5);ctx.lineTo(p.x+2.5,p.y);ctx.lineTo(p.x,p.y+2.5);ctx.lineTo(p.x-2.5,p.y);ctx.closePath();ctx.stroke();
    }
  }
  paintTowers(ctx,pal){
    const image=ctx.getImageData(0,0,W*S,H*S),sun=this.sun;
    for(const h of this.hours){
      const daylight=smooth(-.18,.3,dot(h.ground.dir,sun));
      for(const p of h.sculpture.fragments){
        const diffuse=Math.max(0,dot(p.top?h.ground.dir:p.normal,sun))*daylight;
        const ambient=p.top?.82:.42;
        const amount=clamp(ambient+.18*Math.sqrt(diffuse));
        const cool=mix(pal.shadow,pal.stone,.15),warm=mix(pal.land,pal.stone,p.top?1:.48);
        const col=mix(cool,warm,amount);
        image.data.set([...col,255],(p.y*W*S+p.x)*4);
      }
    }
    ctx.putImageData(image,0,0);
  }
  paintReadingMarks(pal,point,minute){
    const ctx=this.ctx,seaInk=pal.track,landInk=pal.trackOnLight;
    const brightness=(x,y)=>{
      const i=(clamp(Math.round(y),0,H-1)*W+clamp(Math.round(x),0,W-1))*4,d=this.source.data;
      return d[i]*.2126+d[i+1]*.7152+d[i+2]*.0722;
    };
    const inkAt=(x,y)=>brightness(x,y)>145?landInk:seaInk;
    const stroke=(a,b)=>{
      let x=Math.round(a.x),y=Math.round(a.y),xx=Math.round(b.x),yy=Math.round(b.y);
      const dx=Math.abs(xx-x),sx=x<xx?1:-1,dy=-Math.abs(yy-y),sy=y<yy?1:-1;let err=dx+dy;
      for(let count=0;count<1000;count++){
        if(x>=0&&x<W&&y>=0&&y<H&&Math.hypot(x-point.x,y-point.y)>4){ctx.fillStyle=css(inkAt(x,y));ctx.fillRect(x,y,1,1);}
        if(x===xx&&y===yy)break;const e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}
      }
    };
    const tr=this.camera.track;
    for(let i=1;i<tr.length;i++)if(!tr[i].cut)stroke(tr[i-1],tr[i]);
    for(const p of this.ticks){const idx=tr.indexOf(p),a=tr[Math.max(0,idx-1)],b=tr[Math.min(tr.length-1,idx+1)],len=Math.hypot(b.x-a.x,b.y-a.y)||1,m=Number(clockParts(p.epoch,this.timeZone).m),size=m===0?5:m%15===0?4:3;stroke(p,{x:p.x-(b.y-a.y)/len*size,y:p.y+(b.x-a.x)/len*size});}
    const mx=Math.round(point.x),my=Math.round(point.y),color=inkAt(mx,my);
    ctx.fillStyle=css(color);
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)if(Math.abs(dx)+Math.abs(dy)===3)ctx.fillRect(mx+dx,my+dy,1,1);
    ctx.fillRect(mx,my,1,1);
    const ix=clamp(Math.round(point.x+10),0,W-1),iy=clamp(Math.round(point.y),0,H-1),ink=brightness(ix,iy)>145?[0,0,0]:[255,255,170];
    minuteText(ctx,minute,clamp(point.x+10,4,W-21),clamp(point.y-4,4,H-13),ink);
  }
  current(state){
    const nearest=this.camera.track.reduce((best,p)=>Math.abs(p.epoch-state.epoch)<Math.abs(best.epoch-state.epoch)?p:best),actual=position(state.body,state.epoch);
    const tile=faceOf(actual.dir)===nearest.tile.face?nearest.tile:this.camera.project(actual.dir).tile;
    return {...actual,...this.camera.projectIn(tile,actual.dir),tile};
  }
  render(state){
    this.buildGeometry(state);this.buildLighting(state);
    const key=[this.lightKey,state.material,state.mixing].join('/');if(this.sceneKey===key)return this.last;
    this.sceneKey=key;this.stats.colorBuilds++;this.timeZone=state.timeZone;
    const pal=MATERIALS[state.material],ctx=this.highCtx;this.paintGround(pal);
    ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(this.groundCanvas,0,0,W*S,H*S);
    ctx.save();ctx.scale(S,S);const seams=this.paintSeams(ctx,pal);this.paintRoute(ctx,pal);ctx.restore();
    this.paintTowers(ctx,pal);
    const point=this.current(state);
    this.colorCtx.imageSmoothingEnabled=true;this.colorCtx.drawImage(this.high,0,0,W,H);
    const minute=clockParts(state.epoch,state.timeZone).m;

    const source=this.source=this.colorCtx.getImageData(0,0,W,H),data=quantizeImage(source,state.mixing);
    this.ctx.putImageData(new ImageData(data,W,H),0,0);
    this.paintReadingMarks(pal,point,minute);
    this.stats.renders++;
    const final=this.ctx.getImageData(0,0,W,H).data,colors=new Set();for(let i=0;i<final.length;i+=4)colors.add(`${final[i]},${final[i+1]},${final[i+2]}`);
    this.last={time:clockParts(state.epoch,state.timeZone).text,hours:this.hours.map(h=>({value:h.value,box:h.box})),current:{x:point.x,y:point.y,lat:point.lat,lon:point.lon},cuts:this.cuts.length,seams,colors:colors.size,shadowPixels:this.shadowPixels,ticks:this.ticks.length};return this.last;
  }
}
