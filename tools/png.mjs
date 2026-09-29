// Minimal RGB PNG encoder for proof images rendered without a browser.
import {deflateSync,crc32} from 'node:zlib';
const chunk=(type,data)=>{
  const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);out.write(type,4,'latin1');data.copy(out,8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type,'latin1'),data])),8+data.length);return out;
};
export function encodePNG(rgb,width,height,scale=1){
  const rows=Buffer.alloc((width*scale*3+1)*height*scale);
  for(let y=0;y<height*scale;y++){
    const row=y*(width*scale*3+1);rows[row]=0;
    for(let x=0;x<width*scale;x++){const s=(Math.floor(y/scale)*width+Math.floor(x/scale))*3;rows.set([rgb[s],rgb[s+1],rgb[s+2]],row+1+x*3);}
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width*scale,0);header.writeUInt32BE(height*scale,4);header.set([8,2,0,0,0],8);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
