// Nominal orbits: textbook element sets for orbit classes the study shows
// before any live elements arrive. They are not any satellite's measured
// orbit, and the page says so; tracking a real satellite replaces them.
import {checksum,registerElements,elementsFor,bodyId} from './satellites.js';
import {gstime} from 'satellite.js';

const field=(v,w,d)=>v.toFixed(d).padStart(w,' ');
// A two-line element set from mean elements (degrees, revolutions a day).
export function nominalTLE({norad,name,epoch,inclination,raan,ecc,argp,anomaly,meanMotion}){
  const d=new Date(epoch),y=d.getUTCFullYear(),day=(epoch-Date.UTC(y,0,1))/86400000+1,id=String(norad).padStart(5,'0');
  const l1=`1 ${id}U 00000A   ${String(y%100).padStart(2,'0')}${day.toFixed(8).padStart(12,'0')}  .00000000  00000-0  00000-0 0  999`;
  const l2=`2 ${id} ${field(inclination,8,4)} ${field(((raan%360)+360)%360,8,4)} ${Math.round(ecc*1e7).toString().padStart(7,'0')} ${field(argp,8,4)} ${field(anomaly,8,4)} ${field(meanMotion,11,8)}    1`;
  return `${name}\n${l1}${checksum(l1)}\n${l2}${checksum(l2)}\n`;
}
// The right ascension of the node that puts a satellite at perigee over a
// chosen longitude at epoch (perigee at argument of latitude argp).
export function nodeFor(epoch,lon,inclination,argp){
  const u=argp*Math.PI/180,i=inclination*Math.PI/180,gmst=gstime(new Date(epoch))*180/Math.PI;
  return lon+gmst-Math.atan2(Math.cos(i)*Math.sin(u),Math.cos(u))*180/Math.PI;
}

// The study's nominal GPS and QZSS orbits, each with its demonstration
// moment. QZS-2's orbit is quasi-zenith: 41° tilt, eccentricity 0.075 and
// perigee in the south, so its day's figure-8 is centred near 139°E.
export const STUDY_ORBITS=(()=>{
  const gps=Date.parse('2026-09-27T12:00:00Z'),qzs=Date.parse('2026-09-27T00:00:00Z');
  return [
    {norad:36585,demo:Date.parse('2026-09-27T13:24:00Z'),text:nominalTLE({norad:36585,name:'GPS BIIF-1 (NOMINAL)',epoch:gps,inclination:55,raan:nodeFor(gps,-60,55,0),ecc:0.01,argp:0,anomaly:0,meanMotion:2.00563})},
    {norad:42738,demo:Date.parse('2026-09-27T05:24:00Z'),text:nominalTLE({norad:42738,name:'QZS-2 (NOMINAL)',epoch:qzs,inclination:41,raan:nodeFor(qzs,139,41,270),ecc:0.075,argp:270,anomaly:0,meanMotion:1.00273791})}
  ];
})();
// Register the nominal orbits, leaving any live elements already loaded.
export function registerNominal(){for(const o of STUDY_ORBITS)if(!elementsFor(bodyId(o.norad)))registerElements(o.text,'nominal');}
