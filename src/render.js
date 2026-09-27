import {BODIES,position,sampleTrack,moonLight,MINUTE} from './ephemeris.js';
import {direction,globeCamera,lonLat,dot} from './geometry.js';
import {sunDirection} from './solar.js';
import {drawPixelLine,drawPixelRows} from './pixels.js';
import {drawBitmapText,textWidth} from './type.js';
import fonts from '../data/draft-font.json' with {type:'json'};
import dither from '../data/dither.json' with {type:'json'};

export const W=200,H=228,MAP_TOP=25,MAP_BOTTOM=200;
export const THEMES={
  survey:{name:'Survey',sky:'#000000',water:'#005555',land:'#AAAA55',waterNight:'#000000',landNight:'#555500',ink:'#FFFFFF',accent:'#FFFFAA',quiet:'#AAAAAA',secondary:'#55AAFF',home:'#FFAA55'},
  paper:{name:'Field paper',sky:'#FFFFFF',water:'#AAAAAA',land:'#FFFFFF',waterNight:'#555555',landNight:'#AAAAAA',ink:'#000000',accent:'#AA0000',quiet:'#555555',secondary:'#0055AA',home:'#AA5500'},
  ink:{name:'Two inks',sky:'#000000',water:'#000000',land:'#FFFFFF',waterNight:'#000000',landNight:'#FFFFFF',ink:'#FFFFFF',accent:'#FFFFFF',quiet:'#FFFFFF',secondary:'#FFFFFF',home:'#FFFFFF'}
};
export const HOME={name:'NORFOLK',lat:36.85,lon:-76.29}; // Explicit example, no GPS lookup.
const CITIES=[['LON',51.51,-.13],['NYC',40.71,-74.01],['TYO',35.68,139.65],['CAI',30.04,31.24],['CPT',-33.92,18.42],['SYD',-33.87,151.21],['DEL',28.61,77.21],['RIO',-22.91,-43.17]];
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const rgb=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const formatters=new Map();
export function clockParts(epoch,timeZone){
  if(!formatters.has(timeZone))formatters.set(timeZone,new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));
  const parts=formatters.get(timeZone).formatToParts(new Date(epoch));
  const h=parts.find(p=>p.type==='hour').value,m=parts.find(p=>p.type==='minute').value;
  return {h,m,text:`${h}:${m}`};
}
const inside=p=>p.visible&&p.x>=5&&p.x<W-5&&p.y>MAP_TOP+8&&p.y<MAP_BOTTOM-8;
export function cameraFor(body,epoch,view){
  const meta=BODIES[body],duration=meta.cameraMinutes*MINUTE;
  const anchor=Math.floor(epoch/duration)*duration+duration/2;
  const center=position(body,anchor),sat=meta.kind==='satellite';
  let args;
  if(view==='globe')args={lat:center.lat,lon:center.lon,radius:86,cy:112,roll:sat?22:-20};
  else if(view==='oblique')args={lat:Math.max(-80,Math.min(80,center.lat+32)),lon:center.lon-15,radius:sat?104:170,cy:99,roll:-25};
  else args={lat:Math.max(-80,Math.min(80,center.lat+8)),lon:center.lon,radius:sat?120:270,cy:112,roll:-30};
  return {camera:globeCamera(args),anchor,key:`${body}/${view}/${anchor}`};
}
export function landAt(atlas,dir){
  const {lat,lon}=lonLat(dir);
  const x=((Math.floor((lon+180)*4)%1440)+1440)%1440,y=Math.max(0,Math.min(719,Math.floor((90-lat)*4)));
  const i=y*1440+x;return (atlas[i>>3]>>(i&7))&1;
}
function ink(ctx,text,x,y,color,align='left',large=false){drawBitmapText(ctx,large?fonts.medium:fonts.small,text,Math.round(x),Math.round(y),color,align);}
function line(ctx,a,b,col){drawPixelLine(ctx,a.x,a.y,b.x,b.y,col);}
function intersect(a,b){return a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;}
function rectFor(text,x,baseline,large=false){
  const font=large?fonts.medium:fonts.small,w=textWidth(font,text),h=large?14:10;
  return {x:Math.round(x-w/2)-3,y:Math.round(baseline)-h-1,w:w+6,h:h+4};
}
function label(ctx,text,x,y,pal,boxes,{large=false,color=pal.ink,force=false}={}){
  const rect=rectFor(text,x,y,large);
  if(!force&&(rect.x<3||rect.x+rect.w>197||rect.y<MAP_TOP+2||rect.y+rect.h>MAP_BOTTOM-2||boxes.some(b=>intersect(rect,b))))return false;
  ctx.fillStyle=pal.sky;ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
  ink(ctx,text,x,y,color,'center',large);boxes.push(rect);return true;
}
export class Renderer{
  constructor(canvas,atlas){
    canvas.width=W;canvas.height=H;this.canvas=canvas;this.ctx=canvas.getContext('2d',{willReadFrequently:true});this.atlas=atlas;
    this.base=document.createElement('canvas');this.base.width=W;this.base.height=H;
    this.baseCtx=this.base.getContext('2d');this.mapKey='';this.trackKey='';this.track=[];
    this.stats={mapBuilds:0,trackBuilds:0,renders:0};
  }
  background(camera,state,key){
    const lightTime=Math.floor(state.epoch/(5*MINUTE))*5*MINUTE;
    const mapKey=`${key}/${lightTime}/${state.theme}/${state.dither}/${state.night}`;
    if(mapKey===this.mapKey)return;
    this.mapKey=mapKey;this.stats.mapBuilds++;
    const pal=THEMES[state.theme],S=sunDirection(new Date(lightTime));
    const colors=Object.fromEntries(['sky','land','water','landNight','waterNight'].map(k=>[k,rgb(pal[k])]));
    const image=this.baseCtx.createImageData(W,H),out=image.data;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const dir=y>=MAP_TOP&&y<=MAP_BOTTOM?camera.inverse(x+.5,y+.5):null;
      let color=colors.sky;
      if(dir){
        const land=landAt(this.atlas,dir),day=colors[land?'land':'water'],night=colors[land?'landNight':'waterNight'];
        const light=state.night?dot(dir,S):1;
        const sunlight=Math.max(0,Math.min(1,(light+.08)/.20));
        const limb=Math.max(.30,Math.min(1,Math.sqrt(Math.max(0,dot(dir,camera.forward)))*1.3));
        let target=day.map((v,i)=>(night[i]+(v-night[i])*sunlight)*limb);
        if(state.theme==='ink'){
          const value=land?(state.night?.34+.66*sunlight:1):0;
          target=[255,255,255].map(v=>v*value*limb);
        }
        // Dither only the surface. No temporal seed, interpolation, opacity,
        // antialiasing, or post-process over typography / trajectory marks.
        const threshold=state.dither==='stipple'?(dither.ranks[(y&31)*32+(x&31)]+.5)/1024:
          state.dither==='ordered'?(BAYER[(y&3)*4+(x&3)]+.5)/16:.5;
        const quantum=state.theme==='ink'?255:85;
        color=target.map(v=>Math.max(0,Math.min(255,Math.floor(v/quantum+1-threshold)*quantum)));
      }
      const i=(y*W+x)*4;out[i]=color[0];out[i+1]=color[1];out[i+2]=color[2];out[i+3]=255;
    }
    this.baseCtx.putImageData(image,0,0);
  }
  render(state){
    const started=performance.now(),ctx=this.ctx,pal=THEMES[state.theme],meta=BODIES[state.body];
    const {camera,anchor,key}=cameraFor(state.body,state.epoch,state.view);
    this.background(camera,state,key);ctx.drawImage(this.base,0,0);
    const trackKey=`${state.body}/${anchor}`;
    if(trackKey!==this.trackKey){
      const start=anchor-meta.window/2*MINUTE,end=anchor+meta.window/2*MINUTE;
      this.track=sampleTrack(state.body,start,end,MINUTE);this.trackKey=trackKey;this.stats.trackBuilds++;
    }
    const pts=this.track.map(p=>({...p,...camera.project(p.dir)})),current=position(state.body,state.epoch),point=camera.project(current.dir);
    const boxes=[];
    ctx.save();ctx.beginPath();ctx.rect(0,MAP_TOP,W,MAP_BOTTOM-MAP_TOP+1);ctx.clip();
    // Solid future track, dimmer past. Draw a dark underlay to keep a one-pixel
    // mark legible even while crossing a light coastline.
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];if(!a.visible||!b.visible)continue;
      for(const dy of [-1,0,1])for(const dx of [-1,0,1])line(ctx,{x:a.x+dx,y:a.y+dy},{x:b.x+dx,y:b.y+dy},pal.sky);
    }
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i];if(a.visible&&b.visible)line(ctx,a,b,b.epoch<=state.epoch?pal.quiet:pal.accent);
    }
    // A minute is only marked if two screen pixels separate adjacent minutes.
    // Dense regions retain the 5-minute marks; there are no invented intervals.
    const ticks=[];
    for(let i=1;i<pts.length-1;i++){
      const p=pts[i],prev=pts[i-1],next=pts[i+1];if(!inside(p))continue;
      const time=clockParts(p.epoch,state.timeZone),m=Number(time.m);
      const dx=next.x-prev.x,dy=next.y-prev.y,n=Math.hypot(dx,dy)||1,major=m===0,quarter=meta.kind==='satellite'&&m%15===0;
      if(!major&&!quarter&&m%5!==0&&Math.hypot(next.x-p.x,next.y-p.y)<2)continue;
      const size=major?6:quarter?4:m%5===0?3:1;
      const normal={x:-dy/n,y:dx/n};
      line(ctx,{x:p.x-normal.x*size,y:p.y-normal.y*size},{x:p.x+normal.x*size,y:p.y+normal.y*size},pal.accent);
      if(major||quarter)ticks.push({p,time,normal,major});
    }
    // Current marker has label priority. Show actual civil time in one chosen
    // timezone everywhere; longitude never changes the clock's timezone.
    const now=clockParts(state.epoch,state.timeZone);
    if(inside(point)){
      const x=Math.max(31,Math.min(169,point.x)),y=point.y<155?point.y+29:point.y-19;
      label(ctx,now.text,x,y,pal,boxes,{large:true,force:true,color:pal.accent});
      line(ctx,{x:point.x,y:point.y+(y>point.y?8:-8)},{x,y:y>point.y?y-16:y+6},pal.accent);
      this.marker(state.body,point,state.epoch,pal);
    }
    const visibleLabels=[];
    for(const {p,time,normal,major} of ticks){
      const text=major?time.h:time.text;
      for(const side of [-1,1]){
        const x=p.x+normal.x*19*side,y=p.y+normal.y*19*side+4;
        if(label(ctx,text,x,y,pal,boxes,{color:pal.accent})){visibleLabels.push(text);break;}
      }
    }
    if(state.secondary){
      // Independent position at the SAME timestamp; deliberately no second
      // complete clock scale. Three distinct shapes, not color alone.
      const body=state.body==='moon'?'sun':'moon',p=camera.project(position(body,state.epoch).dir);
      if(inside(p)){this.marker(body,p,state.epoch,{...pal,accent:pal.secondary});label(ctx,body.toUpperCase(),p.x,p.y-10,pal,boxes,{color:pal.secondary});}
    }
    if(state.cities)for(const [name,lat,lon] of CITIES){
      const p=camera.project(direction(lat,lon));if(!inside(p)||Math.hypot(p.x-point.x,p.y-point.y)<25)continue;
      ctx.fillStyle=pal.quiet;ctx.fillRect(Math.round(p.x),Math.round(p.y),2,2);
      label(ctx,name,p.x,p.y-5,pal,boxes,{color:pal.quiet});
    }
    const home=camera.project(direction(HOME.lat,HOME.lon));
    if(state.home&&inside(home)){
      drawPixelRows(ctx,['..#..','.###.','#####','.#.#.','.###.'],home.x-2,home.y-2,pal.home);
      label(ctx,HOME.name,home.x,home.y-7,pal,boxes,{color:pal.home});
    }
    ctx.restore();
    ctx.fillStyle=pal.sky;ctx.fillRect(0,0,W,MAP_TOP);ctx.fillRect(0,MAP_BOTTOM+1,W,H-MAP_BOTTOM-1);
    ink(ctx,'GROUNDTRACK',7,13,pal.ink);ink(ctx,meta.name.toUpperCase(),193,13,pal.accent,'right');
    drawPixelLine(ctx,7,20,193,20,pal.quiet);
    const coords=`${Math.abs(current.lat).toFixed(1)}${current.lat<0?'S':'N'}  ${Math.abs(current.lon).toFixed(1)}${current.lon<0?'W':'E'}`;
    ink(ctx,coords,7,215,pal.quiet);
    ink(ctx,state.body==='moon'?`${Math.round(moonLight(state.epoch).fraction*100)}% LIT`:state.body==='iss'?`${Math.round(current.altitude)} KM`:'SUN',193,215,pal.accent,'right');
    const footer=state.body==='iss'?'ARCHIVE 05 JUN 2019':state.timeZone==='UTC'?'TRACK TIMES / UTC':'TRACK TIMES / HOME';
    ink(ctx,footer,7,226,pal.quiet);
    this.stats.renders++;this.stats.lastMs=performance.now()-started;
    this.last={current,point,visibleLabels,cameraAnchor:anchor,cameraKey:key,homeVisible:inside(home),tickCount:ticks.length};
    return this.last;
  }
  marker(body,p,epoch,pal){
    const ctx=this.ctx,x=Math.round(p.x),y=Math.round(p.y);
    ctx.fillStyle=pal.sky;
    for(let yy=-7;yy<=7;yy++)for(let xx=-7;xx<=7;xx++)if(xx*xx+yy*yy<=49)ctx.fillRect(x+xx,y+yy,1,1);
    if(body==='iss'){
      drawPixelRows(ctx,['##..#..##','##..#..##','##.###.##','#########','##.###.##','##..#..##','##..#..##'],x-4,y-3,pal.accent);
      return;
    }
    const light=body==='moon'?moonLight(epoch):{fraction:1,waxing:true};
    for(let yy=-5;yy<=5;yy++)for(let xx=-5;xx<=5;xx++){
      if(xx*xx+yy*yy>25)continue;
      const half=Math.sqrt(25-yy*yy),edge=(1-2*light.fraction)*half;
      const on=light.waxing?xx>=edge:xx<=-edge;
      const rim=xx*xx+yy*yy>16;
      ctx.fillStyle=on?pal.accent:rim?pal.quiet:pal.sky;ctx.fillRect(x+xx,y+yy,1,1);
    }
    if(body==='sun')for(const [dx,dy] of [[0,-7],[7,0],[0,7],[-7,0]]){ctx.fillStyle=pal.accent;ctx.fillRect(x+dx,y+dy,1,1);}
  }
}
