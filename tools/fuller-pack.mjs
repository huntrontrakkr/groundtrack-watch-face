// The Fuller sheets' ground, pre-projected: each icosahedron face sampled
// once on a triangular grid, N steps an edge, as Dymaxion pre-projects its
// net. The rolled sheet places whole faces, so the study and the watch both
// read a pixel's ground from its face's grid (src/fuller-ground.js) instead
// of inverting the projection at every pixel.
//
//   node tools/fuller-pack.mjs
//
// Writes public/fuller.bin (the study's) and native-fuller/resources/fuller.bin
// (the watch's). The format, little-endian:
//   "GTF1", u8 N, 3 bytes padding;
//   f64 S3, Z, EL, DVE, RAW_EDGE (fuller.js's constants);
//   20 faces' bases, f64 n[3], u[3], v[3];
//   u8 F[20][3], NEIGHBORS[20][3];
//   per grid point, i16 x 3: the point's direction in its face's frame
//     (along n, u, v), times 16384, the same on every face;
//   per face, per grid point, u8 land coverage (0..255);
//   per face, per grid point, u8 relief code (relief.js).
// Grid point (a, b), a + b <= N, has weights (1 - (a+b)/N, a/N, b/N) and
// index a*(N+1) - a*(a-1)/2 + b.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {F,NEIGHBORS,BASES,inverseFace,CONSTANTS} from '../src/fuller.js';
import {decodeRelief,reliefAt,reliefMeters} from '../src/relief.js';
import {lonLat,dot} from '../src/geometry.js';
import {FULLER_N as N,gridIndex,GRID_POINTS} from '../src/fuller-ground.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const land=(lat,lon)=>{
  const x=Math.min(1439,Math.floor((((lon+180)%360+360)%360)*4)),y=Math.max(0,Math.min(719,Math.floor((90-lat)*4))),n=y*1440+x;
  return (atlas[n>>3]>>(n&7))&1;
};
// The relief code nearest a height.
const codes=Array.from({length:256},(_,c)=>reliefMeters(c));
const codeOf=m=>{let best=0;for(let c=1;c<256;c++)if(Math.abs(codes[c]-m)<Math.abs(codes[best]-m))best=c;return best;};

const out=[];
const u8=v=>out.push(v&255),i16=v=>{u8(v);u8(v>>8);},f64=v=>{const b=Buffer.alloc(8);b.writeDoubleLE(v);out.push(...b);};
for(const c of 'GTF1')u8(c.charCodeAt(0));
u8(N);u8(0);u8(0);u8(0);
for(const v of [CONSTANTS.S3,CONSTANTS.Z,CONSTANTS.EL,CONSTANTS.DVE,CONSTANTS.RAW_EDGE])f64(v);
for(const b of BASES)for(const v of [...b.n,...b.u,...b.v])f64(v);
for(const f of F)for(const v of f)u8(v);
for(const f of NEIGHBORS)for(const v of f)u8(v);
// Directions in a face's own frame: the same for every face.
const b0=BASES[0];
for(let a=0;a<=N;a++)for(let b=0;a+b<=N;b++){
  const d=inverseFace(0,[1-(a+b)/N,a/N,b/N]);
  for(const axis of [b0.n,b0.u,b0.v])i16(Math.round(dot(d,axis)*16384));
}
// Each grid point's ground, averaged over its cell (5 x 5 samples).
const cover=new Uint8Array(20*GRID_POINTS),relief=new Uint8Array(20*GRID_POINTS),S=5;
F.forEach((_,face)=>{
  for(let a=0;a<=N;a++)for(let b=0;a+b<=N;b++){
    let c=0,r=0;
    for(let i=0;i<S;i++)for(let j=0;j<S;j++){
      const A=a+(i+.5)/S-.5,B=b+(j+.5)/S-.5,g=lonLat(inverseFace(face,[1-(A+B)/N,A/N,B/N]));
      c+=land(g.lat,g.lon);r+=reliefAt(meters,g.lat,g.lon);
    }
    const k=face*GRID_POINTS+gridIndex(a,b);cover[k]=Math.round(c/(S*S)*255);relief[k]=codeOf(r/(S*S));
  }
});
out.push(...cover,...relief);
const bytes=Uint8Array.from(out);
for(const path of ['public','native-fuller/resources']){mkdirSync(path,{recursive:true});writeFileSync(`${path}/fuller.bin`,bytes);}
console.log(`fuller.bin: ${N} steps an edge, ${GRID_POINTS} points a face, ${bytes.length} bytes`);
