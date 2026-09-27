import {position,MINUTE} from './ephemeris.js';
import {dot} from './geometry.js';

// All direct illumination comes from the same calculated Sun as the track.
// Epochs are minute-quantized because this is a minute-resolution clock.
export function solarLight(epoch){
  return position('sun',Math.floor(epoch/MINUTE)*MINUTE).dir;
}

// Parallel sunlight from a raised point onto the spherical ground. A ray
// which misses the Earth or travels away from it has no ground shadow.
export function castSunShadow(world,sun){
  const toward=dot(world,sun),discriminant=toward*toward-dot(world,world)+1;
  if(toward<=0||discriminant<0)return null;
  const distance=toward-Math.sqrt(discriminant);
  if(distance<0)return null;
  return world.map((v,i)=>v-sun[i]*distance);
}

// Trace from the ground toward the Sun to find an occluding numeral plane.
// This inverse test fills long shadows without holes between source pixels.
export function sunPlaneHit(ground,sun,plane){
  if(dot(ground,sun)<=0)return null;
  const denominator=dot(sun,plane.normal);
  if(denominator<=1e-10)return null;
  const distance=(dot(plane.origin,plane.normal)-dot(ground,plane.normal))/denominator;
  if(distance<=0)return null;
  const offset=ground.map((v,i)=>v+sun[i]*distance-plane.origin[i]);
  return {x:dot(offset,plane.dualU||plane.u),y:dot(offset,plane.dualV||plane.v)};
}

// Exact grid traversal through an extruded bitmap's footprint. This fills
// the shadow of the whole tower, including its sides, rather than detaching
// a copy of its roof at the end of the shadow.
export function segmentHitsMask(mask,a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  let enter=0,leave=1;
  for(const [start,delta,limit] of [[a.x,dx,mask.w],[a.y,dy,mask.h]]){
    if(Math.abs(delta)<1e-12){if(start<0||start>=limit)return false;continue;}
    const first=(0-start)/delta,last=(limit-start)/delta;
    enter=Math.max(enter,Math.min(first,last));leave=Math.min(leave,Math.max(first,last));
  }
  if(enter>leave)return false;
  const t=Math.min(leave,enter+1e-9),x=a.x+dx*t,y=a.y+dy*t;
  let ix=Math.max(0,Math.min(mask.w-1,Math.floor(x))),iy=Math.max(0,Math.min(mask.h-1,Math.floor(y)));
  const sx=Math.sign(dx),sy=Math.sign(dy);
  let tx=sx?((sx>0?ix+1:ix)-a.x)/dx:Infinity;
  let ty=sy?((sy>0?iy+1:iy)-a.y)/dy:Infinity;
  for(let i=0;i<mask.w+mask.h+3;i++){
    if(mask.bits[iy*mask.w+ix])return true;
    if(Math.min(tx,ty)>leave)return false;
    if(tx<ty){ix+=sx;tx+=Math.abs(1/dx);}else{iy+=sy;ty+=Math.abs(1/dy);}
    if(ix<0||ix>=mask.w||iy<0||iy>=mask.h)return false;
  }
  return false;
}

export function sunVolumeHit(ground,sun,glyph){
  const plane=glyph.plane,denominator=dot(sun,plane.normal);
  if(dot(ground,sun)<=0||denominator<=1e-10)return false;
  const base=dot(ground,plane.normal),top=dot(plane.origin,plane.normal);
  const t0=Math.max(0,(1-base)/denominator),t1=(top-base)/denominator;
  if(t1<t0)return false;
  const uv=t=>{
    const p=ground.map((v,i)=>v+sun[i]*t-plane.normal[i]);
    return {x:dot(p,plane.dualU||plane.u)/glyph.sx+glyph.mask.w/2,y:glyph.mask.h/2-dot(p,plane.dualV||plane.v)/glyph.sy};
  };
  return segmentHitsMask(glyph.mask,uv(t0),uv(t1));
}
