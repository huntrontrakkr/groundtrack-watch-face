// The Fuller sheets' ground from the faces' pre-projected grids
// (tools/fuller-pack.mjs), as the watch reads it: no projection is inverted
// per pixel. Each tile of the rolled sheet is one face placed by a
// similarity, so a pixel's place on its face's grid is an affine function
// of the pixel, kept in fixed point (quarter pixels in, 1/65536 of a grid
// step out) so the watch computes the same place. Land, relief and the
// direction the Sun is judged by are interpolated between the grid's three
// nearest points in integers. Zoomed in past FINE_SCALE (GPS's hour, a
// face 500 px across) the grid is too coarse for coastlines, so land comes
// from land.bin itself, at the interpolated directions.
import {atan2,asin} from './fmath.js';
import {barycentric} from './fuller.js';
import {wrap,dot,RAD} from './geometry.js';
import {reliefMeters} from './relief.js';

export const FULLER_N=64,GRID_POINTS=(FULLER_N+1)*(FULLER_N+2)/2,FINE_SCALE=150;
// The pack's size (tools/fuller-pack.mjs).
export const FULLER_BYTES=8+5*8+20*9*8+120+GRID_POINTS*6+40*GRID_POINTS;
export const gridIndex=(a,b)=>a*(FULLER_N+1)-a*(a-1)/2+b;
const N=FULLER_N,W=200,H=228;
const METERS=Float32Array.from({length:256},(_,c)=>reliefMeters(c));

export function decodeFullerPack(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(String.fromCharCode(...bytes.subarray(0,4))!=='GTF1'||bytes[4]!==N)throw new Error('Not a Fuller grid pack for this build');
  let at=8+5*8;
  const bases=[];for(let f=0;f<20;f++){const v=[];for(let k=0;k<9;k++){v.push(view.getFloat64(at,true));at+=8;}bases.push({n:v.slice(0,3),u:v.slice(3,6),v:v.slice(6,9)});}
  at+=120;
  const canon=new Int16Array(GRID_POINTS*3);for(let i=0;i<canon.length;i++){canon[i]=view.getInt16(at,true);at+=2;}
  const cover=bytes.slice(at,at+20*GRID_POINTS);at+=20*GRID_POINTS;
  const code=bytes.slice(at,at+20*GRID_POINTS);at+=20*GRID_POINTS;
  if(at!==bytes.length)throw new Error('Incomplete Fuller grid pack');
  return {bases,canon,cover,code};
}

// A tile's grid place as integers: a = Q0 + Qx*qx + Qy*qy in 1/65536 of a
// grid step, for quarter-pixel coordinates qx = 4x + k, qy = 4y + j.
export function tileGrid(camera,tile){
  const at=(x,y)=>{const w=barycentric(camera.toPlane(x,y),tile.tri);return [w[1]*N,w[2]*N];};
  const p00=at(0,0),p10=at(1,0),p01=at(0,1);
  return [0,1].map(k=>[Math.round(p00[k]*65536),Math.round((p10[k]-p00[k])*16384),Math.round((p01[k]-p00[k])*16384)]);
}
// The three grid points round a fixed-point place and their weights (out of
// 256), as [i0, w0, i1, w1, i2, w2].
export function gridCell(a16,b16){
  let a=Math.floor(a16/256),b=Math.floor(b16/256);
  a=Math.max(0,Math.min(N*256,a));b=Math.max(0,Math.min(N*256-a,b));
  const ia=Math.floor(a/256),ib=Math.floor(b/256),fa=a-ia*256,fb=b-ib*256;
  if(ia+ib>=N)return [gridIndex(ia,ib),256,0,0,0,0];
  if(fa+fb<=256)return [gridIndex(ia,ib),256-fa-fb,gridIndex(ia+1,ib),fa,gridIndex(ia,ib+1),fb];
  return [gridIndex(ia+1,ib+1),fa+fb-256,gridIndex(ia,ib+1),256-fa,gridIndex(ia+1,ib),256-fb];
}
// chart-render.js coverage().
function coverage(atlas,lat,lon){
  const u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
  const bit=(x,y)=>{x=((x%1440)+1440)%1440;y=Math.max(0,Math.min(719,y));const n=y*1440+x;return (atlas[n>>3]>>(n&7))&1;};
  return (bit(i,j)*(1-fu)+bit(i+1,j)*fu)*(1-fv)+(bit(i,j+1)*(1-fu)+bit(i+1,j+1)*fu)*fv;
}
const SUBSAMPLES=[[1,1],[3,1],[1,3],[3,3]];

