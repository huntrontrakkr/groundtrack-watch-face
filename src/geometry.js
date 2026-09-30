import {sin,cos} from './fmath.js';
export const RAD=Math.PI/180;
export const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const norm=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const wrap=lon=>((lon+180)%360+360)%360-180;
// Sine and cosine that the watch computes to the same bits (fmath.js).
export const direction=(lat,lon)=>[cos(lat*RAD)*cos(lon*RAD),cos(lat*RAD)*sin(lon*RAD),sin(lat*RAD)];
export const lonLat=d=>({lat:Math.asin(Math.max(-1,Math.min(1,d[2])))/RAD,lon:Math.atan2(d[1],d[0])/RAD});
export function angularDistance(a,b){return Math.acos(Math.max(-1,Math.min(1,dot(a,b))));}

// Orthographic globe: a rotated camera frame, not a flattened latitude map.
// Roll is a camera rotation. Every map pixel and every marker uses this frame.
export function globeCamera({lat,lon,radius=96,cx=100,cy=112,roll=0}){
  const forward=direction(lat,lon),east=direction(0,lon+90),north=norm(cross(forward,east));
  const c=Math.cos(roll*RAD),s=Math.sin(roll*RAD);
  const right=east.map((v,i)=>v*c+north[i]*s),up=north.map((v,i)=>v*c-east[i]*s);
  return {radius,cx,cy,forward,right,up,
    project(dir){const z=dot(dir,forward);return {x:cx+radius*dot(dir,right),y:cy-radius*dot(dir,up),visible:z>=0,z};},
    inverse(x,y){const a=(x-cx)/radius,b=(cy-y)/radius,q=1-a*a-b*b;if(q<0)return null;const z=Math.sqrt(q);return forward.map((v,i)=>v*z+right[i]*a+up[i]*b);}
  };
}

// Great-circle interpolation using normalized Cartesian directions avoids
// longitude-wrap spikes. This is for short, uniformly spaced cached knots.
export function interpolate(a,b,f){return norm(a.map((v,i)=>v+(b[i]-v)*f));}
