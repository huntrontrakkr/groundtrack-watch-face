// The watch's map: the land bits and relief, the relief as the level each
// cell is in (the plates read relief only through their thresholds: the
// shelf, the contours, the tints), in tiles that decode on their own, at
// three resolutions (0.25°, 0.5° and 1° cells), so a chart decodes only the
// tiles under it at the resolution its pixels need. Lossless for what it
// keeps. Integer arithmetic throughout: the C decoder
// (native/src/c/map_pack.c) reproduces decodeTile exactly.
//
// Pack (little-endian):
//   'GTM2', u8 tile side T, u8 levels L, u8 mips M, u8 pad,
//   i16 height[L] (metres a level stands for),
//   u16 land frequency[16] (of a land cell, out of 4096, by four neighbouring
//     land bits: left, up, up-left, up-right; 0 beyond the tile),
//   u8 present[ceil(2*L*L/8)] (which level contexts occur: land, then the
//     left cell's level, then the up cell's; 0 beyond the tile), then for
//     each present context u16 frequency[L] (summing to 4096),
//   per mip: u8 resolution r (cells of 0.25 * 2^r degrees), u16 width, u16
//     first row, u16 rows (cells), u32 offset[tiles+1]
//     from the mip's data, tile data: a flat tile is 2 bytes, land and
//     level; else a rANS stream, its 32-bit state first, cells row by row,
//     each the land bit then the level.
// Row r of a mip is 90 - (first + r) * d degrees, d its cell size.
export const MAGIC='GTM2',T=32,SCALE_BITS=12,TOTAL=1<<SCALE_BITS,RANS_L=1<<23;
// The levels the plates threshold at (src/plates.js): the shelf at -200 m,
// the contours and the tints; each level's height is a height within it.
export const LEVELS=[-200,300,500,1000,2000,3000,3500,4000,5000],HEIGHTS=[-2000,50,400,750,1500,2500,3250,3750,4500,6000];
export const levelOf=metres=>{let k=0;while(k<LEVELS.length&&metres>=LEVELS[k])k++;return k;};

const cumulative=f=>{const c=[0];for(const v of f)c.push(c.at(-1)+v);return c;};
function normalise(counts){
  const n=counts.reduce((a,b)=>a+b,0)||1,f=counts.map(c=>Math.max(1,Math.round(c/n*(TOTAL-counts.length))));
  let d=TOTAL-f.reduce((a,b)=>a+b,0);
  while(d){const order=[...f.keys()].sort((a,b)=>counts[b]-counts[a]);for(const i of order){if(!d)break;if(d>0){f[i]++;d--;}else if(f[i]>1){f[i]--;d++;}}}
  return f;
}
// A mip's cells: land bits and levels, width x height, from the finer one
// (or the atlas and relief codes): land by majority, the level the most
// common.
export function mipOf(cells){
  const {width,height,land,level}=cells,w=width/2,h=height/2,l=new Uint8Array(w*h),v=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const c=[[2*x,2*y],[2*x+1,2*y],[2*x,2*y+1],[2*x+1,2*y+1]].map(([a,b])=>b*width+a),cnt=new Array(LEVELS.length+1).fill(0);let n=0;
    for(const i of c){n+=land[i];cnt[level[i]]++;}
    l[y*w+x]=n>=2?1:0;let best=0;for(let k=1;k<cnt.length;k++)if(cnt[k]>cnt[best])best=k;v[y*w+x]=best;
  }
  return {width:w,height:h,land:l,level:v};
}
export function cellsOf(relief,atlas,width=1440,height=720,reliefMeters){
  const land=new Uint8Array(width*height),level=new Uint8Array(width*height);
  for(let i=0;i<width*height;i++){land[i]=(atlas[i>>3]>>(i&7))&1;level[i]=levelOf(reliefMeters(relief[i]));}
  return {width,height,land,level};
}
// The contexts as the decoder sees them within a tile.
const landContext=(get,x,y)=>get(x-1,y)[0]|get(x,y-1)[0]<<1|get(x-1,y-1)[0]<<2|get(x+1,y-1)[0]<<3;
// L levels (0..L-1); a context is (land, the left cell's level, the up cell's).
const L=LEVELS.length+1,CONTEXTS=2*L*L;
const levelContext=(get,x,y,land)=>(land*L+get(x-1,y)[1])*L+get(x,y-1)[1];

