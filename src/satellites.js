// Live satellites. General-perturbations element sets (TLEs) are fetched
// from CelesTrak by the page (or, on a watch, by the phone), checked, and
// registered here; positions come from SGP4 via Satellite.js. An element set
// is only used within FRESH of its own epoch: older elements are refused
// rather than shown as a current position.
import {twoline2satrec,propagate,gstime,eciToGeodetic} from 'satellite.js';
import {direction,RAD} from './geometry.js';

export const FRESH=3*24*3600000;
// Worth following, and different from each other. Ids are NORAD catalog
// numbers.
export const CATALOG=[
  {norad:25544,code:'ISS',name:'International Space Station',symbol:'station',note:'Crewed since 2000. 51.6° orbit, about 92 minutes a lap.'},
  {norad:48274,code:'CSS',name:'Tiangong',symbol:'station',note:'China’s space station. 41.5° orbit, about 92 minutes.'},
  {norad:20580,code:'HST',name:'Hubble Space Telescope',symbol:'satellite',note:'Launched 1990. 28.5° orbit, about 95 minutes.'},
  {norad:49260,code:'LS9',name:'Landsat 9',symbol:'satellite',note:'Sun-synchronous: crosses the equator southbound near 10:00 local time on every pass.'},
  {norad:43013,code:'N20',name:'NOAA-20',symbol:'satellite',note:'Polar weather satellite in the “afternoon” orbit, crossing near 13:30 local time.'},
  // Slow orbits: the ground moves under them little faster than under the
  // Sun, so they get the chart instead of the world band.
  {norad:36585,code:'GPS',name:'GPS BIIF-1 (PRN 25)',symbol:'satellite',view:'hour',note:'Navigation satellite in a 12-hour orbit at 20,200 km, tilted 55°: it crosses the ground at about the Sun’s pace but swings far north and south.'},
  {norad:42738,code:'QZS',name:'QZS-2 (Michibiki)',symbol:'satellite',view:'day',note:'Japan’s quasi-zenith navigation satellite: a tilted, slightly oval 24-hour orbit that traces a figure-8 over Japan and Australia once a day.'}
];
export const bodyId=norad=>`sat:${norad}`;
export const catalogEntry=body=>CATALOG.find(c=>bodyId(c.norad)===body);
// How a body is charted: 'hour' on the zoomed chart (the Sun, the Moon and
// slow orbits), 'day' as the whole local day on one chart (orbits that take
// a day to draw their shape), or 'world' on the world band (fast orbits).
export const viewOf=body=>body==='sun'||body==='moon'?'hour':catalogEntry(body)?.view||'world';

// TLE line checksum: digits count their value, minus signs count one.
export const checksum=line=>[...line.slice(0,68)].reduce((s,c)=>s+(c==='-'?1:/\d/.test(c)?Number(c):0),0)%10;
export function parseTLE(text){
  const lines=text.split(/\r?\n/).map(l=>l.trimEnd()).filter(Boolean),l1=lines.find(l=>l.startsWith('1 ')),l2=lines.find(l=>l.startsWith('2 '));
  if(!l1||!l2||l1.length<69||l2.length<69)throw new Error('Not a two-line element set');
  for(const l of [l1,l2])if(checksum(l)!==Number(l[68]))throw new Error('Element set checksum failed');
  if(l1.slice(2,7)!==l2.slice(2,7))throw new Error('Element lines describe different objects');
  const year=Number(l1.slice(18,20)),day=Number(l1.slice(20,32));
  const epoch=Date.UTC(year<57?2000+year:1900+year,0,1)+(day-1)*86400000;
  return {norad:Number(l1.slice(2,7)),lines:[l1,l2],epoch};
}

const registry=new Map();
export function registerElements(text,source){
  const tle=parseTLE(text),satrec=twoline2satrec(...tle.lines);
  if(satrec.error)throw new Error(`SGP4 rejected the elements (${satrec.error})`);
  const entry={...tle,satrec,source,catalog:CATALOG.find(c=>c.norad===tle.norad)};
  registry.set(bodyId(tle.norad),entry);return entry;
}
export const elementsFor=body=>registry.get(body);
export function satellitePosition(body,epoch){
  const e=registry.get(body);if(!e)throw new RangeError(`No elements loaded for ${body}`);
  if(Math.abs(epoch-e.epoch)>FRESH)throw new RangeError(`Elements for ${e.catalog?.code||body} are more than three days from this time`);
  const date=new Date(epoch),state=propagate(e.satrec,date);
  if(!state?.position)throw new Error('Propagation failed');
  const p=eciToGeodetic(state.position,gstime(date)),lat=p.latitude/RAD,lon=p.longitude/RAD;
  return {lat,lon,dir:direction(lat,lon),altitude:p.height};
}
