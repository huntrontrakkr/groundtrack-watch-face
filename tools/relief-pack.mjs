// A lossless pack of the map for the watch's resources: the land atlas and
// the relief grid together, cell by cell. For each cell the land bit is
// coded from the neighbouring land bits; then the relief code is predicted
// from its already-decoded neighbours with fixed-point weights (land and sea
// have their own), and the difference is coded against a frequency table
// chosen by land and by how large the neighbours' own differences were.
// Coding is rANS with fixed tables. Rows are grouped into strips that decode
// independently, so the watch decodes only the strips under the chart, and
// the decoder needs only the last three rows. Integer arithmetic throughout:
// the C decoder (native/src/c/map_pack.c) reproduces this one exactly.
//
// Pack (little-endian):
//   'GTM1', u16 width, u16 first row, u16 rows, u8 strip height,
//   u8 escape radius R, u8 error levels E, u8 pad,
//   u8 error thresholds[E-1], i16 weights[2][6] (Q8; sea, then land),
//   u16 land frequencies[64] (of a land cell, out of 4096, by the context
//   of six neighbouring land bits),
//   u16 relief frequencies[2*E][2R+2] (each sums to 4096; symbol 2R+1 is
//   the escape, followed by the cell's code as two 4-bit uniform symbols,
//   low first),
//   u32 strip offsets[strips+1] (from the start of the strip data),
//   strip data: each a rANS stream, its 32-bit initial state first.
// Rows run south from the first row; row r of the world is 90 - r/4 degrees.

export const MAGIC='GTM1',NEIGHBOURS=6,SCALE_BITS=12,TOTAL=1<<SCALE_BITS,RANS_L=1<<23;
export const THRESHOLDS=[1,3,6,10,16,26,40,64,100];

// The causal neighbourhood, with substitutes at the strip's edges (there is
// no wrap: x = 0 is decoded before x = width - 1). get(x, dy) reads the cell
// dy rows up (0, 1 or 2).
export function neighbours(get,x,dyMax,width){
  const up=dyMax>=1,up2=dyMax>=2;
  const w=x>0?get(x-1,0):up?get(x,1):0;
  const n=up?get(x,1):w;
  const nw=x>0&&up?get(x-1,1):n;
  const ne=x<width-1&&up?get(x+1,1):n;
  const ww=x>1?get(x-2,0):w;
  const nn=up2?get(x,2):n;
  return [w,n,nw,ne,ww,nn];
}
export function predict(weights,nb){
  let s=128;for(let i=0;i<NEIGHBOURS;i++)s+=weights[i]*nb[i];
  s>>=8;return s<0?0:s>255?255:s;
}
// How large the neighbours' differences were (|e|, clamped to 255, kept per
// cell), plus the local relief's activity: the relief context.
export function energy(err,nb,x,dyMax,width){
  const e=(xx,dy)=>dy>dyMax||xx<0||xx>=width?0:err(xx,dy);
  const sum=e(x-1,0)+e(x,1)+e(x-1,1)+e(x+1,1)+(e(x-2,0)>>1);
  return 2*sum+Math.abs(nb[0]-nb[2])+Math.abs(nb[1]-nb[2])+Math.abs(nb[3]-nb[1]);
}
export function level(thresholds,a){let k=0;while(k<thresholds.length&&a>=thresholds[k])k++;return k;}
// Six land bits around the cell (0 beyond the strip or the row).
export function landContext(bit,x,dyMax,width){
  const b=(xx,dy)=>dy>dyMax||xx<0||xx>=width?0:bit(xx,dy);
  return b(x-1,0)|b(x,1)<<1|b(x-1,1)<<2|b(x+1,1)<<3|b(x-2,0)<<4|b(x,2)<<5;
}

// Least-squares weights for one class, rounded to Q8.
function fitWeights(cells,isLand,width,rows,strip,cls){
  const k=NEIGHBOURS,A=Array.from({length:k},()=>new Float64Array(k)),b=new Float64Array(k);
  for(let y=0;y<rows;y++){const top=y-y%strip;for(let x=0;x<width;x++){
    if(isLand(x,y)!==cls)continue;
    const nb=neighbours((xx,dy)=>cells[(y-dy)*width+xx],x,Math.min(2,y-top),width),v=cells[y*width+x];
    for(let i=0;i<k;i++){b[i]+=nb[i]*v;for(let j=0;j<k;j++)A[i][j]+=nb[i]*nb[j];}
  }}
  const M=A.map((row,i)=>[...row,b[i]]);
  for(let i=0;i<k;i++){let p=i;for(let j=i+1;j<k;j++)if(Math.abs(M[j][i])>Math.abs(M[p][i]))p=j;[M[i],M[p]]=[M[p],M[i]];for(let j=i+1;j<k;j++){const f=M[j][i]/M[i][i];for(let c=i;c<=k;c++)M[j][c]-=f*M[i][c];}}
  const w=new Float64Array(k);for(let i=k-1;i>=0;i--){let s=M[i][k];for(let j=i+1;j<k;j++)s-=M[i][j]*w[j];w[i]=s/M[i][i];}
  return Array.from(w,v=>Math.round(v*256));
}

