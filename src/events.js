// Events: moments the wearer has to be somewhere, set on the route as
// compulsory reporting points. On a watch they would come from the phone's
// timeline; the study keeps a few of its own.
import {localDay} from './enroute-render.js';
import {clockParts} from './render.js';
import {MINUTE} from './ephemeris.js';

// One in each frozen study hour, and one later on the Sun's day.
export const STUDY_EVENTS=[
  {epoch:Date.parse('2026-09-27T08:45:00Z'),label:'RUN'},{epoch:Date.parse('2026-09-15T12:50:00Z'),label:'STANDUP'},
  {epoch:Date.parse('2026-09-19T09:50:00Z'),label:'RUN'},{epoch:Date.parse('2019-06-05T12:40:00Z'),label:'STANDUP'},
  {epoch:Date.parse('2026-09-27T17:40:00Z'),label:'DINNER'}
];
// Names are set in the chart's capitals, ten characters at most.
export const eventLabel=text=>String(text).toUpperCase().replace(/[^A-Z0-9 &+\-/.]/g,'').trim().slice(0,10);
// A local wall-clock time on the local day that holds epoch, in timeZone.
export function atLocal(epoch,timeZone,h,m){
  const wall=t=>{const q=clockParts(t,timeZone);return Number(q.h)*60+Number(q.m);};
  let t=localDay(epoch,timeZone).start+(h*60+m)*MINUTE;
  return t+(h*60+m-wall(t))*MINUTE;
}
