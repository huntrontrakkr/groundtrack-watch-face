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

// CelesTrak's element sets for the fast satellites, as fetched on 29
// September 2026 (epochs that day, 17:05-19:40 UTC): registered for tests of
// the world band, good to 2 October.
import {readFileSync} from 'node:fs';
import {registerElements} from '../src/satellites.js';
export function registerLiveFixture(){
  const lines=readFileSync(new URL('./fixtures/celestrak-2026-09-29.tle',import.meta.url),'utf8').trim().split('\n');
  for(let i=0;i+2<lines.length;i+=3)registerElements(lines.slice(i,i+3).join('\n')+'\n','fixture');
}
