import {sampleTrack,MINUTE} from './ephemeris.js';
import {norm,dot,cross} from './geometry.js';
import {faceOf,forwardFace,inverseFace,flatPoint,barycentric} from './fuller.js';
import {unfold,mapTrack,copies} from './unfold.js';

export function atlasCamera(body,start,minutes,zoom='wide',framing={}){
  const samples=sampleTrack(body,start,start+minutes*MINUTE,body==='iss'?MINUTE/4:MINUTE);
  const atlas=unfold(faceOf(samples[Math.floor(samples.length/2)].dir),14);
  const track=mapTrack(atlas,samples),mean=[0,1].map(k=>track.reduce((s,p)=>s+p.xy[k]/track.length,0));
  let xx=0,xy=0,yy=0;
  for(const p of track){const x=p.xy[0]-mean[0],y=p.xy[1]-mean[1];xx+=x*x;xy+=x*y;yy+=y*y;}
  const angle=.5*Math.atan2(2*xy,xx-yy);let up=[Math.cos(angle),Math.sin(angle)];
  const trend=track.reduce((s,p,i)=>s+(i-track.length/2)*((p.xy[0]-mean[0])*up[0]+(p.xy[1]-mean[1])*up[1]),0);
  if(trend<0)up=up.map(v=>-v);
  const right=[up[1],-up[0]],rotate=p=>[p[0]*right[0]+p[1]*right[1],p[0]*up[0]+p[1]*up[1]];
  const rp=track.map(p=>rotate(p.xy)),extent=[0,1].map(k=>[Math.min(...rp.map(p=>p[k])),Math.max(...rp.map(p=>p[k]))]);
  const mid=extent.map(e=>(e[0]+e[1])/2);
  const scale=Math.min((framing.width??138)/Math.max(framing.minWidth??.2,extent[0][1]-extent[0][0]),(framing.height??151)/Math.max(.2,extent[1][1]-extent[1][0]))*(zoom==='close'?1.85:1);
  const cx=framing.cx??108,cy=framing.cy??116,aspect=framing.aspect??.90,perspective=framing.perspective??0;
  const screen=(xy,h=0)=>{
    const p=rotate(xy),u=(p[0]-mid[0])*scale,v=(p[1]-mid[1])*scale,z=scale*h,depth=1+v*perspective;
    return {x:cx+(u+z*.24)/depth,y:cy-(v*aspect+z*.8)/depth,visible:true};
  };
  const triangles=atlas.tiles.map(tile=>({tile,points:tile.tri.map(p=>{const q=screen(p);return [q.x,q.y];})}));
  const visible=triangles.filter(t=>Math.max(...t.points.map(p=>p[0]))>=-1&&Math.min(...t.points.map(p=>p[0]))<=201&&Math.max(...t.points.map(p=>p[1]))>=-1&&Math.min(...t.points.map(p=>p[1]))<=229);
  const at=(x,y)=>{
    // Undo the plane's projective camera before interpolating geographic
    // weights. Affine barycentrics in a perspective image would warp Earth.
    const v=(cy-y)/(aspect-(cy-y)*perspective),u=(x-cx)*(1+v*perspective);
    const r=u/scale+mid[0],q=v/scale+mid[1],xy=[right[0]*r+up[0]*q,right[1]*r+up[1]*q];
    for(const {tile} of visible){
      const weights=barycentric(xy,tile.tri);
      if(weights.every(w=>w>=-1e-8))return {tile,weights,dir:inverseFace(tile.face,weights)};
    }
    return null;
  };
  const projectIn=(tile,dir,h=0)=>screen(flatPoint(forwardFace(tile.face,dir),tile.tri),h);
  const allCopies=dir=>copies(atlas,dir).map(p=>({...p,...screen(p.xy)}));
  const project=dir=>allCopies(dir).sort((a,b)=>Math.hypot(a.x-100,a.y-114)-Math.hypot(b.x-100,b.y-114))[0];
  const camera={atlas,track:track.map(p=>({...p,...screen(p.xy)})),scale,screen,triangles:visible,at,project,projectIn,allCopies,
    start,end:start+minutes*MINUTE,key:[body,start,minutes,zoom].join('/'),
    inverse(x,y){return at(x,y)?.dir||null;},
    forTower(dir,tile,rectify=false){
      const e=norm(cross(Math.abs(dir[2])>.999?[0,1,0]:[0,0,1],dir)),n=cross(dir,e),p=projectIn(tile,dir);
      const derivative=axis=>{const q=projectIn(tile,norm(dir.map((v,i)=>v+axis[i]*.0001)));return {x:(q.x-p.x)/.0001,y:(q.y-p.y)/.0001};};
      const de=derivative(e),dn=derivative(n);
      const u=rectify?norm(e.map((v,i)=>v*dn.y-n[i]*de.y)):norm(e.map((v,i)=>v*de.x+n[i]*dn.x));
      // Optional optical correction aligns numeral plans with display axes.
      // Its dual basis preserves ray/volume intersections for skewed plans.
      if(rectify&&dot(u,e)*de.x+dot(u,n)*dn.x<0)for(let i=0;i<3;i++)u[i]*=-1;
      const v=rectify?norm(e.map((q,i)=>q*dn.x-n[i]*de.x)):norm(cross(dir,u));
      if(rectify&&dot(v,e)*de.y+dot(v,n)*dn.y>0)for(let i=0;i<3;i++)v[i]*=-1;
      const uv=dot(u,v),den=1-uv*uv,dualU=rectify?u.map((q,i)=>(q-uv*v[i])/den):u,dualV=rectify?v.map((q,i)=>(q-uv*u[i])/den):v;
      const projectWorld=world=>{
        const du=dot(world,dualU),dv=dot(world,dualV),h=dot(world,dir)-1;
        const base=norm(dir.map((q,i)=>q+u[i]*du+v[i]*dv));
        return projectIn(tile,base,h);
      };
      const plane=(_,height)=>{
        const origin=dir.map(v=>v*(1+height)),worldAt=(a,b)=>origin.map((q,i)=>q+u[i]*a+v[i]*b),base=projectWorld(origin);
        const pu=projectWorld(worldAt(.0001,0)),pv=projectWorld(worldAt(0,.0001));
        const ux=(pu.x-base.x)/.0001,uy=(pu.y-base.y)/.0001,vx=(pv.x-base.x)/.0001,vy=(pv.y-base.y)/.0001,det=ux*vy-uy*vx;
        return {origin,normal:dir,u,v,dualU,dualV,at:worldAt,inverse(x,y){
          let a=((x-base.x)*vy-(y-base.y)*vx)/det,b=((y-base.y)*ux-(x-base.x)*uy)/det;
          for(let i=0;i<8;i++){
            const q=projectWorld(worldAt(a,b)),ex=q.x-x,ey=q.y-y;
            if(Math.abs(ex)+Math.abs(ey)<.005)return {x:a,y:b};
            const u1=projectWorld(worldAt(a+.0001,b)),v1=projectWorld(worldAt(a,b+.0001));
            const ax=(u1.x-q.x)/.0001,ay=(u1.y-q.y)/.0001,bx=(v1.x-q.x)/.0001,by=(v1.y-q.y)/.0001,d=ax*by-ay*bx;
            if(!Number.isFinite(d)||Math.abs(d)<1e-8)return null;
            a-=(ex*by-ey*bx)/d;b-=(ey*ax-ex*ay)/d;
          }
          return null;
        }};
      };
      return {glyphScale:1,projectWorld,project:(_,h=0)=>projectWorld(dir.map(v=>v*(1+h))),plane};
    }
  };
  return camera;
}

// The north vane is local to the current body marker. Different unfolded
// copies rotate north differently; there is no single global atlas north.
export function localNorth(camera,point){
  const d=point.dir,n=norm([0,0,1].map((v,i)=>v-d[2]*d[i])),q=camera.projectIn(point.tile,norm(d.map((v,i)=>v+n[i]*.0001)));
  const p=camera.projectIn(point.tile,d),length=Math.hypot(q.x-p.x,q.y-p.y);
  return {x:(q.x-p.x)/length,y:(q.y-p.y)/length};
}
