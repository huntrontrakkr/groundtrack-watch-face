// City lights for Study 06, from Natural Earth's 1:10m populated places
// (public domain). Each place of at least 50,000 people becomes a light at
// one of three brightnesses by its greatest population. NASA's Black Marble
// (also public domain) would show the light itself, roads and oil fields
// included; this stands in for it where that source cannot be reached.
import {writeFileSync} from 'node:fs';

const SOURCE='https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
export const LEVELS=[50000,500000,5000000];
const response=await fetch(SOURCE);if(!response.ok)throw new Error(`Natural Earth answered ${response.status}`);
const places=(await response.json()).features.map(f=>f.properties).filter(p=>p.pop_max>=LEVELS[0]&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
// Brightest first, so a bright city is never drawn under a dim one.
places.sort((a,b)=>b.pop_max-a.pop_max);
const points=places.flatMap(p=>[Math.round(p.latitude*10),Math.round(p.longitude*10),LEVELS.filter(l=>p.pop_max>=l).length]);
writeFileSync('data/lights.json',JSON.stringify({source:'Natural Earth 1:10m populated places (public domain)',url:SOURCE,levels:LEVELS,
  note:'Latitude and longitude in tenths of a degree, then brightness 1-3; brightest first.',points})+'\n');
console.log(`Wrote ${places.length} lights: ${[1,2,3].map(l=>places.filter(p=>LEVELS.filter(x=>p.pop_max>=x).length===l).length).join(' / ')} at levels 1 / 2 / 3.`);
