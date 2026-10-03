// A looping GIF of RGB frames (the store's animated screenshot): one
// palette for all of them (the watch draws in 64 colours), each frame whole,
// LZW-coded as GIF89a has it.
//   encodeGIF(frames, width, height, delay)   frames: RGB buffers; delay in
//   hundredths of a second
//   decodeGIF(bytes)   {width, height, loops, frames: [{rgb, delay}]}, for
//   the tests: written from the format, not from the encoder
export function encodeGIF(frames,width,height,delay){
  // The palette: every colour the frames use, in order of first use.
  const index=new Map(),palette=[];
  for(const f of frames)for(let i=0;i<width*height*3;i+=3){
    const c=f[i]<<16|f[i+1]<<8|f[i+2];
    if(!index.has(c)){if(palette.length===256)throw new Error('More than 256 colours');index.set(c,palette.length);palette.push(c);}
  }
  let bits=1;while(1<<bits<palette.length)bits++;
  const size=1<<bits,out=[];
  const u8=v=>out.push(v&255),u16=v=>{u8(v);u8(v>>8);},bytes=s=>{for(const ch of s)u8(ch.charCodeAt(0));};
  bytes('GIF89a');u16(width);u16(height);u8(0x80|(bits-1)<<4|(bits-1));u8(0);u8(0);
  for(let k=0;k<size;k++){const c=palette[k]??0;u8(c>>16);u8(c>>8);u8(c);}
  // Loop for ever (NETSCAPE2.0).
  u8(0x21);u8(0xff);u8(11);bytes('NETSCAPE2.0');u8(3);u8(1);u16(0);u8(0);
  const min=Math.max(2,bits);
  for(const f of frames){
    u8(0x21);u8(0xf9);u8(4);u8(0);u16(delay);u8(0);u8(0);
    u8(0x2c);u16(0);u16(0);u16(width);u16(height);u8(0);
    u8(min);
    const data=lzw(f,width*height,index,min),blocks=[];
    for(let i=0;i<data.length;i+=255){const n=Math.min(255,data.length-i);blocks.push(n,...data.subarray(i,i+n));}
    for(const v of blocks)u8(v);u8(0);
  }
  u8(0x3b);
  return Uint8Array.from(out);
}
// GIF's LZW: codes from min+1 bits, a clear code first and whenever the
// table fills at 4096.
function lzw(frame,n,index,min){
  const clear=1<<min,end=clear+1,out=[];let acc=0,accBits=0,width=min+1,next=end+1;
  const emit=code=>{acc|=code<<accBits;accBits+=width;while(accBits>=8){out.push(acc&255);acc>>>=8;accBits-=8;}};
  let table=new Map();emit(clear);
  const px=i=>index.get(frame[3*i]<<16|frame[3*i+1]<<8|frame[3*i+2]);
  let prefix=px(0);
  for(let i=1;i<n;i++){
    const k=px(i),key=prefix*4096+k,found=table.get(key);
    if(found!==undefined){prefix=found;continue;}
    emit(prefix);
    if(next<4096){table.set(key,next++);if(next>1<<width&&width<12)width++;}
    else{emit(clear);table=new Map();next=end+1;width=min+1;}
    prefix=k;
  }
  emit(prefix);emit(end);
  if(accBits>0)out.push(acc&255);
  return Uint8Array.from(out);
}

// GIF89a, as far as these files use it: global palette, a loop extension,
// and for each frame a delay and an image, LZW-coded.
export function decodeGIF(b){
  const assert={equal:(a,b)=>{if(a!==b)throw new Error(`GIF: ${a} where ${b}`);},deepEqual:(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`GIF: ${a} where ${b}`);}};
  let o=0;const u8=()=>b[o++],u16=()=>{const v=b[o]|b[o+1]<<8;o+=2;return v;};
  assert.equal(String.fromCharCode(...b.subarray(0,6)),'GIF89a');o=6;
  const width=u16(),height=u16(),flags=u8();u8();u8();
  const palette=[];for(let k=0;k<2<<(flags&7);k++)palette.push([u8(),u8(),u8()]);
  const frames=[];let delay=0,loops=null;
  for(;;){
    const t=u8();
    if(t===0x3b)break;
    if(t===0x21){
      const label=u8();const blocks=[];for(let n=u8();n;n=u8()){blocks.push(b.subarray(o,o+n));o+=n;}
      if(label===0xf9)delay=blocks[0][1]|blocks[0][2]<<8;
      if(label===0xff&&String.fromCharCode(...blocks[0])==='NETSCAPE2.0')loops=blocks[1][1]|blocks[1][2]<<8;
      continue;
    }
    assert.equal(t,0x2c);
    const x=u16(),y=u16(),w=u16(),h=u16();assert.deepEqual([x,y,w,h,u8()],[0,0,width,height,0]);
    const min=u8(),data=[];for(let n=u8();n;n=u8()){data.push(...b.subarray(o,o+n));o+=n;}
    // LZW, decoded.
    const clear=1<<min,end=clear+1,out=[];let table,width_,pos=0,prev=null;
    const reset=()=>{table=[];for(let k=0;k<clear;k++)table.push([k]);table.push(null,null);width_=min+1;};
    const code=()=>{let v=0;for(let i=0;i<width_;i++,pos++)v|=(data[pos>>3]>>(pos&7)&1)<<i;return v;};
    reset();
    for(;;){
      const c=code();
      if(c===clear){reset();prev=null;continue;}
      if(c===end)break;
      let entry;
      if(c<table.length&&table[c])entry=table[c];
      else if(c===table.length&&prev)entry=[...prev,prev[0]];
      else throw new Error('bad code '+c);
      out.push(...entry);
      if(prev&&table.length<4096)table.push([...prev,entry[0]]);
      if(table.length===1<<width_&&width_<12)width_++;
      prev=entry;
    }
    const rgb=new Uint8Array(width*height*3);out.forEach((k,i)=>rgb.set(palette[k],3*i));
    frames.push({rgb,delay});
  }
  return {width,height,frames,loops};
}
