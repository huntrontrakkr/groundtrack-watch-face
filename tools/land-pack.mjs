// The watch's coastline (Groundtrack Fuller's zoomed charts): public/land.bin,
// 720 rows of 1440 quarter-degree land bits (180 bytes, LSB first), packed
// row by row as runs, losslessly. native/src/c/chart.c reads it a row at a
// time (land_row).
//
// land.pack (little-endian): 'GTL1', u16 rows, u16 columns, u32 offset[rows
// + 1] from the data's start, then each row's runs: alternately sea and
// land, sea first (perhaps 0 long), each length a varint (7 bits a byte,
// low first; the high bit set on every byte but the last), the row's last
// run running to its end.
//   node tools/land-pack.mjs   (writes native/resources/land.pack)
import {readFileSync,writeFileSync} from 'node:fs';
export const ROWS=720,COLS=1440;
export function packLand(bits){
  const rows=[];
  for(let y=0;y<ROWS;y++){
    const out=[];let x=0,want=0;
    const varint=v=>{do{let b=v&127;v>>>=7;if(v)b|=128;out.push(b);}while(v);};
    while(x<COLS){
      let n=0;while(x<COLS&&((bits[y*180+(x>>3)]>>(x&7))&1)===want){n++;x++;}
      if(x>=COLS)break;
      varint(n);want^=1;
    }
    rows.push(out);
  }
  const head=[...'GTL1'].map(c=>c.charCodeAt(0));head.push(ROWS&255,ROWS>>8,COLS&255,COLS>>8);
  let at=0;const offsets=[];for(const r of rows){offsets.push(at);at+=r.length;}offsets.push(at);
  for(const o of offsets)head.push(o&255,(o>>8)&255,(o>>16)&255,o>>>24);
  return Uint8Array.from([...head,...rows.flat()]);
}
// A row's bits (180 bytes), as the watch decodes it.
export function landRow(pack,y){
  const data=8+4*(ROWS+1),view=new DataView(pack.buffer,pack.byteOffset,pack.byteLength);
  let p=data+view.getUint32(8+4*y,true);const end=data+view.getUint32(12+4*y,true),out=new Uint8Array(180);
  let x=0,land=0;
  while(p<end){let v=0,s=0,b;do{b=pack[p++];v|=(b&127)<<s;s+=7;}while(b&128);if(land)for(let k=x;k<x+v;k++)out[k>>3]|=1<<(k&7);x+=v;land^=1;}
  if(land)for(let k=x;k<COLS;k++)out[k>>3]|=1<<(k&7);
  return out;
}
if(import.meta.url===`file://${process.argv[1]}`){
  const pack=packLand(new Uint8Array(readFileSync('public/land.bin')));
  writeFileSync('native/resources/land.pack',pack);
  console.log(`native/resources/land.pack: ${pack.length} bytes (land.bin: ${ROWS*180})`);
}