// mips: [{cells, first, rows, resolution}] coarse last; each cropped to rows
// first..first+rows.
export function encodePack(mips){
  const landCounts=Array.from({length:16},()=>[0,0]),levelCounts=Array.from({length:CONTEXTS},()=>new Array(L).fill(0));
  const tiles=[];
  for(const {cells,first,rows,resolution} of mips){
    const {width,land,level}=cells,cols=Math.ceil(width/T),trows=Math.ceil(rows/T),list=[];
    for(let ty=0;ty<trows;ty++)for(let tx=0;tx<cols;tx++){
      const x0=tx*T,y0=first+ty*T,w=Math.min(T,width-x0),h=Math.min(T,first+rows-y0);
      const get=(x,y)=>x<x0||y<y0||x>=x0+w||y>=y0+h?[0,0]:[land[y*width+x],level[y*width+x]];
      let flat=true;const [l0,v0]=get(x0,y0);
      for(let y=y0;y<y0+h&&flat;y++)for(let x=x0;x<x0+w;x++)if(land[y*width+x]!==l0||level[y*width+x]!==v0){flat=false;break;}
      const syms=[];
      if(!flat)for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){
        const l=land[y*width+x],v=level[y*width+x],lc=landContext(get,x,y),vc=levelContext(get,x,y,l);
        landCounts[lc][l]++;levelCounts[vc][v]++;syms.push([lc,l,vc,v]);
      }
      list.push({flat,l0,v0,syms});
    }
    tiles.push({cells,first,rows,resolution,cols,trows,list});
  }
  const landFreq=landCounts.map(([sea,lnd])=>normalise([sea,lnd])[1]);
  const present=levelCounts.map(c=>c.some(n=>n>0)),tables=levelCounts.map((c,k)=>present[k]?normalise(c):null),cums=tables.map(t=>t&&cumulative(t));
  const head=[];const u8=v=>head.push(v&255),u16=v=>{u8(v);u8(v>>8);},i16=v=>u16(v<0?v+65536:v),u32=v=>{u16(v&65535);u16(v>>>16);};
  for(const ch of MAGIC)u8(ch.charCodeAt(0));
  u8(T);u8(L);u8(mips.length);u8(0);
  for(const h of HEIGHTS)i16(h);
  for(const f of landFreq)u16(f);
  const bits=new Uint8Array(Math.ceil(CONTEXTS/8));present.forEach((p,k)=>{if(p)bits[k>>3]|=1<<(k&7);});head.push(...bits);
  for(const t of tables)if(t)for(const f of t)u16(f);
  for(const {cells,first,rows,resolution,list} of tiles){
    u8(resolution);u16(cells.width);u16(first);u16(rows);
    const data=[];let at=0;const offsets=[0];
    for(const t of list){
      if(t.flat){data.push(t.l0,t.v0);at+=2;offsets.push(at);continue;}
      const out=[];let x=RANS_L;
      const put=(start,freq)=>{const max=((RANS_L>>>SCALE_BITS)<<8)*freq;while(x>=max){out.push(x&255);x>>>=8;}x=Math.floor(x/freq)*TOTAL+(x%freq)+start;};
      // Encoded backwards: the level then the land of each cell, last first.
      for(let i=t.syms.length-1;i>=0;i--){
        const [lc,l,vc,v]=t.syms[i];
        put(cums[vc][v],tables[vc][v]);
        const f=landFreq[lc];put(l?TOTAL-f:0,l?f:TOTAL-f);
      }
      const stream=[x&255,(x>>>8)&255,(x>>>16)&255,(x>>>24)&255,...out.reverse()];
      for(const v of stream)data.push(v);at+=stream.length;offsets.push(at);
    }
    for(const o of offsets)u32(o);
    for(const v of data)head.push(v);
  }
  return Uint8Array.from(head);
}

// The reference decoder: the pack's header and one tile's cells.
export function readPack(pack){
  const view=new DataView(pack.buffer,pack.byteOffset,pack.byteLength);let o=0;
  const u8=()=>view.getUint8(o++),u16=()=>{const v=view.getUint16(o,true);o+=2;return v;},i16=()=>{const v=view.getInt16(o,true);o+=2;return v;},u32=()=>{const v=view.getUint32(o,true);o+=4;return v;};
  if(String.fromCharCode(u8(),u8(),u8(),u8())!==MAGIC)throw new Error('Not a map pack');
  const t=u8(),levels=u8(),mips=u8();u8();
  const heights=Array.from({length:levels},i16),landFreq=Array.from({length:16},u16);
  const bits=Array.from({length:Math.ceil(CONTEXTS/8)},u8),present=Array.from({length:CONTEXTS},(_,k)=>(bits[k>>3]>>(k&7))&1);
  const tables=present.map(p=>p?Array.from({length:L},u16):null),cums=tables.map(t=>t&&cumulative(t));
  const mipList=[];
  for(let m=0;m<mips;m++){
    const resolution=u8(),width=u16(),first=u16(),rows=u16(),cols=Math.ceil(width/t),trows=Math.ceil(rows/t),offsets=Array.from({length:cols*trows+1},u32),data=o;
    mipList.push({resolution,width,first,rows,cols,trows,offsets,data});o+=offsets.at(-1);
  }
  return {t,levels,heights,landFreq,tables,cums,mips:mipList,pack};
}
// A tile's cells, row by row: land bit << 4 | level.
export function decodeTile(p,m,tx,ty){
  const mip=p.mips[m],{width,first,rows}=mip,t=p.t,x0=tx*t,y0=first+ty*t,w=Math.min(t,width-x0),h=Math.min(t,first+rows-y0),out=new Uint8Array(t*t);
  const k=ty*mip.cols+tx;let o=mip.data+mip.offsets[k];const end=mip.data+mip.offsets[k+1],pack=p.pack;
  if(end-o===2){out.fill(pack[o]<<4|pack[o+1]);return out;}
  let x=(pack[o]|pack[o+1]<<8|pack[o+2]<<16|pack[o+3]<<24)>>>0;o+=4;
  const take=(start,freq,slot)=>{x=freq*(x>>>SCALE_BITS)+slot-start;while(x<RANS_L)x=((x<<8)|pack[o++])>>>0;};
  const get=(cx,cy)=>cx<0||cy<0||cx>=w||cy>=h?[0,0]:[out[cy*t+cx]>>4,out[cy*t+cx]&15];
  for(let cy=0;cy<h;cy++)for(let cx=0;cx<w;cx++){
    const f=p.landFreq[landContext(get,cx,cy)];let slot=x&(TOTAL-1);
    const l=slot<TOTAL-f?0:1;take(l?TOTAL-f:0,l?f:TOTAL-f,slot);
    const c=levelContext(get,cx,cy,l),cum=p.cums[c];if(!cum)throw new Error('level context never seen');
    slot=x&(TOTAL-1);let s=0;while(cum[s+1]<=slot)s++;take(cum[s],p.tables[c][s],slot);
    out[cy*t+cx]=l<<4|s;
  }
  return out;
}
