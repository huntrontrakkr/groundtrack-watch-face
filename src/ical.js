// Upcoming events from an iCalendar file (RFC 5545), as a calendar's private
// link serves it: each timed event's start and title within a window, with
// the repeating events' occurrences worked out. The phone reads it; nothing
// of the calendar goes anywhere but the watch.
//
// What is read: VEVENTs with a timed DTSTART (in UTC, in a named zone, or
// floating: the phone's zone); SUMMARY; RRULE with FREQ DAILY, WEEKLY (with
// BYDAY), MONTHLY (the same day of the month, or BYDAY's nth weekday) and
// YEARLY, INTERVAL, COUNT and UNTIL; EXDATE; a changed occurrence
// (RECURRENCE-ID) in place of the one it changes. What is left out:
// all-day events (they have no minute to stand at), cancelled ones, and
// rules beyond those (their first occurrence still counts).

const formats=new Map();
// A zone's wall clock at an instant, as if it were UTC (milliseconds).
function wall(t,zone){
  if(!formats.has(zone))formats.set(zone,new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'}));
  const p={};for(const part of formats.get(zone).formatToParts(new Date(t)))p[part.type]=Number(part.value);
  return Date.UTC(p.year,p.month-1,p.day,p.hour%24,p.minute,p.second);
}
// The instant a zone's wall clock reads w (a wall time as if UTC): twice
// corrected, so the hours around a clock change come out right.
function instant(w,zone){
  let t=w-(wall(w,zone)-w);
  t=w-(wall(t,zone)-t);
  return t;
}
function zoneKnown(zone){
  try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;}catch(error){return false;}
}
// A DATE-TIME value: {w: wall time as if UTC, utc: whether it is UTC}, or
// null for a DATE (an all-day value) or anything else.
function dateTime(value){
  const m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(String(value).trim());
  if(!m)return null;
  return {w:Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0)),utc:!!m[7]};
}
const DAYS={SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6},DAY=86400000;
function unescape(text){return String(text).replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1').replace(/\s+/g,' ').trim();}

// The file's events: [{uid, start {w, utc}, zone, title, rule, exdates
// [{w, utc, zone}], changes (a RECURRENCE-ID {w, utc, zone} or null)}].
function events(text,zone){
  const lines=String(text).replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'').split('\n'),out=[];let e=null;
  for(const line of lines){
    if(line==='BEGIN:VEVENT'){e={uid:'',start:null,zone,title:'',rule:null,exdates:[],changes:null,cancelled:false};continue;}
    if(line==='END:VEVENT'){if(e&&e.start&&!e.cancelled)out.push(e);e=null;continue;}
    if(!e)continue;
    const colon=line.indexOf(':');if(colon<0)continue;
    const head=line.slice(0,colon).split(';'),name=head[0].toUpperCase(),value=line.slice(colon+1),params={};
    for(const p of head.slice(1)){const eq=p.indexOf('=');if(eq>0)params[p.slice(0,eq).toUpperCase()]=p.slice(eq+1).replace(/^"|"$/g,'');}
    // (A zone the phone does not know, Outlook's own names say, is the phone's.)
    const z=params.TZID&&zoneKnown(params.TZID)?params.TZID:zone;
    if(name==='DTSTART'){e.start=dateTime(value);e.zone=z;}
    else if(name==='SUMMARY')e.title=unescape(value);
    else if(name==='UID')e.uid=value;
    else if(name==='STATUS')e.cancelled=value.trim().toUpperCase()==='CANCELLED';
    else if(name==='RRULE'){e.rule={};for(const part of value.split(';')){const eq=part.indexOf('=');if(eq>0)e.rule[part.slice(0,eq).toUpperCase()]=part.slice(eq+1);}}
    else if(name==='EXDATE')for(const v of value.split(',')){const d=dateTime(v);if(d)e.exdates.push({...d,zone:z});}
    else if(name==='RECURRENCE-ID'){const d=dateTime(value);if(d)e.changes={...d,zone:z};}
  }
  return out;
}
const at=(d,zone)=>d.utc?d.w:instant(d.w,zone);

