// Which settings a chart takes: the one account of it for the settings
// page, the phone and the tests (tests/settings.test.mjs holds it to what
// the watch's own code draws, by tools/audit-settings.mjs).
//
// A body has one of these charts on a face:
//   hour      the hour chart (Enroute: the Sun, the Moon, the slow
//             satellites; Fuller: a satellite's hour sheet)
//   day       the whole day (Enroute: the satellites that keep to one part
//             of the world, QZSS; Fuller: the Sun, the Moon, QZSS)
//   world     the world band with the hour's run (the Plotboard: the fast
//             satellites; and Enroute's too fast for its chart)
//   worldday  the world band with the whole day's run (the Plotboard: the
//             Sun, the Moon and the slow satellites)
// face: 'enroute' or 'plotboard' (Groundtrack's two), or 'fuller'.
// view: the body's own chart (satellites.js viewOf: 'hour', 'day', 'world',
// or 'still' for a satellite that stands over one place: its day is a map
// of where it stands, and its hour is nothing); plot: what the Plotboard
// shows of it (plotOf: 'hour' or 'day').
export function chartOf(face,body,view,span,plot){
  const sat=body.indexOf('sat:')===0;
  if(face==='fuller')return !sat||view==='still'||(view==='day'&&span!=='hour')?'day':'hour';
  if(face==='plotboard'||view==='world')return view!=='world'&&plot==='day'?'worldday':'world';
  return view==='still'||(view==='day'&&span!=='hour')?'day':'hour';
}
// The chart as the watch is told it (its view).
export const VIEW_CODES={hour:0,world:1,day:2,worldday:3};
// What the chart's settings are, given the others:
//   readout   the minute readouts offered (none on a day chart, whose time
//             callout is always drawn; on the world band the flag alone, and
//             only under a ruler, fixed or the route's: its panel carries
//             the time, and a callout chosen there is the flag)
//   numerals  whether the time figures' style shows (a callout, or the world
//             band's clock)
//   bare      whether the hour figures can be left off (the hour chart: the
//             route alone then, and the time in full beside the body, the
//             readout no longer a choice)
//   legend    a scale bar in a Fuller sheet's open space (Groundtrack Fuller)
//   tape      the world band's panel; transfer: its scale's minutes brought
//             down to the route (under the fixed ruler and the sliding
//             tapes: the route's own ruler needs none, the clock has no
//             scale; nor does a whole day's route, marked in hours, take any)
//   span      QZSS's choice of the day or the hour
//   light     the Moon's light in the corner (the Moon's charts only)
export function settingsFor(face,body,view,{span='day',readout='flag',tape='fixed',plot='hour',bare=false}={}){
  const chart=chartOf(face,body,view,span,plot),world=chart==='world'||chart==='worldday',alone=bare&&chart==='hour';
  const shown=alone?'callout':world&&readout==='callout'?'flag':readout;
  return {chart,
    readout:chart==='day'||alone||(world&&tape!=='fixed'&&tape!=='route')?[]:world?['off','flag']:['off','flag','callout'],
    readoutShown:shown,bare:chart==='hour',legend:face==='fuller',
    numerals:chart==='day'||(chart==='hour'&&shown==='callout')||(world&&tape==='clock'),
    tape:world,transfer:chart==='world'&&tape!=='clock'&&tape!=='route',
    span:view==='day'&&face!=='plotboard',light:body==='moon'};
}

// Groundtrack is two faces in one app: Enroute (the hour chart, and the
// whole day) and the Plotboard (the world band). Every body can be followed
// on the Plotboard; Enroute's chart cannot hold the hour of a fast one, so
// a body's own chart says which face it starts on, and a fast one chosen
// puts the Plotboard on whatever face was asked for. Groundtrack Fuller is
// one face.
export function faceOf(view){return view==='world'?'plotboard':'enroute';}
export function faceFor(asked,view){return view==='world'||(asked!=='enroute'&&asked!=='plotboard')?faceOf(view):asked;}
// Why a body is not on a face of Groundtrack ('' if it is on it), in words
// for the settings page. period: the minutes a body takes a lap (the Sun
// and Moon come round in about a day). A satellite chosen from elsewhere
// than the catalog is placed by the same rule.
export function lapOf(period){return period<180?Math.round(period)+' minutes':period<2880?Math.round(period/60)+' hours':Math.round(period/144)/10+' days';}
export function unsuited(face,view,period){
  return face==='enroute'&&view==='world'?'Too fast for Enroute: round the Earth in '+lapOf(period)+', more of the world in an hour than its chart can hold.':'';
}

// ---- Orbits. An orbit's pace where it is fastest, as the minutes a round
// orbit of that angular rate would take a lap: an oval orbit's low end
// (perigee), where a Molniya orbit of twelve hours passes like one of two.
// period: minutes a lap; ecc: the orbit's eccentricity (0 round).
export function swiftest(period,ecc){ecc=ecc||0;return period*(1-ecc)*(1-ecc)/Math.sqrt(1-ecc*ecc);}
// How an orbit is charted, by the minutes it takes a lap:
//   'world'  under six hours (the low orbits, and the medium ones up to
//            O3b's 8,000 km): in an hour it crosses more of the world than
//            a zoomed chart can hold (some 50 degrees: the watch's memory
//            sets that), so it gets the world band (the Plotboard);
//   'day'    within an hour and a half of a sidereal day, and nowhere fast:
//            it stays over one part of the world and takes the day to draw
//            its shape there;
//   'hour'   the rest (GPS's twelve hours): the ground moves under it at
//            about the Sun's pace, and its hour fits the zoomed chart. (An
//            oval orbit's fast hour does not: the watch draws that hour on
//            the world band instead.)
// Any satellite's elements give its period, so one chosen from elsewhere
// than the catalog is charted by the same rule.
export const SLOW=360;
export function chartFor(period,ecc){return period<SLOW?'world':Math.abs(period-1436)<90&&swiftest(period,ecc)>=SLOW?'day':'hour';}
// Whether a satellite stands still over the Earth (geostationary): a day
// to the lap, round, and along the equator (incl: the orbit's tilt in
// degrees).
export function standsStill(period,ecc,incl){return Math.abs(period-1436.1)<15&&(ecc||0)<0.02&&incl<2;}
// What the Plotboard shows of an orbit: 'hour' (the hour's run across the
// world: anything that somewhere goes round faster than a six-hour orbit
// would) or 'day' (the whole day's: the rest, which would hardly move in an
// hour). The watch's segments say the same: an hour long for the first, six
// hours for the second, which a day's chart needs (segments.js).
export function plotFor(period,ecc){return swiftest(period,ecc)<SLOW?'hour':'day';}
// A satellite's three characters on the watch, from its name: its letters
// and digits, capitals (the watch's lettering has no others).
export function codeFor(name){
  const c=String(name).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,3);
  return c||'SAT';
}