// Frequencies summing to TOTAL, every symbol at least 1.
function normalise(counts){
  const n=counts.reduce((a,b)=>a+b,0)||1,f=counts.map(c=>Math.max(1,Math.round(c/n*(TOTAL-counts.length))));
  let d=TOTAL-f.reduce((a,b)=>a+b,0);
  while(d){const order=[...f.keys()].sort((a,b)=>counts[b]-counts[a]);for(const i of order){if(!d)break;if(d>0){f[i]++;d--;}else if(f[i]>1){f[i]--;d++;}}}
  return f;
}
const cumulative=f=>{const c=[0];for(const v of f)c.push(c.at(-1)+v);return c;};

// relief: the 1440x720 grid of codes; land: the 1-bit atlas of the world.
export function encodePack(relief,land,{width=1440,first=0,rows=720,strip=32,radius=40,thresholds=THRESHOLDS}={}){
  const cells=relief.subarray(first*width,(first+rows)*width),E=thresholds.length+1,alphabet=2*radius+2,esc=alphabet-1;
  const isLand=(x,y)=>{const i=(first+y)*width+x;return (land[i>>3]>>(i&7))&1;};
  const weights=[fitWeights(cells,isLand,width,rows,strip,0),fitWeights(cells,isLand,width,rows,strip,1)];
  // Every cell's contexts and symbols, as the decoder will see them.
  const n=rows*width,lctx=new Uint8Array(n),lbit=new Uint8Array(n),rctx=new Uint8Array(n),sym=new Uint8Array(n),err=new Uint8Array(n);
  for(let y=0;y<rows;y++){const top=y-y%strip,dyMax=Math.min(2,y-top);for(let x=0;x<width;x++){
    const i=y*width+x,cls=isLand(x,y);
    lctx[i]=landContext((xx,dy)=>isLand(xx,y-dy),x,dyMax,width);lbit[i]=cls;
    const nb=neighbours((xx,dy)=>cells[(y-dy)*width+xx],x,dyMax,width),e=cells[i]-predict(weights[cls],nb);
    rctx[i]=cls*E+level(thresholds,energy((xx,dy)=>err[(y-dy)*width+xx],nb,x,dyMax,width));
    sym[i]=Math.abs(e)<=radius?e+radius:esc;err[i]=Math.min(255,Math.abs(e));
  }}
  const landCounts=Array.from({length:64},()=>[0,0]);for(let i=0;i<n;i++)landCounts[lctx[i]][lbit[i]]++;
  // One probability per land context: the frequency of land, the rest sea.
  const landFreq=landCounts.map(([sea,lnd])=>{const f=normalise([sea,lnd]);return f[1];});
  const tables=[];
  for(let c=0;c<2*E;c++){const counts=new Array(alphabet).fill(0);for(let i=0;i<n;i++)if(rctx[i]===c)counts[sym[i]]++;tables.push(normalise(counts));}
  const cums=tables.map(cumulative);
  // Each strip as one rANS stream: encode backwards, emit bytes reversed.
  const strips=[];
  for(let y0=0;y0<rows;y0+=strip){
    const out=[];let x=RANS_L;
    const put=(start,freq)=>{const max=((RANS_L>>>SCALE_BITS)<<8)*freq;while(x>=max){out.push(x&255);x>>>=8;}x=Math.floor(x/freq)*TOTAL+(x%freq)+start;};
    const end=Math.min(rows,y0+strip);
    for(let i=end*width-1;i>=y0*width;i--){
      const s=sym[i];
      // Decoded in the order land, relief, escape nibbles (low first).
      if(s===esc){const v=cells[i];put((v>>4)*(TOTAL/16),TOTAL/16);put((v&15)*(TOTAL/16),TOTAL/16);}
      put(cums[rctx[i]][s],tables[rctx[i]][s]);
      const f=landFreq[lctx[i]];put(lbit[i]?TOTAL-f:0,lbit[i]?f:TOTAL-f);
    }
    strips.push(Uint8Array.from([x&255,(x>>>8)&255,(x>>>16)&255,(x>>>24)&255,...out.reverse()]));
  }
  const head=[];const u8=v=>head.push(v&255),u16=v=>{u8(v);u8(v>>8);},u32=v=>{u16(v&65535);u16(v>>>16);};
  for(const ch of MAGIC)u8(ch.charCodeAt(0));
  u16(width);u16(first);u16(rows);u8(strip);u8(radius);u8(E);u8(0);
  for(const t of thresholds)u8(t);
  for(const w of weights)for(const v of w)u16(v<0?v+65536:v);
  for(const f of landFreq)u16(f);
  for(const f of tables)for(const v of f)u16(v);
  let at=0;u32(0);for(const s of strips){at+=s.length;u32(at);}
  const pack=new Uint8Array(head.length+at);pack.set(head,0);let o=head.length;for(const s of strips){pack.set(s,o);o+=s.length;}
  return pack;
}

