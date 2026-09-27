import {interpolate,norm,angularDistance} from './geometry.js';
import {sampleTrack,MINUTE,position} from './ephemeris.js';
// Transport experiment, not the finished Pebble protocol. Millisecond epochs
// are float64; each knot is three signed, normalized int16 coordinates.
const HEADER=20;
export function packTrack(body,start,durationMinutes=360,stepMinutes=2){
  if(!Number.isInteger(durationMinutes)||!Number.isInteger(stepMinutes)||durationMinutes<1||stepMinutes<1||durationMinutes%stepMinutes)throw new RangeError('Whole, evenly divided minutes required');
  const knots=sampleTrack(body,start,start+durationMinutes*MINUTE,stepMinutes*MINUTE);
  const bytes=new Uint8Array(HEADER+knots.length*6),view=new DataView(bytes.buffer);
  bytes.set([71,84,1,0]);view.setFloat64(4,start,true);view.setUint32(12,stepMinutes*MINUTE,true);view.setUint32(16,knots.length,true);
  knots.forEach((k,i)=>k.dir.forEach((v,c)=>view.setInt16(HEADER+i*6+c*2,Math.round(v*32767),true)));
  return bytes;
}
export function unpackTrack(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<HEADER||bytes[0]!==71||bytes[1]!==84||bytes[2]!==1)throw new RangeError('Invalid trajectory header');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),start=view.getFloat64(4,true),step=view.getUint32(12,true),count=view.getUint32(16,true);
  if(!Number.isFinite(start)||step===0||count<2||bytes.length!==HEADER+count*6)throw new RangeError('Invalid trajectory length or interval');
  const knots=Array.from({length:count},(_,i)=>{
    const dir=Array.from({length:3},(_,c)=>view.getInt16(HEADER+i*6+c*2,true)/32767);
    if(Math.hypot(...dir)<.99||Math.hypot(...dir)>1.01)throw new RangeError('Invalid direction');
    return norm(dir);
  });
  return {start,step,knots,end:start+(count-1)*step};
}
export function cachedPosition(track,epoch){
  if(!Number.isFinite(epoch)||epoch<track.start||epoch>track.end)return null;
  const f=(epoch-track.start)/track.step,i=Math.min(track.knots.length-2,Math.floor(f));
  return interpolate(track.knots[i],track.knots[i+1],f-i);
}
export function measureTrack(body,start,stepMinutes,radius=400){
  const bytes=packTrack(body,start,360,stepMinutes),track=unpackTrack(bytes);
  let maxRadians=0;
  for(let t=start;t<=track.end;t+=15000)maxRadians=Math.max(maxRadians,angularDistance(position(body,t).dir,cachedPosition(track,t)));
  return {body,stepMinutes,hours:6,bytes:bytes.length,maxDegrees:maxRadians*180/Math.PI,maxProjectedPixelsUpperBound:radius*maxRadians,radius};
}
