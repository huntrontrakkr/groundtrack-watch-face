// Gray–Fuller face transform, adapted from Philippe Rivière's CC0
// implementation (2018). See NOTICE and docs/STUDY-03.md. This is the
// nonlinear Fuller transform, not gnomonic barycentric interpolation.
import {dot,norm,cross} from './geometry.js';
const S3=Math.sqrt(3),Z=Math.sqrt(5+2*Math.sqrt(5))/Math.sqrt(15);
const EL=Math.sqrt(8)/Math.sqrt(5+Math.sqrt(5));
const DVE=Math.sqrt(3+Math.sqrt(5))/Math.sqrt(5+Math.sqrt(5));
const pole=norm([.420152,.078145,.904083]),first=norm([.995005,-.091348,.040147]);
const east=norm(first.map((v,i)=>v-dot(first,pole)*pole[i])),north=cross(pole,east);
// Regularize Gray's rounded coordinates into one exact regular icosahedron.
// The orientation is fixed by his first two vertices; no per-face warping.
const ring=Array.from({length:5},(_,i)=>pole.map((v,k)=>v/Math.sqrt(5)+2/Math.sqrt(5)*(east[k]*Math.cos(i*2*Math.PI/5)+north[k]*Math.sin(i*2*Math.PI/5))));
export const V=[pole,...ring,...[3,4,5,1,2,0].map(i=>(i===0?pole:ring[i-1]).map(v=>-v))];
export const F=[[1,3,2],[1,4,3],[1,5,4],[1,6,5],[1,2,6],[2,3,8],[3,9,8],[3,4,9],[4,10,9],[4,5,10],[5,11,10],[5,6,11],[6,7,11],[2,7,6],[2,8,7],[8,9,12],[9,10,12],[10,11,12],[11,7,12],[8,12,7]].map(f=>f.map(v=>v-1));
export const TEMPLATE=[[0,1/S3],[.5,-1/(2*S3)],[-.5,-1/(2*S3)]];
function raw(x,y){
  const a=Math.atan2(2*y/S3-EL/6,DVE),b=Math.atan2(x-y/S3-EL/6,DVE),c=Math.atan2(-x-y/S3-EL/6,DVE);
  return [S3*(b-c),2*a-b-c];
}
const RAW_EDGE=raw(0,EL/S3)[1]*S3;
export const BASES=F.map(f=>{
  const [a,b,c]=f.map(i=>V[i]),n=norm(a.map((v,k)=>v+b[k]+c[k]));
  return {n,u:norm(b.map((v,k)=>v-c[k])),v:norm(a.map((v,k)=>v-dot(a,n)*n[k]))};
});
export function faceOf(dir){
  let best=0,score=-Infinity;
  BASES.forEach((b,i)=>{const s=dot(dir,b.n);if(s>score){score=s;best=i;}});
  return best;
}
export function forwardFace(face,dir){
  const b=BASES[face],scale=Z/dot(dir,b.n),[x,y]=raw(dot(dir,b.u)*scale,dot(dir,b.v)*scale).map(v=>v/RAW_EDGE);
  const a=(y+1/(2*S3))*2/S3;
  return [a,(1-a)/2+x,(1-a)/2-x];
}
// Analytic Jacobian / Newton inverse. Inversion is only done while building
// a cached geographic raster, never in an idle loop.
export function inverseFace(face,weights){
  const tx=(weights[1]-weights[2])/2*RAW_EDGE,ty=(weights[0]*S3/2-1/(2*S3))*RAW_EDGE;
  let x=(weights[1]-weights[2])*EL/2,y=(weights[0]*S3/2-1/(2*S3))*EL;
  for(let i=0;i<8;i++){
    const [px,py]=raw(x,y),ex=px-tx,ey=py-ty;
    if(Math.abs(ex)+Math.abs(ey)<1e-13)break;
    const derivative=q=>DVE/(DVE*DVE+q*q);
    const a=derivative(2*y/S3-EL/6),b=derivative(x-y/S3-EL/6),c=derivative(-x-y/S3-EL/6);
    const xx=S3*(b+c),xy=-b+c,yx=-b+c,yy=(4*a+b+c)/S3,det=xx*yy-xy*yx;
    x-=(yy*ex-xy*ey)/det;y-=(-yx*ex+xx*ey)/det;
  }
  const b=BASES[face];return norm(b.n.map((v,i)=>v*Z+b.u[i]*x+b.v[i]*y));
}
export const EDGES=[[0,1],[1,2],[2,0]];
export const NEIGHBORS=F.map((face,i)=>EDGES.map(([a,b])=>F.findIndex((f,j)=>j!==i&&f.includes(face[a])&&f.includes(face[b]))));
export function barycentric(p,tri){
  const [a,b,c]=tri,dx=p[0]-a[0],dy=p[1]-a[1],d=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const u=(dx*(c[1]-a[1])-dy*(c[0]-a[0]))/d,v=((b[0]-a[0])*dy-(b[1]-a[1])*dx)/d;
  return [1-u-v,u,v];
}
export const flatPoint=(weights,tri)=>[0,1].map(k=>weights.reduce((sum,w,i)=>sum+w*tri[i][k],0));
