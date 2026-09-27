import {Body,GeoVector,RotateVector,Rotation_EQJ_EQD,EquatorFromVector,SiderealTime,Illumination,MoonPhase} from 'astronomy-engine';
import {twoline2satrec,propagate,gstime,eciToGeodetic} from 'satellite.js';
import iss from '../data/iss.json' with {type:'json'};
import {direction,wrap,RAD} from './geometry.js';
const satrec=twoline2satrec(...iss.tle);
export const MINUTE=60000;
export const BODIES={
  sun:{name:'Sun',label:'SUBSOLAR TRACK',kind:'natural',demo:Date.parse('2026-09-27T09:24:00Z'),window:180,cameraMinutes:30},
  moon:{name:'Moon',label:'SUBLUNAR TRACK',kind:'natural',demo:Date.parse('2026-09-27T21:24:00Z'),window:180,cameraMinutes:30},
  iss:{name:'ISS',label:'ISS / ARCHIVE',kind:'satellite',demo:Date.parse('2019-06-05T12:24:00Z'),window:90,cameraMinutes:10}
};
export function position(body,epoch){
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
  const target=body==='sun'?Body.Sun:Body.Moon;
  const vector=RotateVector(Rotation_EQJ_EQD(date),GeoVector(target,date,true));
  const eq=EquatorFromVector(vector),lat=eq.dec,lon=wrap((eq.ra-SiderealTime(date))*15);
  return {lat,lon,dir:direction(lat,lon),altitude:eq.dist*149597870.7-6371};
}
export function moonLight(epoch){
  const date=new Date(epoch),fraction=Illumination(Body.Moon,date).phase_fraction;
  return {fraction,waxing:MoonPhase(date)<180};
}
export function sampleTrack(body,start,end,step=MINUTE){
  if(step<=0||!Number.isFinite(step)||end<start||!Number.isFinite(start)||!Number.isFinite(end))throw new RangeError('Invalid sample interval');
  if((end-start)/step>10000)throw new RangeError('Track sample limit exceeded');
  const result=[];
  for(let epoch=start;epoch<=end;epoch+=step)result.push({epoch,...position(body,epoch)});
  return result;
}
