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
    space:hex('#000000'),spaceInk:hex('#55FFFF')},
  // 2001: A Space Odyssey. The opening alignment: a dark Earth with the
  // dawn blazing along its rim (twilight drawn as the brightest ground,
  // day dim, night black); Discovery's displays, white line on black
  // glass; and the Sun as HAL 9000's eye.
  odyssey:{name:'Odyssey',note:'2001: dawn on a dark Earth, the Sun as HAL',night:'zones',hal:true,terminator:hex('#FFFFAA'),
    water:inks(['#000000','#AA5500','#000000']),land:inks(['#555555','#FFAA00','#000000']),coast:inks(['#AAAAAA','#FFFFAA','#555555']),
    contour:inks(['#AAAAAA','#FFFF55','#0000AA']),shelf:inks(['#000055','#AA5500','#000000']),grid:inks(['#555555','#AA5500','#555555']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#FFFFFF','#FFFFFF','#AAAAAA']),mark:inks(['#FF0000','#FF0000','#FF0000']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // Space-age studies, inspired by GSOC's 1970 tracking board, Soviet
  // survey sheets and European mission control. Interpretations, not replicas.
  // A wash mixes three pixels of a second ink with one of the ground ink;
  // the minute renderer makes it, without adding runs to the chart.
  trackingboard:{name:'Tracking Board',note:'GSOC, 1970: rust land, blue-gray sea, red counters',night:'zones',terminator:hex('#FFFFAA'),wash:[hex('#AAAAAA'),null],
    water:inks(['#55AAAA','#555555','#000055']),land:inks(['#AA5500','#AA5500','#550000']),coast:inks(['#FFAA55','#AA5500','#AA5500']),
    contour:inks(['#AA5500','#AA5500','#550000']),shelf:inks(['#AAAAAA','#555555','#000055']),grid:inks(['#AAAAAA','#AAAAAA','#555555']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#FF5555','#FF5555','#FF5555']),
    space:hex('#000000'),spaceInk:hex('#FF5555')},
  survey:{name:'Survey Sheet',note:'Soviet survey chart, 1980s: pale paper and purple tracking ink',night:'screen',dots:true,wash:[hex('#FFFFFF'),hex('#FFFFFF')],
    water:inks(['#AAFFFF','#AAFFFF','#AAFFFF']),land:inks(['#AAFFAA','#AAFFAA','#AAFFAA']),coast:inks(['#0055AA','#0055AA','#0055AA']),
    contour:inks(['#AA5500','#AA5500','#AA5500']),shelf:inks(['#55AAAA','#55AAAA','#55AAAA']),grid:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),
    route:inks(['#550055','#550055','#550055']),ink:inks(['#000000','#000000','#000000']),mark:inks(['#AA0000','#AA0000','#AA0000']),
    screen:hex('#AAAAAA'),space:hex('#FFFFFF'),spaceInk:hex('#000000')},
  operations:{name:'Operations',note:'European mission control: cyan geography, amber counters',night:'zones',terminator:hex('#55AAAA'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#000055','#000055','#000000']),coast:inks(['#55FFFF','#55AAAA','#005555']),
    contour:inks(['#005555','#005555','#005555']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#005555','#005555','#005555']),
    route:inks(['#FFFF55','#FFFF55','#FFFF55']),ink:inks(['#AAFFFF','#AAFFFF','#AAFFFF']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#FFAA55')},
  // Space studies, after real imagery and the quieter end of film design;
  // interpretations, not replicas.
  // The Earth as photographed from orbit at night: by day a dim blue sea
  // and teal land, at night both black with the coasts lit sodium gold, the
  // limb of the dawn a thin blue line.
  nightside:{name:'Night Side',note:'From orbit at night: dark Earth, coastlines lit gold',night:'zones',terminator:hex('#55AAFF'),
    water:inks(['#000055','#000055','#000000']),land:inks(['#005555','#000055','#000000']),coast:inks(['#55AAAA','#FFAA55','#FFAA00']),
    contour:inks(['#0055AA','#000055','#000055']),shelf:inks(['#0000AA','#000055','#000000']),grid:inks(['#0055AA','#000055','#000055']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFAA']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // The enhancement tables forecasters lay over infrared weather-satellite
  // images: the land in a thermal ramp by height, violet lowland to pale
  // yellow peaks, on a black sea; map lines in the imagery's cyan; night
  // dims the ramp through a dark screen.
  infrared:{name:'Infrared',note:'Weather-satellite infrared: a thermal ramp on a black sea',night:'screen',
    tints:[[300,hex('#550055')],[1000,hex('#AA0055')],[2000,hex('#FF5500')],[3500,hex('#FFAA00')],[Infinity,hex('#FFFFAA')]],depths:[[SHELF_DEPTH,hex('#000055')],[-Infinity,hex('#000000')]],
    water:inks(['#000000','#000000','#000000']),land:inks(['#550055','#550055','#550055']),coast:inks(['#55AAAA','#55AAAA','#55AAAA']),
    contour:inks(['#000000','#000000','#000000']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#005555','#005555','#005555']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#55FFFF','#55FFFF','#55FFFF']),
    screen:hex('#000000'),space:hex('#000000'),spaceInk:hex('#55AAAA')},
  // The airbrushed charts of the Moon and Mars from the Apollo and Viking
  // years (USGS), drawn over the Earth: the land modelled in ochre and
  // salmon by light from the northwest, the sea plain paper, a blue route.
  planetary:{name:'Planetary',note:'USGS Mars and Moon charts: airbrushed ochre relief',night:'screen',shade:true,
    tints:[[300,hex('#550000')],[500,hex('#AA5500')],[1000,hex('#FFAA55')],[2000,hex('#FFFFAA')],[Infinity,hex('#FFFFAA')]],
    water:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),land:inks(['#FFAA55','#FFAA55','#FFAA55']),coast:inks(['#AA5500','#AA5500','#AA5500']),
    contour:inks(['#FFAA55','#FFAA55','#FFAA55']),shelf:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),grid:inks(['#AA5500','#AA5500','#AA5500']),
    route:inks(['#0055AA','#0055AA','#0055AA']),ink:inks(['#550000','#550000','#550000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#550000'),space:hex('#FFFFFF'),spaceInk:hex('#550000')},
  // A vector display: no fills at all, the world as line work on black, the
  // coast in one pale blue-white beam that dims at night.
  vector:{name:'Vector',note:'Vector display: the world in line work alone',night:'zones',terminator:hex('#0055AA'),
    water:inks(['#000000','#000000','#000000']),land:inks(['#000000','#000000','#000000']),coast:inks(['#AAFFFF','#55AAAA','#0055AA']),
    contour:inks(['#0055AA','#005555','#000055']),shelf:inks(['#000055','#000055','#000000']),grid:inks(['#005555','#005555','#000055']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#AAFFFF','#AAFFFF','#55AAAA']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#AAFFFF')},
  // Spare grey instruments: charcoal land on black, everything in greys,
  // the route the one white thing; night takes the land away.
  graphite:{name:'Graphite',note:'Spare grey instruments: the route the one white line',night:'zones',
    water:inks(['#000000','#000000','#000000']),land:inks(['#555555','#555555','#000000']),coast:inks(['#AAAAAA','#AAAAAA','#555555']),
    contour:inks(['#000000','#000000','#555555']),shelf:inks(['#555555','#555555','#000000']),grid:inks(['#555555','#555555','#555555']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#AAAAAA')},
  // The engraved star atlases navigators used: deep navy paper, cream
  // coastlines, stippled contours, a pale gold route; night deepens the navy.
  staratlas:{name:'Star Atlas',note:'Engraved star atlas: navy paper, cream line, gold route',night:'zones',dots:true,
    water:inks(['#000000','#000000','#000000']),land:inks(['#000055','#000055','#000000']),coast:inks(['#FFFFAA','#FFFFAA','#AAAA55']),
    contour:inks(['#AAAA55','#555555','#555555']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#AAAA55','#555555','#555555']),
    route:inks(['#FFAA55','#FFAA55','#FFAA55']),ink:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000055'),spaceInk:hex('#FFFFAA')},
  // The airbrushed relief by moonlight: the land modelled in silver and
  // slate from the northwest on a black sea, a lamp-amber route.
  moonlit:{name:'Moonlit',note:'Shaded relief by moonlight: silver and slate on black',night:'screen',shade:true,
    tints:[[300,hex('#000000')],[500,hex('#000055')],[1000,hex('#555555')],[2000,hex('#AAAAAA')],[Infinity,hex('#AAAAAA')]],
    water:inks(['#000000','#000000','#000000']),land:inks(['#555555','#555555','#555555']),coast:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),
    contour:inks(['#555555','#555555','#555555']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#555555','#555555','#555555']),
    route:inks(['#FFAA55','#FFAA55','#FFAA55']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#FFFF55','#FFFF55','#FFFF55']),
    screen:hex('#000000'),space:hex('#000000'),spaceInk:hex('#AAAAAA')},
  // A fleet's tactical chart: khaki ground on a gunmetal sea, black line
  // work, the line of advance in red.
  rodgeryoung:{name:'Rodger Young',note:'Fleet tactical chart: khaki ground, gunmetal sea, a red line',night:'zones',terminator:hex('#FFFFFF'),
    water:inks(['#555555','#555555','#000000']),land:inks(['#AAAA55','#555500','#555500']),coast:inks(['#000000','#000000','#AAAA55']),
    contour:inks(['#555500','#000000','#000000']),shelf:inks(['#000000','#000000','#555555']),grid:inks(['#000000','#000000','#555555']),
    route:inks(['#FF0000','#FF0000','#FF0000']),ink:inks(['#000000','#000000','#FFFFFF']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // From real navigation and observation displays, and one engraver's art.
  // A pattern draws each height band (or light band, with shade) as a 4x4
  // pattern of its ink over the land's: 'dots' by density, 'hatch' as line
  // hatching, 'raster' as rows, 'mesh' as a grid.
  // The ground-proximity terrain display of airliners (Honeywell EGPWS):
  // terrain in dot densities of green, yellow and red on black, the route
  // in the navigation display's magenta.
  // (The lowlands black, as terrain far below the aircraft is.)
  terrain:{name:'Terrain',note:'Ground-proximity display: green, yellow, red by dot density',night:'zones',terminator:hex('#555555'),pattern:'dots',
    tints:[[300,hex('#000000')],[1000,hex('#00AA00')],[2000,hex('#FFFF00')],[3500,hex('#FFFF00')],[Infinity,hex('#FF0000')]],
    water:inks(['#000000','#000000','#000000']),land:inks(['#000000','#000000','#000000']),coast:inks(['#00AAAA','#00AAAA','#005555']),
    contour:inks(['#000000','#000000','#000000']),shelf:inks(['#000055','#000055','#000055']),grid:inks(['#005555','#005555','#005555']),
    route:inks(['#FF00FF','#FF00FF','#FF00FF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#55FFFF','#55FFFF','#55FFFF']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // A thermal imager in white-hot polarity: the land the warm grey by day,
  // darker on the cold heights; by night the sea, holding its heat, brighter
  // than the land.
  whitehot:{name:'White Hot',note:'Thermal imager: warm land by day, warmer sea by night',night:'zones',pattern:'dots',
    tints:[[300,hex('#555555')],[1000,hex('#555555')],[2000,hex('#000000')],[3500,hex('#000000')],[Infinity,hex('#000000')]],
    water:inks(['#555555','#555555','#AAAAAA']),land:inks(['#AAAAAA','#555555','#555555']),coast:inks(['#555555','#AAAAAA','#AAAAAA']),
    contour:inks(['#555555','#555555','#000000']),shelf:inks(['#555555','#555555','#AAAAAA']),grid:inks(['#000000','#000000','#000000']),
    route:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    space:hex('#000000'),spaceInk:hex('#FFFFFF')},
  // The night-attack head-up displays of the F-15E and F-16 (LANTIRN):
  // infrared video drawn as green raster, brighter and denser with height,
  // and the symbology stroked over it.
  raster:{name:'Raster',note:'Night-attack HUD: green raster video, stroked symbology',night:'zones',terminator:hex('#005500'),pattern:'raster',
    tints:[[300,hex('#005500')],[1000,hex('#00AA00')],[2000,hex('#00AA00')],[3500,hex('#55FF55')],[Infinity,hex('#AAFFAA')]],
    water:inks(['#000000','#000000','#000000']),land:inks(['#000000','#000000','#000000']),coast:inks(['#00AA00','#00AA00','#005500']),
    contour:inks(['#000000','#000000','#000000']),shelf:inks(['#000000','#000000','#000000']),grid:inks(['#005500','#005500','#005500']),
    route:inks(['#55FF55','#55FF55','#55FF55']),ink:inks(['#55FF55','#55FF55','#55FF55']),mark:inks(['#AAFFAA','#AAFFAA','#AAFFAA']),
    space:hex('#000000'),spaceInk:hex('#55FF55')},
  // The synthetic vision of business-jet cockpits: terrain in earth tones
  // on a grid mesh, the sea blue, the flight path magenta, and the panel the
  // sky.
  synthetic:{name:'Synthetic Vision',note:'Cockpit synthetic vision: terrain on a mesh, sky above',night:'screen',pattern:'mesh',
    tints:[[300,hex('#55AA55')],[1000,hex('#AAAA55')],[2000,hex('#AA5500')],[3500,hex('#AA5555')],[Infinity,hex('#FFFFFF')]],
    water:inks(['#0055AA','#0055AA','#0055AA']),land:inks(['#555500','#555500','#555500']),coast:inks(['#55AAFF','#55AAFF','#55AAFF']),
    contour:inks(['#555500','#555500','#555500']),shelf:inks(['#0055AA','#0055AA','#0055AA']),grid:inks(['#55AAFF','#55AAFF','#55AAFF']),
    route:inks(['#FF00FF','#FF00FF','#FF00FF']),ink:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),mark:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),
    screen:hex('#000055'),space:hex('#0055AA'),spaceInk:hex('#FFFFFF')},
  // A ship's electronic chart (IHO S-52): buff land, white deep water, the
  // safety contour bold; and its own dusk and night colour tables, dimmed
  // to keep the bridge's night vision.
  bridge:{name:'Bridge',note:'Ship\'s electronic chart: its day, dusk and night tables',night:'zones',
    water:inks(['#FFFFFF','#000055','#000000']),land:inks(['#AAAA55','#555500','#000000']),coast:inks(['#555555','#AAAAAA','#555555']),
    contour:inks(['#AAAA55','#555500','#000000']),shelf:inks(['#0055AA','#0055AA','#000055']),grid:inks(['#AAAAAA','#555555','#000055']),
    route:inks(['#FF5500','#FF5500','#AA5500']),ink:inks(['#000000','#AAAAAA','#555555']),mark:inks(['#AA0000','#FF5555','#AA0000']),
    space:hex('#FFFFFF'),spaceInk:hex('#000000')},
  // The painted globe of the Vostok and Soyuz navigation instrument (the
  // Globus), turning under its crosshair: muted sea, sand land, a red
  // track, and the panel its grey faceplate.
  globus:{name:'Globus',note:'Soyuz navigation globe: a painted Earth, a grey faceplate',night:'screen',
    water:inks(['#55AAAA','#55AAAA','#55AAAA']),land:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),coast:inks(['#555500','#555500','#555500']),
    contour:inks(['#AAAA55','#AAAA55','#AAAA55']),shelf:inks(['#55AAAA','#55AAAA','#55AAAA']),grid:inks(['#555555','#555555','#555555']),
    route:inks(['#AA0000','#AA0000','#AA0000']),ink:inks(['#000000','#000000','#000000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#005555'),space:hex('#555555'),spaceInk:hex('#FFFFFF')},
  // A copperplate engraving: the relief hatched by light from the
  // northwest, densest in shadow, the coasts waterlined, a red route.
  engraved:{name:'Engraved',note:'Copperplate engraving: relief hatched by light, coasts waterlined',night:'screen',shade:true,pattern:'hatch',waterline:hex('#555555'),
    tints:[[300,hex('#550000')],[500,hex('#AA5500')],[1000,hex('#AA5500')],[2000,hex('#AA5500')],[Infinity,hex('#AA5500')]],
    water:inks(['#FFFFFF','#FFFFFF','#FFFFFF']),land:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),coast:inks(['#000000','#000000','#000000']),
    contour:inks(['#FFFFAA','#FFFFAA','#FFFFAA']),shelf:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),grid:inks(['#AAAAAA','#AAAAAA','#AAAAAA']),
    route:inks(['#AA0000','#AA0000','#AA0000']),ink:inks(['#000000','#000000','#000000']),mark:inks(['#000000','#000000','#000000']),
    screen:hex('#555555'),space:hex('#FFFFFF'),spaceInk:hex('#000000')}
};
// The order the plates are offered in, like with like: paper charts,
// shaded relief, blue line drawings, tracking boards, mission control's
// glass and the cockpit's, single-ink displays, the Earth from space. (PLATES' own order is
// their number on the watch, and only grows.)
export const PLATE_ORDER=['enroute','sectional','hypsometric','survey','bridge','globus','sunlight','engraved','airbrush','planetary','moonlit','blueprint','staratlas',
  'trackingboard','rodgeryoung','console','operations','dotmatrix','synthetic','terrain','crt','raster','amber','red','vector','nightside','infrared','whitehot','graphite','odyssey'];
// Contours in meters; the lowest is dotted, as an intermediate contour.
export const CONTOURS=[500,1000,2000,3000,4000,5000],SHELF=-200;
// Acquisition circle: ground range at which a 410 km orbit rises 5 degrees
// above a station's horizon (about 15.6 degrees of arc).
const EARTH=6371,ORBIT=410,MASK=5*RAD;
export const ACQUISITION=(acos(EARTH*cos(MASK)/(EARTH+ORBIT))-MASK)/RAD;
export const NUMERALS=['colon','plain','even','mono','accent'];
// The figure sets for the hour figures, the callout and the tape, in
// figures.bin's order (tools/generate-figures.py): key, name, note.
// Michroma is the default.
export const FIGURE_SETS=[
  ['jost','Jost','Futura revival: the Apollo 11 plaque'],
  ['b612','B612','Airbus cockpit displays'],
  ['michroma','Michroma','Eurostile: 2001 and NASA hardware'],
  ['orbitron','Orbitron','Space-age geometric']
];
export const FIGURE={scale:40,hour:80,hourTwo:72,minute:28,callout:28,calloutMinute:20};
// The time scale registers with the route: its hour marks stand over the
// two stations, 120 px apart on the zoomed charts, so each minute is exactly
// two pixels and each graduation sits over its minute on the route. The ISS
// world band spans 180 px, three pixels a minute.
export const SPAN=120,SCALE={x0:10,x1:190,baseline:46,panel:67};
