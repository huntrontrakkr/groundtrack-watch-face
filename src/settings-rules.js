// Which settings a chart takes: the one account of it for the settings
// page, the phone and the tests (tests/settings.test.mjs holds it to what
// the watch's own code draws, by tools/audit-settings.mjs).
//
// A body has one of three charts on a face:
//   hour   the hour chart (Groundtrack: the Sun, the Moon, GPS, and QZSS's
//          hour; Fuller: a satellite's hour sheet)
//   day    the whole day (Groundtrack: QZSS; Fuller: the Sun, the Moon, QZSS)
//   world  the world band (Groundtrack: the fast satellites)
// view: the body's own (satellites.js viewOf: 'hour', 'day' or 'world').
export function chartOf(face,body,view,span){
  const sat=body.indexOf('sat:')===0;
  if(face==='fuller')return !sat||(view==='day'&&span!=='hour')?'day':'hour';
  return view==='world'?'world':view==='day'&&span!=='hour'?'day':'hour';
}
// What the chart's settings are, given the others:
//   readout   the minute readouts offered (none on a day chart, whose time
//             callout is always drawn; on the world band the flag alone, and
//             only under the fixed ruler: its panel carries the time, and a
//             callout chosen there is the flag)
//   numerals  whether the time figures' style shows (a callout, or the world
//             band's clock)
//   tape      the world band's time scale; transfer: its ruler's minutes
//             brought down to the route
//   span      QZSS's choice of the day or the hour
//   light     the Moon's light in the corner (the Moon's charts only)
export function settingsFor(face,body,view,{span='day',readout='flag',tape='fixed'}={}){
  const chart=chartOf(face,body,view,span),world=chart==='world';
  const shown=world&&readout==='callout'?'flag':readout;
  return {chart,
    readout:chart==='day'||(world&&tape!=='fixed')?[]:world?['off','flag']:['off','flag','callout'],
    readoutShown:shown,
    numerals:chart==='day'||(chart==='hour'&&readout==='callout')||(world&&tape==='clock'),
    tape:world,transfer:world&&tape==='fixed',
    span:view==='day',light:body==='moon'};
}

// Groundtrack is two faces in one app, and a body's chart says which it is
// on: Enroute (the hour chart, and the whole day) or the Plotboard (the
// world band). Groundtrack Fuller is one face.
export function faceOf(view){return view==='world'?'plotboard':'enroute';}
// Why a body is not on a face of Groundtrack ('' if it is on it), in words
// for the settings page: the lap it takes, and of the bodies together why
// that does not suit the face. period: the minutes a body takes a lap (the
// Sun and Moon come round in about a day). A satellite chosen from
// elsewhere than the catalog is placed by the same rule.
export function lapOf(period){return period<180?Math.round(period)+' minutes':Math.round(period/60)+' hours';}
export function unsuited(face,view,period){
  if(faceOf(view)===face)return '';
  return face==='enroute'?'Round the Earth in '+lapOf(period):'Comes round in '+lapOf(period);
}
export const UNSUITED={
  enroute:'Too fast for Enroute: these cross more of the world in an hour than its chart can hold. They are on the Plotboard.',
  plotboard:'Too slow for the Plotboard: these would hardly move across the world in an hour. They are on Enroute.'};