// The reference decoder: the pack's header, and one strip's land bits and
// relief codes.
export function readPack(pack){
  const view=new DataView(pack.buffer,pack.byteOffset,pack.byteLength);let o=0;
  const u8=()=>view.getUint8(o++),u16=()=>{const v=view.getUint16(o,true);o+=2;return v;},i16=()=>{const v=view.getInt16(o,true);o+=2;return v;},u32=()=>{const v=view.getUint32(o,true);o+=4;return v;};
  if(String.fromCharCode(u8(),u8(),u8(),u8())!==MAGIC)throw new Error('Not a map pack');
  const width=u16(),first=u16(),rows=u16(),strip=u8(),radius=u8(),E=u8();u8();
  const thresholds=Array.from({length:E-1},u8),weights=[0,1].map(()=>Array.from({length:NEIGHBOURS},i16));
  const landFreq=Array.from({length:64},u16),alphabet=2*radius+2,tables=Array.from({length:2*E},()=>Array.from({length:alphabet},u16));
  const strips=Math.ceil(rows/strip),offsets=Array.from({length:strips+1},u32),data=o;
  return {width,first,rows,strip,radius,E,thresholds,weights,landFreq,tables,cums:tables.map(cumulative),offsets,data,pack};
}
export function decodeStrip(p,k){
  const {width,rows,strip,radius,E,thresholds,weights,landFreq,tables,cums,offsets,data,pack}=p,esc=2*radius+1;
  const y0=k*strip,end=Math.min(rows,y0+strip),n=(end-y0)*width,relief=new Uint8Array(n),land=new Uint8Array(n),err=new Uint8Array(n);
  let o=data+offsets[k],x=(pack[o]|pack[o+1]<<8|pack[o+2]<<16|pack[o+3]<<24)>>>0;o+=4;
  const take=slotFor=>{
    const slot=x&(TOTAL-1),[s,start,freq]=slotFor(slot);
    x=freq*(x>>>SCALE_BITS)+slot-start;
    while(x<RANS_L)x=((x<<8)|pack[o++])>>>0;
    return s;
  };
  const nibble=()=>take(slot=>{const s=slot>>8;return [s,s<<8,256];});
  for(let y=y0;y<end;y++){const dyMax=Math.min(2,y-y0);for(let xx=0;xx<width;xx++){
    const i=(y-y0)*width+xx,at=(a,dy,xc)=>a[(y-dy-y0)*width+xc];
    const f=landFreq[landContext((xc,dy)=>at(land,dy,xc),xx,dyMax,width)];
    const cls=take(slot=>slot<TOTAL-f?[0,0,TOTAL-f]:[1,TOTAL-f,f]);land[i]=cls;
    const nb=neighbours((xc,dy)=>at(relief,dy,xc),xx,dyMax,width),c=cls*E+level(thresholds,energy((xc,dy)=>at(err,dy,xc),nb,xx,dyMax,width));
    const cum=cums[c],s=take(slot=>{let s=0;while(cum[s+1]<=slot)s++;return [s,cum[s],tables[c][s]];});
    let v;if(s===esc){const lo=nibble();v=lo|nibble()<<4;}else v=predict(weights[cls],nb)+s-radius;
    relief[i]=v;err[i]=Math.min(255,Math.abs(v-predict(weights[cls],nb)));
  }}
  return {relief,land};
}