// The wall times (as if UTC) of a repeating event's occurrences up to
// `until` (an instant), in its own zone's wall clock, so that a clock change
// leaves its hour where it was.
function* occurrences(e,until){
  const r=e.rule,start=e.start.w,interval=Math.max(1,parseInt(r.INTERVAL,10)||1),count=r.COUNT?parseInt(r.COUNT,10):Infinity;
  const last=r.UNTIL?(dateTime(r.UNTIL)?at(dateTime(r.UNTIL),'UTC'):Date.UTC(+r.UNTIL.slice(0,4),+r.UNTIL.slice(4,6)-1,+r.UNTIL.slice(6,8))+DAY-1):Infinity;
  const s=new Date(start),clock=start-Date.UTC(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate());
  const ok=w=>{const t=e.start.utc?w:instant(w,e.zone);return t<=last&&t<=until;};
  let n=0;
  const give=function*(w){if(w>=start&&n<count&&ok(w)){n++;yield w;}};
  const far=w=>n>=count||!ok(w);
  if(r.FREQ==='DAILY'){
    // (Unnumbered, the days before the window are stepped over.)
    for(let w=start,k=0;k<200000&&!far(w);k++,w+=interval*DAY)yield* give(w);
  }else if(r.FREQ==='WEEKLY'){
    const days=(r.BYDAY?r.BYDAY.split(',').map(d=>DAYS[d.slice(-2)]).filter(d=>d!==undefined):[s.getUTCDay()]).sort((a,b)=>a-b);
    // Weeks from the Monday of the first.
    const monday=Date.UTC(s.getUTCFullYear(),s.getUTCMonth(),s.getUTCDate())-((s.getUTCDay()+6)%7)*DAY;
    for(let week=monday,k=0;k<30000;k++,week+=interval*7*DAY){
      if(far(week+clock))break;
      for(const d of days.map(d=>(d+6)%7).sort((a,b)=>a-b))yield* give(week+d*DAY+clock);
    }
  }else if(r.FREQ==='MONTHLY'||r.FREQ==='YEARLY'){
    const months=r.FREQ==='YEARLY'?12*interval:interval,nth=r.FREQ==='MONTHLY'&&r.BYDAY?/^([+-]?\d)([A-Z]{2})$/.exec(r.BYDAY):null;
    const monthDay=r.FREQ==='MONTHLY'&&r.BYMONTHDAY?parseInt(r.BYMONTHDAY,10):s.getUTCDate();
    for(let k=0;k<5000;k++){
      const y=s.getUTCFullYear(),m=s.getUTCMonth()+k*months,first=Date.UTC(y,m,1),length=new Date(Date.UTC(y,m+1,0)).getUTCDate();
      if(far(first+clock))break;
      let day=monthDay;
      if(nth){
        const which=parseInt(nth[1],10),weekday=DAYS[nth[2]];
        if(weekday===undefined)continue;
        const firstDay=new Date(first).getUTCDay();
        day=which>0?1+((weekday-firstDay+7)%7)+7*(which-1):length-((new Date(Date.UTC(y,m,length)).getUTCDay()-weekday+7)%7)+7*(which+1);
      }
      // (A month without that day has no occurrence.)
      if(day<1||day>length)continue;
      yield* give(first+(day-1)*DAY+clock);
    }
  }else yield* give(start);
}

// The events starting from `from` to `to` (instants, milliseconds), each
// {epoch, title}, in order, at most `limit`. zone: the phone's time zone,
// for floating times.
export function calendarEvents(text,{from,to,zone='UTC',limit=40}){
  if(!/BEGIN:VCALENDAR/.test(String(text)))throw new Error('No calendar in the answer');
  const all=events(text,zone),found=[],seen=new Set();
  // The occurrences a changed one stands in for, by the series it belongs to.
  const changed=new Map();
  for(const e of all)if(e.changes){if(!changed.has(e.uid))changed.set(e.uid,new Set());changed.get(e.uid).add(at(e.changes,e.changes.zone));}
  const add=(epoch,e)=>{
    if(epoch<from||epoch>to)return;
    const title=(e.title||'Event').slice(0,40),key=epoch+'/'+title;
    if(!seen.has(key)){seen.add(key);found.push({epoch,title});}
  };
  for(const e of all){
    if(!e.rule||e.changes){add(at(e.start,e.zone),e);continue;}
    const skip=new Set(e.exdates.map(d=>at(d,d.zone)));
    for(const t of changed.get(e.uid)||[])skip.add(t);
    for(const w of occurrences(e,to)){const epoch=e.start.utc?w:instant(w,e.zone);if(!skip.has(epoch))add(epoch,e);}
  }
  return found.sort((a,b)=>a.epoch-b.epoch||(a.title<b.title?-1:1)).slice(0,limit);
}
