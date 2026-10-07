// The watch's own chart builder's input for an hour (native/host/chart_test
// reads it), as the phone would give the watch: the settings, the local hour
// and date, home and its rise and set, and the Sun and Moon segments.
import {PLATES,FIGURE_SETS} from './plates.js';
import {riseText,localDate,localDay} from './chart-text.js';
import {clockParts} from './render.js';
import {segmentFor,encodeSegment,satelliteSegmentFor,encodeSatelliteSegment} from './segments.js';
import {encodePassBlock,PASS_BLOCK} from './home.js';
import {catalogEntry,viewOf,plotOf,registerElements,elementsFor} from './satellites.js';
import {chartOf,faceFor,VIEW_CODES} from './settings-rules.js';
import issArchive from '../data/iss.json' with {type:'json'};

// Options as buildScene's: readout ('flag', 'callout' or off; flag: true is
// 'flag'), numerals, margin ('utc' or 'body'), span ('day' or 'hour'),
// transfer ('off', 'vernier', 'comb' or 'chevrons'), clock24, projection
// ('chart' or 'fuller'), face ('enroute' or 'plotboard'), also (the Sun
// and Moon marked beside: ['sun', 'moon']), bare (the hour chart without its
// hour figures), legend (a Fuller sheet's scale bar). readout 'counter':
// this hour's figure as the time, its minutes beside it.
// Bytes as hex (the browser has no Buffer).
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function chartInput({body,start,plate,flag,readout=flag?'flag':false,numerals='even',margin='utc',span='day',tape='fixed',transfer='off',figures='michroma',corner='day',events=[],clock24=true,zone,home,projection='chart',face,also=[],bare=false,legend=false,north=false,extra=[]}){
  // The study's archived 2019 ISS orbit is the ISS on its archived elements.
  if(body==='iss'){if(elementsFor('sat:25544')?.source!=='archive')registerElements(issArchive.tle.join('\n')+'\n','archive');body='sat:25544';}
  const d=localDate(start,zone),[rise,set]=home&&!body.startsWith('sat:')?riseText(body,home,start,zone):['',''],days=new Set();
  for(let t=start-2400e3;t<=start+6000e3;t+=60e3)days.add(Math.floor(t/86400000));
  // A satellite: its segments over the track, and the pass blocks the hour
  // touches.
  // A rolling Fuller sheet is of the whole day for the Sun, the Moon and
  // QZSS (unless its hour is asked for), of the hour for the rest.
  // On Groundtrack the face (face: 'enroute' or 'plotboard'; without it, a
  // body's own) and the body's orbit say which chart: settings-rules.js.
  const fuller=projection==='fuller',sat=body.startsWith('sat:'),satsegs=new Map(),blocks=new Set();
  const chart=chartOf(fuller?'fuller':faceFor(face,viewOf(body)),body,viewOf(body),span,plotOf(body));
  const dayView=chart==='day'||chart==='worldday',day=dayView?localDay(start,zone):null;
  if(day)for(let t=day.start;t<=day.end;t+=300e3)days.add(Math.floor(t/86400000));
  if(sat){
    for(let t=start-2400e3;t<=start+6000e3;t+=60e3){const g=satelliteSegmentFor(body,t);satsegs.set(g.start,g);}
    if(day)for(let t=day.start;t<=day.end;t+=300e3){const g=satelliteSegmentFor(body,t);satsegs.set(g.start,g);}
    for(let t=start;t<start+3600e3;t+=60e3)blocks.add(Math.floor(t/PASS_BLOCK)*PASS_BLOCK);
  }
  extra=extra.slice(0,2).map((b,k,list)=>typeof b==='string'&&b.startsWith('sat:')&&b!==body&&list.indexOf(b)===k&&catalogEntry(b)?b:null);
  for(const b of extra)if(b)for(let t=start;t<start+3600e3;t+=60e3){
    try{const g=satelliteSegmentFor(b,t);satsegs.set(b+':'+g.start,g);}catch{} // Missing companions never blank the primary chart.
  }
  // (An hour chart bare of its hour figures has the time in full beside the body.)
  const entry=catalogEntry(body),readoutCode=bare&&chart==='hour'?2:readout==='flag'?1:readout==='callout'?2:readout==='counter'?3:0;
  const dayLines=day?[`daystart ${day.start/1000}`,`dayend ${day.end/1000}`,`dayhours ${Array.from({length:27},(_,k)=>Number(clockParts(day.start+k*3600e3,zone).h)).join(' ')}`]:[];
  return [`body ${body==='moon'?1:sat?(entry?.symbol==='station'?3:2):0}`,`view ${fuller&&chart==='hour'?0:VIEW_CODES[chart]}`,`fuller ${fuller?1:0}`,...(entry?[`code ${entry.code}`]:[]),...dayLines,`plate ${Object.keys(PLATES).indexOf(plate)}`,`flag ${readoutCode===1?1:0}`,`readout ${readoutCode}`,
    `numerals ${['colon','plain','even','mono','accent'].indexOf(numerals)}`,`zonebody ${margin==='body'?1:0}`,`tape ${['fixed','tape','slide','clock','route'].indexOf(tape)}`,`transfer ${['off','vernier','comb','chevrons'].indexOf(transfer)}`,`also ${(also.includes('sun')?1:0)|(also.includes('moon')?2:0)}`,`bare ${bare?1:0}`,`legend ${(legend?1:0)|(north?2:0)}`,`extra ${[0,1].map(k=>extra[k]?Number(extra[k].slice(4)):0).join(" ")}`,`figures ${Math.max(0,FIGURE_SETS.findIndex(f=>f[0]===figures))}`,...events.map(e=>`event ${e.epoch/1000} ${e.label}`),`clock24 ${clock24?1:0}`,`start ${start/1000}`,
    `hour ${Number(clockParts(start,zone).h)}`,`day ${d.day}`,`month ${d.month}`,`year ${d.year}`,`yday ${d.dayOfYear}`,`wday ${new Date(Date.UTC(d.year,d.month-1,d.day)).getUTCDay()}`,`corner ${Math.max(0,['day','point','light'].indexOf(corner))}`,`home ${home?1:0}`,
    ...(home?[`lat ${home.lat}`,`lon ${home.lon}`,`rise ${rise}`,`set ${set}`]:[]),
    ...[...days].map(day=>`segment ${hex(encodeSegment(segmentFor(day*86400000)))}`),
    ...[...satsegs.values()].map(g=>`satseg ${hex(encodeSatelliteSegment(g))}`),
    ...(sat&&home?[...blocks].map(b=>`passes ${hex(encodePassBlock(body,home,b,zone))}`):[])].join('\n')+'\n';
}

