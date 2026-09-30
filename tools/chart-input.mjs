// The watch's own chart builder's input for an hour (native/host/chart_test
// reads it), as the phone would give the watch: the settings, the local hour
// and date, home and its rise and set, and the Sun and Moon segments.
import {PLATES,riseText,localDate,localDay} from '../src/enroute-render.js';
import {clockParts} from '../src/render.js';
import {segmentFor,encodeSegment,satelliteSegmentFor,encodeSatelliteSegment} from '../src/segments.js';
import {encodePassBlock,PASS_BLOCK} from '../src/home.js';
import {catalogEntry,viewOf} from '../src/satellites.js';

// Options as buildScene's: readout ('flag', 'callout' or off; flag: true is
// 'flag'), numerals, margin ('utc' or 'body'), span ('day' or 'hour'),
// transfer ('off', 'vernier', 'comb' or 'chevrons'), clock24.
export function chartInput({body,start,plate,flag,readout=flag?'flag':false,numerals='even',margin='utc',span='day',tape='fixed',transfer='off',minute=0,events=[],clock24=true,zone,home}){
  const d=localDate(start,zone),[rise,set]=home&&!body.startsWith('sat:')?riseText(body,home,start,zone):['',''],days=new Set();
  for(let t=start-2400e3;t<=start+6000e3;t+=60e3)days.add(Math.floor(t/86400000));
  // A satellite: its segments over the track, and the pass blocks the hour
  // touches.
  const sat=body.startsWith('sat:'),satsegs=new Map(),blocks=new Set(),dayView=viewOf(body)==='day'&&span!=='hour',day=dayView?localDay(start,zone):null;
  if(day)for(let t=day.start;t<=day.end;t+=300e3)days.add(Math.floor(t/86400000));
  if(sat){
    for(let t=start-2400e3;t<=start+6000e3;t+=60e3){const g=satelliteSegmentFor(body,t);satsegs.set(g.start,g);}
    if(day)for(let t=day.start;t<=day.end;t+=300e3){const g=satelliteSegmentFor(body,t);satsegs.set(g.start,g);}
    for(let t=start;t<start+3600e3;t+=60e3)blocks.add(Math.floor(t/PASS_BLOCK)*PASS_BLOCK);
  }
  const entry=catalogEntry(body),world=viewOf(body)==='world',readoutCode=readout==='flag'?1:readout==='callout'?2:0;
  const dayLines=day?[`daystart ${day.start/1000}`,`dayend ${day.end/1000}`,`dayhours ${Array.from({length:27},(_,k)=>Number(clockParts(day.start+k*3600e3,zone).h)).join(' ')}`]:[];
  return [`body ${body==='moon'?1:sat?(entry?.symbol==='station'?3:2):0}`,`view ${world?1:dayView?2:0}`,...(entry?[`code ${entry.code}`]:[]),...dayLines,`plate ${Object.keys(PLATES).indexOf(plate)}`,`flag ${readoutCode===1?1:0}`,`readout ${readoutCode}`,
    `numerals ${['colon','plain','even','mono','accent'].indexOf(numerals)}`,`zonebody ${margin==='body'?1:0}`,`tape ${['fixed','tape','slide'].indexOf(tape)}`,`transfer ${['off','vernier','comb','chevrons'].indexOf(transfer)}`,`minute ${minute}`,...events.map(e=>`event ${e.epoch/1000} ${e.label}`),`clock24 ${clock24?1:0}`,`start ${start/1000}`,
    `hour ${Number(clockParts(start,zone).h)}`,`day ${d.day}`,`month ${d.month}`,`year ${d.year}`,`yday ${d.dayOfYear}`,`home ${home?1:0}`,
    ...(home?[`lat ${home.lat}`,`lon ${home.lon}`,`rise ${rise}`,`set ${set}`]:[]),
    ...[...days].map(day=>`segment ${Buffer.from(encodeSegment(segmentFor(day*86400000))).toString('hex')}`),
    ...[...satsegs.values()].map(g=>`satseg ${Buffer.from(encodeSatelliteSegment(g)).toString('hex')}`),
    ...(sat&&home?[...blocks].map(b=>`passes ${Buffer.from(encodePassBlock(body,home,b,zone)).toString('hex')}`):[])].join('\n')+'\n';
}

