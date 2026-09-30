import {twoline2satrec,propagate,gstime,eciToGeodetic} from 'satellite.js';
import iss from '../data/iss.json' with {type:'json'};
import {direction,wrap,RAD} from './geometry.js';
import {segmentPosition,segmentMoonLight,satelliteSegmentPosition} from './segments.js';
const satrec=twoline2satrec(...iss.tle);
export const MINUTE=60000;
export const BODIES={
  sun:{name:'Sun',label:'SUBSOLAR TRACK',kind:'natural',demo:Date.parse('2026-09-27T09:24:00Z'),window:180,cameraMinutes:30},
  moon:{name:'Moon',label:'SUBLUNAR TRACK',kind:'natural',demo:Date.parse('2026-09-27T21:24:00Z'),window:180,cameraMinutes:30},
  iss:{name:'ISS',label:'ISS / ARCHIVE',kind:'satellite',demo:Date.parse('2019-06-05T12:24:00Z'),window:90,cameraMinutes:10}
};
export function position(body,epoch){
  // Live satellites registered from element sets: see satellites.js.
  // Live satellites: from segments fitted to SGP4 (segments.js), as the
  // watch draws them.
  if(typeof body==='string'&&body.startsWith('sat:')){
    if(!Number.isFinite(epoch))throw new RangeError('Invalid time');
    const {lat,lon,altitude}=satelliteSegmentPosition(body,epoch);
    return {lat,lon,dir:direction(lat,lon),altitude};
  }
  if(!BODIES[body]||!Number.isFinite(epoch))throw new RangeError('Unknown body or invalid time');
  const date=new Date(epoch);
  if(body==='iss'){
    // Refuse to disguise an old element set as a contemporary prediction.
    if(Math.abs(epoch-Date.parse(iss.epoch))>24*60*MINUTE)throw new RangeError('ISS study is limited to one day around its archived epoch');
    const state=propagate(satrec,date);
    if(!state?.position)throw new Error('ISS propagation failed');
    const p=eciToGeodetic(state.position,gstime(date));
    const lat=p.latitude/RAD,lon=p.longitude/RAD;
    return {lat,lon,dir:direction(lat,lon),altitude:p.height};
  }
  // The Sun and Moon come from daily Chebyshev segments fitted to Astronomy
  // Engine (segments.js), the same ones the watch evaluates.
  const {lat,lon,distance}=segmentPosition(body,epoch);
  return {lat,lon,dir:direction(lat,lon),altitude:distance-6371};
}
export function moonLight(epoch){
  if(!Number.isFinite(epoch))throw new RangeError('Invalid time');
  return segmentMoonLight(epoch);
}
export function sampleTrack(body,start,end,step=MINUTE){
  if(step<=0||!Number.isFinite(step)||end<start||!Number.isFinite(start)||!Number.isFinite(end))throw new RangeError('Invalid sample interval');
  if((end-start)/step>10000)throw new RangeError('Track sample limit exceeded');
  const result=[];
  for(let epoch=start;epoch<=end;epoch+=step)result.push({epoch,...position(body,epoch)});
  return result;
}
