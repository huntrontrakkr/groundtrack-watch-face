// Test fixture: the archived 2019 ISS element set, moved to a chosen epoch
// and catalog number with fresh checksums. Its orbit is still the 2019 ISS;
// it exists only to exercise live-element handling without a network.
import {checksum} from '../src/satellites.js';
import iss from '../data/iss.json' with {type:'json'};
export function fixtureTLE(epoch,norad=25544,name='ISS (ZARYA)'){
  const d=new Date(epoch),y=d.getUTCFullYear(),day=(epoch-Date.UTC(y,0,1))/86400000+1,id=String(norad).padStart(5,'0');
  const l1=iss.tle[0].slice(0,2)+id+iss.tle[0].slice(7,18)+String(y%100).padStart(2,'0')+day.toFixed(8).padStart(12,'0')+iss.tle[0].slice(32,68);
  const l2=iss.tle[1].slice(0,2)+id+iss.tle[1].slice(7,68);
  return `${name}\n${l1}${checksum(l1)}\n${l2}${checksum(l2)}\n`;
}
