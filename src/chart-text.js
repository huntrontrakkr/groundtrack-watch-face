// The chart's lettering that the phone composes for the watch: the
// nautical zone's letter, home's rise and set, a satellite's pass line, the
// local date and the local day.
import {clockParts} from './render.js';
import {MINUTE} from './ephemeris.js';
import {riseSet,nextPass} from './home.js';

export function nauticalZone(lon){
  const hours=Math.max(-12,Math.min(12,Math.round((((lon+540)%360)-180)/15)));
  return {hours,letter:hours===0?'Z':hours>0?'ABCDEFGHIKLM'[hours-1]:'NOPQRSTUVWXY'[-hours-1]};
}
// Local clock time in the chart's four figures, 24-hour, no colon.
const hhmm=(t,timeZone)=>{const q=clockParts(t,timeZone);return `${String(q.h).padStart(2,'0')}${String(q.m).padStart(2,'0')}`;};
export function riseText(body,home,epoch,timeZone){
  const {rise,set}=riseSet(body,home,localDay(epoch,timeZone).start),[a,b]=body==='moon'?['MR','MS']:['SR','SS'];
  return [`${home.code} ${a} ${rise?hhmm(rise,timeZone):'----'}`,`${b} ${set?hhmm(set,timeZone):'----'}`];
}
export function passText(body,home,epoch,timeZone){
  const pass=nextPass(body,home,epoch);
  if(!pass)return `${home.code} NO PASS`;
  if(pass.aos<=epoch)return `${home.code} IN VIEW LOS ${hhmm(pass.los,timeZone)}`;
  return `${home.code} AOS ${hhmm(pass.aos,timeZone)} ${Math.max(1,Math.round((pass.los-pass.aos)/MINUTE))}M ${Math.round(pass.peak)}°`;
}
// The calendar date where the watch is, and its day of the year.
const dateFormats=new Map();
export function localDate(epoch,timeZone){
  if(!dateFormats.has(timeZone))dateFormats.set(timeZone,new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'numeric',day:'numeric'}));
  const parts=Object.fromEntries(dateFormats.get(timeZone).formatToParts(new Date(epoch)).map(p=>[p.type,Number(p.value)]));
  return {year:parts.year,month:parts.month,day:parts.day,dayOfYear:Math.round((Date.UTC(parts.year,parts.month-1,parts.day)-Date.UTC(parts.year,0,0))/86400000)};
}


// Local midnight to the next local midnight (23 or 25 hours across a DST
// change), for the whole-day strip.
export function localDay(epoch,timeZone){
  // Subtracting the wall-clock time is off by an hour on a changeover day,
  // so step until the local clock really reads midnight.
  const wall=t=>{const p=clockParts(t,timeZone);return Number(p.h)*60+Number(p.m);};
  const off=t=>{const m=wall(t);return m>12*60?m-24*60:m;};
  const floor=t=>{let c=Math.floor(t/MINUTE)*MINUTE-wall(t)*MINUTE;for(let i=0;i<3&&off(c);i++)c-=off(c)*MINUTE;return c;};
  const start=floor(epoch);return {start,end:floor(start+26*3600000)};
}
