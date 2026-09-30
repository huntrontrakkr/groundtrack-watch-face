// Minimal RGB PNG encoder for proof images rendered without a browser, and a
// decoder for the emulator's screenshots.
import {deflateSync,inflateSync,crc32} from 'node:zlib';
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
// Minimal decoder for 8-bit RGB or RGBA PNGs without interlacing, such as
// the emulator's screenshots. Returns RGB bytes.
export function decodePNG(png){
  let at=8,width=0,height=0,channels=3;const data=[];
  while(at<png.length){
    const n=png.readUInt32BE(at),type=png.toString('latin1',at+4,at+8),body=png.subarray(at+8,at+8+n);at+=12+n;
    if(type==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);if(body[8]!==8||![2,6].includes(body[9])||body[12])throw new Error('Unsupported PNG');channels=body[9]===6?4:3;}
    else if(type==='IDAT')data.push(body);else if(type==='IEND')break;
  }
  const raw=inflateSync(Buffer.concat(data)),stride=width*channels,out=Buffer.alloc(width*height*3);let prev=Buffer.alloc(stride);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],line=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let i=0;i<stride;i++){
      const a=i>=channels?line[i-channels]:0,b=prev[i],c=i>=channels?prev[i-channels]:0;
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      line[i]=(line[i]+[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][filter])&255;
    }
    for(let x=0;x<width;x++)line.copy(out,(y*width+x)*3,x*channels,x*channels+3);
    prev=line;
  }
  return {width,height,rgb:out};
}