// The ground (land, per-pixel light) and unsmoothed relief of a rolled sheet.
export function fullerGround(camera,pack,atlas){
  const grids=camera.tiles.map(t=>tileGrid(camera,t)),faces=camera.tiles.map(t=>t.face);
  const tile=new Int8Array(W*H).fill(-1),land=new Uint8Array(W*H),relief=new Float32Array(W*H),canon=new Int32Array(W*H*3);
  const fine=camera.scale>FINE_SCALE;
  const place=(t,qx,qy)=>{const [ga,gb]=grids[t];return gridCell(ga[0]+ga[1]*qx+ga[2]*qy,gb[0]+gb[1]*qx+gb[2]*qy);};
  const direction=(t,qx,qy,out)=>{
    const c=place(t,qx,qy),C=pack.canon;
    for(let k=0;k<3;k++)out[k]=(C[c[0]*3+k]*c[1]+C[c[2]*3+k]*c[3]+C[c[4]*3+k]*c[5])>>8;
    return out;
  };
  const d=[0,0,0];
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const i=y*W+x,t=camera.tileAt(x+.5,y+.5);if(t<0)continue;
    tile[i]=t;const qx=4*x+2,qy=4*y+2,c=place(t,qx,qy),f=faces[t]*GRID_POINTS;
    if(fine){
      // land.bin at four points in the pixel, as groundLayer samples it.
      let s=0;
      for(const [k,j] of SUBSAMPLES){
        const u=camera.tileAt(x+k/4,y+j/4);if(u<0)continue;
        direction(u,4*x+k,4*y+j,d);const b=pack.bases[faces[u]];
        const g0=d[0]*b.n[0]+d[1]*b.u[0]+d[2]*b.v[0],g1=d[0]*b.n[1]+d[1]*b.u[1]+d[2]*b.v[1],g2=d[0]*b.n[2]+d[1]*b.u[2]+d[2]*b.v[2],len=Math.sqrt(g0*g0+g1*g1+g2*g2);
        s+=coverage(atlas,asin(g2/len)/RAD,atan2(g1,g0)/RAD);
      }
      land[i]=s>=2?1:0;
    }else land[i]=pack.cover[f+c[0]]*c[1]+pack.cover[f+c[2]]*c[3]+pack.cover[f+c[4]]*c[5]>=32640?1:0;
    relief[i]=(METERS[pack.code[f+c[0]]]*c[1]+METERS[pack.code[f+c[2]]]*c[3]+METERS[pack.code[f+c[4]]]*c[5])/256;
    direction(t,qx,qy,d);canon[i*3]=d[0];canon[i*3+1]=d[1];canon[i*3+2]=d[2];
  }
  // The Sun's height at a pixel: its direction on the face's grid against
  // the Sun in the face's frame, both in integers.
  let lastSun=null,suns=null;
  const height=(i,sun)=>{
    const t=tile[i];if(t<0)return null;
    if(sun!==lastSun){lastSun=sun;suns=faces.map(f=>{const b=pack.bases[f];return [Math.round(dot(sun,b.n)*32768),Math.round(dot(sun,b.u)*32768),Math.round(dot(sun,b.v)*32768)];});}
    const s=suns[t];return (canon[i*3]*s[0]+canon[i*3+1]*s[1]+canon[i*3+2]*s[2])/536870912;
  };
  return {tile,land,relief,height};
}
