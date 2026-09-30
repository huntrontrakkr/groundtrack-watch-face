// The watch's own chart builder's input for an hour (native/host/chart_test
// reads it), as the phone would give the watch: the settings, the local hour
// and date, home and its rise and set, and the Sun and Moon segments.
import {PLATES,riseText,localDate} from '../src/enroute-render.js';
import {clockParts} from '../src/render.js';
import {segmentFor,encodeSegment,satelliteSegmentFor,encodeSatelliteSegment} from '../src/segments.js';
import {encodePassBlock,PASS_BLOCK} from '../src/home.js';

export function chartInput({body,start,plate,flag,zone,home}){
  const d=localDate(start,zone),[rise,set]=home&&!body.startsWith('sat:')?riseText(body,home,start,zone):['',''],days=new Set();
  for(let t=start-2400e3;t<=start+6000e3;t+=60e3)days.add(Math.floor(t/86400000));
  // A satellite: its segments over the track, and the pass blocks the hour
  // touches.
  const sat=body.startsWith('sat:'),satsegs=new Map(),blocks=new Set();
  if(sat){
    for(let t=start-2400e3;t<=start+6000e3;t+=60e3){const g=satelliteSegmentFor(body,t);satsegs.set(g.start,g);}
    for(let t=start;t<start+3600e3;t+=60e3)blocks.add(Math.floor(t/PASS_BLOCK)*PASS_BLOCK);
  }
  return [`body ${body==='moon'?1:sat?2:0}`,`plate ${Object.keys(PLATES).indexOf(plate)}`,`flag ${flag?1:0}`,'clock24 1',`start ${start/1000}`,
    `hour ${Number(clockParts(start,zone).h)}`,`day ${d.day}`,`month ${d.month}`,`year ${d.year}`,`yday ${d.dayOfYear}`,`home ${home?1:0}`,
    ...(home?[`lat ${home.lat}`,`lon ${home.lon}`,`rise ${rise}`,`set ${set}`]:[]),
    ...[...days].map(day=>`segment ${Buffer.from(encodeSegment(segmentFor(day*86400000))).toString('hex')}`),
    ...[...satsegs.values()].map(g=>`satseg ${Buffer.from(encodeSatelliteSegment(g)).toString('hex')}`),
    ...(sat&&home?[...blocks].map(b=>`passes ${Buffer.from(encodePassBlock(body,home,b,zone)).toString('hex')}`):[])].join('\n')+'\n';
}

