import {position,MINUTE} from './ephemeris.js';
import {norm,dot,cross} from './geometry.js';
import {clockParts} from './render.js';

const add=(a,b)=>a.map((v,i)=>v+b[i]);
const scale=(a,k)=>a.map(v=>v*k);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const ART_OBSERVATIONS={
  moon:[['2026-09-16','Afternoon'],['2026-09-18','Near sunset'],['2026-09-19','After sunset']],
  sun:[['2026-09-27','Below the Sun']]
};
export const ART_DEMOS=Object.fromEntries(Object.entries(ART_OBSERVATIONS).map(([body,items])=>[body,Date.parse(`${items[0][0]}T08:24:00Z`)]));
export const LENSES={above:{name:'Above',tilt:25},oblique:{name:'Oblique',tilt:52},low:{name:'Low',tilt:64}};

export function civilHour(epoch,timeZone){
  if(!Number.isFinite(epoch))throw new RangeError('Invalid time');
  const minute=Number(clockParts(epoch,timeZone).m);
  return Math.floor(epoch/MINUTE)*MINUTE-minute*MINUTE;
}

// A perspective camera on a unit sphere, aimed at the middle of a civil hour.
// Its up axis follows the track tangent, so time advances from bottom to top.
// Projection is shared by the coast, the track and the numeral ground planes.
export function artCamera(body,epoch,timeZone='America/New_York',lens='oblique'){
  if(!Object.hasOwn(ART_DEMOS,body)||!Object.hasOwn(LENSES,lens))throw new RangeError('Unsupported art study body or lens');
  const start=civilHour(epoch,timeZone),end=start+60*MINUTE,anchor=start+30*MINUTE;
  const center=position(body,anchor).dir;
  const delta=sub(position(body,anchor+MINUTE).dir,position(body,anchor-MINUTE).dir);
  const along=norm(sub(delta,scale(center,dot(center,delta))));
  const right=norm(cross(along,center));
  const tilt=LENSES[lens].tilt*Math.PI/180,distance=1.4;
  const eye=add(scale(center,1+distance*Math.cos(tilt)),scale(along,-distance*Math.sin(tilt)));
  const look=norm(sub(center,eye)),up=norm(cross(right,look));
  // A small bank prevents a mechanically vertical ruler while keeping the
  // route distinctly upright. These are camera axes, never a warped map.
  const bank=5*Math.PI/180,screenRight=add(scale(right,Math.cos(bank)),scale(up,Math.sin(bank)));
  const screenUp=add(scale(up,Math.cos(bank)),scale(right,-Math.sin(bank)));
  let focal=1,cx=126,cy=114;
  function projectWorld(world){
    const rel=sub(world,eye),z=dot(rel,look);
    return {x:cx+focal*dot(rel,screenRight)/z,y:cy-focal*dot(rel,screenUp)/z,z,visible:z>0&&dot(norm(world),eye)>1};
  }
  const a=projectWorld(position(body,start).dir),b=projectWorld(position(body,end).dir);
  if(!(a.y>b.y))throw new Error('Track camera points backward');
  focal=123/(a.y-b.y);
  // Leave headroom for the raised numeral at the far station.
  // The two ground stations sit at y=185 and y=62, regardless of lens pitch.
  cy+=185-projectWorld(position(body,start).dir).y;
  const project=(dir,height=0)=>projectWorld(scale(dir,1+height));
  function ray(x,y){return norm(add(look,add(scale(screenRight,(x-cx)/focal),scale(screenUp,(cy-y)/focal))));}
  function inverse(x,y){
    const r=ray(x,y),b=dot(eye,r),c=dot(eye,eye)-1,disc=b*b-c;
    if(disc<0)return null;
    const t=-b-Math.sqrt(disc);return t>0?add(eye,scale(r,t)):null;
  }
  function plane(dir,height=0){
    const normal=norm(dir),u=norm(sub(right,scale(normal,dot(right,normal))));
    const v=norm(cross(normal,u)); // Track-forward direction on this tangent.
    const origin=scale(normal,1+height);
    return {normal,u,v,origin,
      at:(x,y)=>add(origin,add(scale(u,x),scale(v,y))),
      inverse(x,y){
        const r=ray(x,y),den=dot(r,normal);if(Math.abs(den)<1e-10)return null;
        const t=dot(sub(origin,eye),normal)/den;if(t<=0)return null;
        const local=sub(add(eye,scale(r,t)),origin);
        return {x:dot(local,u),y:dot(local,v)};
      }
    };
  }
  return {start,end,anchor,center,along,right,eye,look,up:screenUp,screenRight,focal,cx,cy,project,projectWorld,inverse,plane,key:`${body}/${start}/${lens}`};
}

export function mapNorth(camera,x,y){
  const ground=camera.inverse(x,y);if(!ground)return null;
  const tangent=[-ground[0]*ground[2],-ground[1]*ground[2],1-ground[2]*ground[2]];
  if(Math.hypot(...tangent)<1e-10)return null;
  const nearby=norm(add(ground,scale(norm(tangent),.001)));
  const p=camera.project(nearby),length=Math.hypot(p.x-x,p.y-y);
  return {x:(p.x-x)/length,y:(p.y-y)/length};
}
