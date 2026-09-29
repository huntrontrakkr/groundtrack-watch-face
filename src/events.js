// Events: moments the wearer has to be somewhere, set on the route as
// compulsory reporting points. On a watch they would come from the phone's
// timeline; the study keeps a few of its own.
import {localDay} from './enroute-render.js';
import {clockParts} from './render.js';
import {MINUTE} from './ephemeris.js';

// Each event is named on the chart as airspace names its waypoints: a
// five-letter name code, all capitals and pronounceable, so it can be read
// aloud (ICAO's 5LNC). The code is made from the event's own title; the
// title itself stays with the event for the page.
const VOWEL=/[AEIOUY]/,STOP=new Set(['A','AN','THE','OF','TO','WITH','W','AND','FOR','AT','IN','ON','MY']);
// Pronounceable: at least one vowel and never more than three consonants
// in a row.
export const pronounceable=code=>VOWEL.test(code)&&!/[^AEIOUY]{4}/.test(code);
// The last resort for titles with too few vowels: a fourth consonant in a
// row becomes an A, and a code with no vowel takes one second.
const repair=code=>{
  let run=0,out='';for(const c of code){run=VOWEL.test(c)?0:run+1;if(run===4){out+='A';run=0;}else out+=c;}
  return VOWEL.test(out)?out:out[0]+'A'+out.slice(2);
};
export const nameCode=title=>repair(baseCode(title));
function baseCode(title){
  const words=String(title).normalize('NFD').toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/).filter(Boolean);
  const kept=words.filter(w=>!STOP.has(w)),use=kept.length?kept:words;
  if(!use.length)return 'EVENT';
  // A long first word stands alone; short words are run together.
  let word=use[0];for(let i=1;i<use.length&&word.length<5;i++)word+=use[i];
  if(word.length<5)return (word+word.at(-1).repeat(5)).slice(0,5);
  if(word.length===5&&pronounceable(word))return word;
  // Drop vowels from the end, keeping the first letter, as the name codes
  // do (DINNER, DINNR); failing that, the word's first five letters.
  let short=word;
  for(let i=short.length-1;i>0&&short.length>5;i--)if(VOWEL.test(short[i])&&short[i]!=='Y')short=short.slice(0,i)+short.slice(i+1);
  if(short.length>5)short=short.slice(0,5);
  if(pronounceable(short))return short;
  const head=word.slice(0,5);if(pronounceable(head))return head;
  return head.replace(/^(.)(.)/,(_,a,b)=>VOWEL.test(a)?a+b:a+'A');
}
// Codes are unique on a chart, as they are worldwide: a repeat changes its
// last letter.
export function uniqueCode(title,taken){
  const base=nameCode(title);if(!taken.includes(base))return base;
  for(const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){const code=base.slice(0,4)+c;if(!taken.includes(code)&&pronounceable(code))return code;}
  return base;
}
const study=(t,title)=>({epoch:Date.parse(t),title,label:nameCode(title)});
// One in each frozen study hour, and one later on the Sun's day.
export const STUDY_EVENTS=[
  study('2026-09-27T08:45:00Z','Run'),study('2026-09-15T12:50:00Z','Standup'),study('2026-09-19T09:50:00Z','Run'),
  study('2019-06-05T12:40:00Z','Standup'),study('2026-09-27T17:40:00Z','Dinner')
];
// A local wall-clock time on the local day that holds epoch, in timeZone.
export function atLocal(epoch,timeZone,h,m){
  const wall=t=>{const q=clockParts(t,timeZone);return Number(q.h)*60+Number(q.m);};
  let t=localDay(epoch,timeZone).start+(h*60+m)*MINUTE;
  return t+(h*60+m-wall(t))*MINUTE;
}
