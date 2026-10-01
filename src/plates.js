// The plates and the chart's fixed measures of Study 06, shared by the
// study page, the phone app and the tools (the watch reads them from
// tables.bin, made by tools/generate-native-data.mjs).
import {cos,acos} from './fmath.js';
import {RAD} from './geometry.js';

export const W=200,H=228;
const hex=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16));
const inks=list=>list.map(hex),SHELF_DEPTH=-200;
// Printing plates. Each ink has a day, dusk and night value; paper plates
// keep their day colors and take a dot screen through twilight and night.
export const PLATES={
  enroute:{name:'Enroute',note:'IFR chart: white paper, blue and black',night:'screen',
    water:inks(['#AAFFFF','#55AAAA','#0055AA']),land:inks(['#FFFFFF','#AAAAAA','#555555']),coast:inks(['#0055AA','#005555','#55AAFF']),
    contour:inks(['#AAAAAA','#555555','#AAAAAA']),shelf:inks(['#55AAFF','#0055AA','#55AAFF']),grid:inks(['#0055AA','#005555','#55AAFF']),
    route:inks(['#FF00AA','#AA0055','#FF55FF']),ink:inks(['#000055','#000055','#FFFFFF']),mark:inks(['#000000','#000000','#FFFFFF']),
    screen:hex('#0055AA'),space:hex('#FFFFFF'),spaceInk:hex('#000055')},
  sectional:{name:'Sectional',note:'VFR chart: cream paper, blue type',night:'screen',
    water:inks(['#AAFFFF','#55AAAA','#000055']),land:inks(['#FFFFAA','#AAAA55','#005555']),coast:inks(['#0055AA','#005555','#0055AA']),
    contour:inks(['#AAAA55','#555500','#0055AA']),shelf:inks(['#55AAFF','#0055AA','#0055AA']),grid:inks(['#0055AA','#005555','#0055AA']),
    route:inks(['#FF00AA','#AA0055','#FF55FF']),ink:inks(['#0055AA','#000055','#AAFFFF']),mark:inks(['#000055','#000055','#FFFFAA']),
    screen:hex('#000055'),space:hex('#FFFFFF'),spaceInk:hex('#0055AA')},
  console:{name:'Console',note:'Mission control: lit lines on dark glass',night:'zones',
    water:inks(['#000055','#000055','#000000']),land:inks(['#005555','#005555','#000055']),coast:inks(['#55AAAA','#55AAAA','#0055AA']),
    contour:inks(['#00AAAA','#00AAAA','#0055AA']),shelf:inks(['#0055AA','#0055AA','#000055']),grid:inks(['#0055AA','#0055AA','#0055AA']),
    route:inks(['#FFAA00','#FFAA00','#FFAA00']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFAA']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // After the jet navigation charts: layer tints by height, green lowland
  // through tan to brown, and the sea tinted deeper off the shelf.
  hypsometric:{name:'Hypsometric',note:'Jet navigation chart: layer tints by height',night:'screen',
    tints:[[300,hex('#AAFFAA')],[1000,hex('#FFFFAA')],[2000,hex('#FFAA55')],[3500,hex('#AA5500')],[Infinity,hex('#AA5555')]],depths:[[SHELF_DEPTH,hex('#AAFFFF')],[-Infinity,hex('#55AAFF')]],
    water:inks(['#AAFFFF','#AAFFFF','#AAFFFF']),land:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),coast:inks(['#0055AA','#0055AA','#0055AA']),
    contour:inks(['#555500','#555500','#555500']),shelf:inks(['#0055AA','#0055AA','#0055AA']),grid:inks(['#005555','#005555','#005555']),
    route:inks(['#FF00AA','#FF00AA','#FF00AA']),ink:inks(['#000055','#000055','#000055']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#000055'),space:hex('#FFFFFF'),spaceInk:hex('#000055')},
  // Red cockpit lighting, which keeps the eye's night vision: reds only,
  // drawn as outlines on black; coasts dim where it is night.
  red:{name:'Night red',note:'Cockpit red: every ink a red, nothing to dazzle',night:'zones',terminator:hex('#FF5555'),nightDots:hex('#AA0000'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#000000','#000000','#000000']),coast:inks(['#AA0000','#AA0000','#550000']),
    contour:inks(['#550000','#550000','#550000']),shelf:inks(['#550000','#550000','#550000']),grid:inks(['#550000','#550000','#550000']),
    route:inks(['#FF0000','#FF0000','#FF0000']),ink:inks(['#FF5555','#FF5555','#FF5555']),mark:inks(['#FFAAAA','#FFAAAA','#FFAAAA']),
    space:hex('#000000'),spaceInk:hex('#FF5555')},
  // The green phosphor of the consoles: one green at several brightnesses,
  // and night drawn with dark scan lines, dusk with every fourth line.
  crt:{name:'Green CRT',note:'Console phosphor: one green, night in scan lines',night:'zones',scan:true,terminator:hex('#55FF55'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#005500','#005500','#005500']),coast:inks(['#00AA00','#00AA00','#00AA00']),
    contour:inks(['#00AA00','#00AA00','#00AA00']),shelf:inks(['#005500','#005500','#005500']),grid:inks(['#005500','#005500','#005500']),
    route:inks(['#00FF00','#00FF00','#00FF00']),ink:inks(['#AAFFAA','#AAFFAA','#AAFFAA']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#55FF55')},
  // For bright sun: black on white only. A band of waterlines follows the
  // coast, as on one-color charts; contours are dotted and the route is
  // cased in white so it leads.
  sunlight:{name:'Sunlight',note:'One ink: black on white, water lined',night:'screen',mono:true,waterline:hex('#000000'),dots:true,
    water:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),land:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),coast:inks(['#000000','#000000','#000000']),
    contour:inks(['#000000','#000000','#000000']),shelf:inks(['#000000','#000000','#000000']),grid:inks(['#000000','#000000','#000000']),
    route:inks(['#000000','#000000','#000000']),ink:inks(['#000000','#000000','#000000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#000000'),space:hex('#FFFFFF'),spaceInk:hex('#000000')},
  // An engineer's blueprint: white linework on a mid blue, land a lighter
  // blue than the sea, the route in a yellow pencil; night deepens the blue.
  blueprint:{name:'Blueprint',note:'Engineering drawing: white line on blue',night:'zones',terminator:hex('#AAFFFF'),
    water:inks(['#0055AA','#0000AA','#000055']),land:inks(['#0055FF','#0055AA','#0000AA']),coast:inks(['#FFFFFF','#FFFFFF','#AAFFFF']),
    contour:inks(['#AAFFFF','#55AAFF','#55AAFF']),shelf:inks(['#55AAFF','#0055FF','#0055AA']),grid:inks(['#55AAFF','#0055FF','#0055AA']),
    route:inks(['#FFFF00','#FFFF00','#FFFF55']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000055'),spaceInk:hex('#FFFFFF')},
  // The amber of plasma and early flight displays: amber at a few
  // brightnesses on black; night dims every ink a step, dusk dithered
  // between, with the terminator drawn.
  amber:{name:'Amber',note:'Plasma display: amber on black, night dimmed',night:'zones',terminator:hex('#FFAA00'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#550000','#550000','#000000']),coast:inks(['#FFAA00','#AA5500','#AA5500']),
    contour:inks(['#AA5500','#550000','#550000']),shelf:inks(['#550000','#550000','#550000']),grid:inks(['#AA5500','#550000','#550000']),
    route:inks(['#FFFF55','#FFFF55','#FFAA00']),ink:inks(['#FFAA55','#FFAA55','#FFAA00']),mark:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),
    space:hex('#000000'),spaceInk:hex('#FFAA00')},
  // After the airbrushed shaded relief of the Apollo-era Lunar Astronautical
  // Charts: the land modelled by light from the northwest in sepia, dithered
  // like an airbrush, instead of by contours or layer tints; white sea.
  // Its tints are the light classes, deep shadow to full light (their
  // heights unused: the slope chooses).
  airbrush:{name:'Airbrush',note:'Apollo-era chart: relief shaded in light and shadow',night:'screen',shade:true,
    tints:[[300,hex('#555500')],[500,hex('#AAAA55')],[1000,hex('#FFFFAA')],[2000,hex('#FFFFFF')],[Infinity,hex('#FFFFFF')]],
    water:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),land:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),coast:inks(['#555500','#555500','#555500']),
    contour:inks(['#AAAA55','#AAAA55','#AAAA55']),shelf:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),grid:inks(['#AAAA55','#AAAA55','#AAAA55']),
    route:inks(['#AA0000','#AA0000','#AA0000']),ink:inks(['#550000','#550000','#550000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#555500'),space:hex('#FFFFFF'),spaceInk:hex('#550000')},
  // The world as points of light, as on a mission wall: a lattice of dots
  // whose size is the land's height and whose brightness falls with the
  // night; the sea a grid of faint points.
  dotmatrix:{name:'Dot matrix',note:'Mission wall: the world in points of light',night:'zones',lattice:true,
    tints:[[500,hex('#00AAAA')],[2000,hex('#55FFFF')],[Infinity,hex('#FFFFFF')]],
    water:inks(['#0000AA','#000055','#000055']),land:inks(['#55FFFF','#00AAAA','#005555']),coast:inks(['#00AAAA','#00AAAA','#005555']),
    contour:inks(['#00AAAA','#00AAAA','#005555']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#0000AA','#0000AA','#000055']),
    route:inks(['#FFAA00','#FFAA00','#FFAA00']),ink:inks(['#FFFFFF','#AAFFFF','#AAFFFF']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    space:hex('#000000'),spaceInk:hex('#55FFFF')}
};
// Contours in meters; the lowest is dotted, as an intermediate contour.
export const CONTOURS=[500,1000,2000,3000,4000,5000],SHELF=-200;
// Acquisition circle: ground range at which a 410 km orbit rises 5 degrees
// above a station's horizon (about 15.6 degrees of arc).
const EARTH=6371,ORBIT=410,MASK=5*RAD;
export const ACQUISITION=(acos(EARTH*cos(MASK)/(EARTH+ORBIT))-MASK)/RAD;
export const NUMERALS=['colon','plain','even','mono','accent'];
export const FIGURE={scale:40,hour:80,hourTwo:72,minute:28,callout:28,calloutMinute:20};
// The time scale registers with the route: its hour marks stand over the
// two stations, 120 px apart on the zoomed charts, so each minute is exactly
// two pixels and each graduation sits over its minute on the route. The ISS
// world band spans 180 px, three pixels a minute.
export const SPAN=120,SCALE={x0:10,x1:190,baseline:46,panel:67};
