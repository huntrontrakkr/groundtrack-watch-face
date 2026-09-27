import {writeFileSync,mkdirSync} from 'node:fs';
import {measureTrack} from '../src/trajectory.js';
import {BODIES} from '../src/ephemeris.js';
const cases=[];
for(const body of Object.keys(BODIES))for(const stepMinutes of [2,5,10]){
  const row=measureTrack(body,BODIES[body].demo,stepMinutes);
  row.maxDegrees=Number(row.maxDegrees.toFixed(6));
  row.maxProjectedPixelsUpperBound=Number(row.maxProjectedPixelsUpperBound.toFixed(6));
  cases.push(row);
}
const chosen=cases.filter(row=>row.stepMinutes===(row.body==='iss'?2:10));
const result={
  description:'Quantized trajectory storage and interpolation study; not electrical power measurement.',
  method:'Six hours per body, reference positions sampled every 15 seconds; int16 XYZ knots; normalized linear interpolation; worst angular error times 400 px is an orthographic error upper bound for these tested samples.',
  epochs:Object.fromEntries(Object.entries(BODIES).map(([id,body])=>[id,new Date(body.demo).toISOString()])),
  cases,chosen,
  budget:{threeBodyBytesPerSixHourBatch:chosen.reduce((sum,row)=>sum+row.bytes,0),bytesPerDayExcludingProtocolAndWindowOverlap:4*chosen.reduce((sum,row)=>sum+row.bytes,0),minuteWakeupsPerDay:1440,continuousOneHzWakeupsPerDay:86400,clockWakeupReductionFraction:1-1440/86400},
  caveats:['This checks interpolation against the same ephemeris, not the real-world orbit accuracy.','One historical ISS orbit and one day of Sun/Moon are not a validation of every satellite, date, or deep-space orbit.','Hours bracketing the screen and adjacent packet overlap add bytes; retry/chunk/ACK overhead is not included.','Radio sessions, native CPU work, RAM, and mAh must be measured after a watch implementation exists.']
};
mkdirSync('docs',{recursive:true});writeFileSync('docs/trajectory-measurements.json',JSON.stringify(result,null,2)+'\n');
console.table(chosen);console.log(result.budget);
