// Live satellites. General-perturbations element sets (TLEs) are fetched
// from CelesTrak by the page (or, on a watch, by the phone), checked, and
// registered here; positions come from SGP4 via Satellite.js. An element set
// is only used within FRESH of its own epoch: older elements are refused
// rather than shown as a current position.
import {twoline2satrec,propagate,gstime,eciToGeodetic} from 'satellite.js';
import {direction,RAD} from './geometry.js';
import {chartFor,plotFor,swiftest,standsStill,SLOW,codeFor} from './settings-rules.js';

export const FRESH=3*24*3600000;
// How long an element set serves from its epoch: three days in a low orbit,
// where drag soon tells; thirty in a high one (GPS, QZSS: under three
// revolutions a day), whose newest sets at CelesTrak are often days old and
// now and then a fortnight (the watch marks them EL OLD after a fortnight);
// a nominal orbit (no satellite's measured one) at any time.
export const freshFor=e=>e.source==='nominal'?Infinity:e.satrec&&e.satrec.no*1440/(2*Math.PI)<3?30*24*3600000:FRESH;
// Worth following, in groups as the settings page lists them. Ids are NORAD
// catalog numbers; period: minutes a lap, and ecc: how oval the orbit is
// (left out of a round one), which together decide the charts (chartFor,
// plotFor); code: three characters, the satellite's name on the watch.
// (Each checked against CelesTrak's catalog and current elements, 2 October
// 2026.)
export const GROUPS=[['stations','Space stations'],['starlink','Starlink'],['constellations','Other constellations'],['navigation','Navigation'],
  ['weather','Weather'],['earth','Earth observation'],['science','Science and telescopes'],['curios','Old, odd and far']];
const station=(norad,code,period,name,note)=>({norad,code,period,name,symbol:'station',group:'stations',note});
const sat=(group,norad,code,period,name,note,ecc=0)=>({norad,code,period,name,symbol:'satellite',group,note,...(ecc?{ecc}:{})});
// (One that stands still over the equator: geostationary.)
const still=entry=>({...entry,still:true});
export const CATALOG=[
  station(25544,'ISS',92.9,'International Space Station','Crewed since 2000. 51.6° orbit, about 92 minutes a lap.'),
  station(48274,'CSS',92.2,'Tiangong','China’s space station. 41.5° orbit, about 92 minutes.'),

  sat('starlink',44714,'SL1',92.0,'Starlink v1.0 (1008)','From the first operational launch, November 2019. 53° shell.'),
  sat('starlink',51462,'SL5',94.0,'Starlink v1.5 (3166)','With laser links between satellites, launched 2022. 53.2° shell.'),
  sat('starlink',49132,'SLP',96.1,'Starlink v1.5 polar (3090)','The 70° shell that serves the high latitudes, launched 2021.'),
  sat('starlink',56287,'SL2',94.3,'Starlink V2 Mini (30107)','The larger second generation, from 2023. 43° shell.'),
  sat('starlink',58705,'DTC',91.7,'Starlink Direct to Cell (11072)','A cell tower in orbit, flying low at 360 km.'),
  sat('starlink',67305,'SLN',94.3,'Starlink, 2026 (36490)','Among the newest, launched January 2026.'),

  sat('constellations',44057,'OWB',109.4,'OneWeb 0012','Broadband from 1,200 km, in a near-polar orbit.'),
  sat('constellations',41917,'IRD',100.4,'Iridium 106','Satellite phones: 66 of these in six polar planes.'),
  sat('constellations',63724,'KPR',97.3,'Kuiper 00008','Amazon’s broadband constellation, from its first full launch in 2025.'),
  sat('constellations',60379,'QFN',106.6,'Qianfan 1','China’s “Thousand Sails” broadband constellation. Polar, 1,070 km.'),
  sat('constellations',31573,'GLB',117.7,'Globalstar M069','Satellite phones and trackers, from 1,400 km.'),
  sat('constellations',54755,'O3B',287.9,'O3b mPOWER F1','Broadband from 8,000 km over the equator: a lap in under five hours, always eastward.'),
  sat('constellations',53807,'BW3',93.5,'BlueWalker 3','A 64 m² phased-array antenna, among the brightest things in the night sky.'),

  // Slow orbits: the ground moves under them little faster than under the
  // Sun, so they get the chart instead of the world band.
  sat('navigation',36585,'GPS',717.9,'GPS BIIF-1 (PRN 25)','Navigation satellite in a 12-hour orbit at 20,200 km, tilted 55°: it crosses the ground at about the Sun’s pace but swings far north and south.'),
  sat('navigation',55268,'GP3',718.0,'GPS III SV06','One of the newest GPS satellites, launched 2023.'),
  sat('navigation',57517,'GLO',675.7,'GLONASS-K2 (Cosmos 2569)','Russia’s navigation system: 19,100 km, tilted 65° to serve the far north.'),
  sat('navigation',37846,'GAL',844.7,'Galileo PFM (GSAT0101)','Europe’s navigation system: a 14-hour orbit at 23,200 km.'),
  sat('navigation',43001,'BDS',773.2,'BeiDou-3 M1','China’s navigation system, the medium-orbit part: 21,500 km.'),
  sat('navigation',36828,'BDI',1435.9,'BeiDou IGSO-1','A 24-hour orbit tilted 54°: a tall figure-8 over Asia once a day.'),
  sat('navigation',42738,'QZS',1436.1,'QZS-2 (Michibiki)','Japan’s quasi-zenith navigation satellite: a tilted, slightly oval 24-hour orbit that traces a figure-8 over Japan and Australia once a day.'),
  sat('navigation',39635,'NVC',1436.0,'NavIC (IRNSS-1B)','India’s regional navigation system: a 24-hour figure-8 over the Indian Ocean.'),

  sat('weather',43013,'N20',101.4,'NOAA-20','Polar weather satellite in the “afternoon” orbit, crossing near 13:30 local time.'),
  sat('weather',54234,'N21',101.4,'NOAA-21','NOAA-20’s newer twin, half an orbit apart from it.'),
  sat('weather',37849,'NPP',101.4,'Suomi NPP','The first of the current American polar weather satellites, 2011.'),
  sat('weather',43689,'MTC',101.3,'MetOp-C','Europe’s polar weather satellite, in the “morning” orbit near 09:30.'),
  sat('weather',57166,'MM2',101.1,'Meteor-M2 3','Russia’s polar weather satellite. Its pictures can be received by amateurs.'),
  sat('weather',43010,'FY3',101.4,'Fengyun 3D','China’s polar weather satellite.'),
  still(sat('weather',60133,'G19',1436.1,'GOES-19 (GOES East)','Geostationary over 75° W: it watches the Americas and the Atlantic and stays put.')),
  still(sat('weather',51850,'G18',1436.1,'GOES-18 (GOES West)','Geostationary over 137° W: the Pacific and the American west.')),
  still(sat('weather',41836,'HM9',1436.1,'Himawari-9','Geostationary over 141° E: Japan, east Asia and Australia.')),
  still(sat('weather',54743,'M12',1436.1,'Meteosat-12','Geostationary over the Gulf of Guinea: Europe and Africa.')),

  sat('earth',49260,'LS9',98.9,'Landsat 9','Sun-synchronous: crosses the equator southbound near 10:00 local time on every pass.'),
  sat('earth',39084,'LS8',98.8,'Landsat 8','Landsat 9’s twin, eight days apart: together they picture all land every eight days.'),
  sat('earth',39634,'S1A',98.6,'Sentinel-1A','Europe’s radar satellite: it sees through cloud and at night.'),
  sat('earth',40697,'S2A',100.6,'Sentinel-2A','Europe’s camera for land and coasts, 10 m to the pixel.'),
  sat('earth',41335,'S3A',100.9,'Sentinel-3A','Ocean colour, sea and land temperature, sea level.'),
  sat('earth',46984,'S6A',112.4,'Sentinel-6 Michael Freilich','Measures sea level to the centimetre from 1,336 km.'),
  sat('earth',27424,'AQU',98.5,'Aqua','NASA, since 2002: water in all its forms, crossing near 13:30.'),
  sat('earth',54754,'SWT',102.8,'SWOT','Surveys the height of oceans, lakes and rivers.'),
  sat('earth',58928,'PAC',98.3,'PACE','Plankton, aerosols and clouds: the colour of the ocean.'),
  sat('earth',43613,'IS2',94.2,'ICESat-2','A laser altimeter over the ice sheets, in a 92° orbit.'),
  sat('earth',43476,'GFO',93.5,'GRACE-FO 1','One of a pair that weigh the Earth’s water by the distance between them.'),
  sat('earth',65053,'NSR',99.8,'NISAR','The American and Indian radar satellite, launched 2025.'),
  sat('earth',59908,'ECR',92.5,'EarthCARE','Clouds and aerosols by radar and lidar, from a low 395 km.'),
  sat('earth',36508,'CS2',99.2,'CryoSat-2','Measures the thickness of polar ice.'),
  sat('earth',40115,'WV3',97.0,'WorldView-3','A commercial camera that resolves 31 cm.'),
  sat('earth',39574,'GPM',93.2,'GPM Core','Measures rain and snow, in a 65° orbit.'),

  sat('science',20580,'HST',94.1,'Hubble Space Telescope','Launched 1990. 28.5° orbit, about 94 minutes.'),
  sat('science',25867,'CXO',3808.8,'Chandra X-ray Observatory','A 63-hour orbit that swings a third of the way to the Moon.',0.767),
  sat('science',25989,'XMM',2873.0,'XMM-Newton','Europe’s X-ray telescope, in a 48-hour oval orbit.',0.465),
  sat('science',43435,'TES',20504,'TESS','The planet hunter: a 13.7-day orbit in step with the Moon, out to 370,000 km.',0.494),
  sat('science',28485,'SWF',90.8,'Swift','Catches gamma-ray bursts and turns to look within a minute.'),
  sat('science',38358,'NUS',95.4,'NuSTAR','An X-ray telescope on a 10 m mast, nearly over the equator.'),
  sat('science',49954,'IXP',95.3,'IXPE','Measures the polarisation of X-rays, in an orbit along the equator.'),
  sat('science',57800,'XRS',95.2,'XRISM','Japan’s X-ray spectrometer, launched 2023.'),
  sat('science',58753,'EPB',95.9,'Einstein Probe','China’s wide-eyed X-ray telescope.'),
  sat('science',44874,'CHP',98.5,'CHEOPS','Measures planets of other stars as they cross them. It rides the day-night line.'),
  sat('science',40482,'MMS',5078.8,'MMS 1','One of four flying in formation through the Earth’s magnetic field, out to 170,000 km.',0.824),
  sat('science',30580,'THA',1639.3,'THEMIS A','Studies the aurora’s substorms from a long oval orbit.',0.833),

  sat('curios',5,'VAN',132.7,'Vanguard 1','Launched March 1958: the oldest thing still in orbit.',0.19),
  sat('curios',7530,'AO7',114.9,'AMSAT-OSCAR 7','An amateur radio satellite from 1974, still working in sunlight.'),
  sat('curios',8820,'LG1',225.5,'LAGEOS 1','A brass ball covered in mirrors for laser ranging, 5,900 km up, running backwards against the Earth’s turn.'),
  sat('curios',16908,'AJI',115.7,'Ajisai','Japan’s mirror ball: it flashes as it spins.'),
  sat('curios',38077,'LAR',114.7,'LARES','A tungsten ball, the densest thing in orbit, testing general relativity.'),
  sat('curios',39070,'TDR',1436.1,'TDRS 11','A NASA relay for the Space Station and Hubble, geostationary over the Atlantic.'),
  sat('curios',40296,'MER',717.8,'Meridian 7','A Molniya orbit: it hangs high over the far north for hours, then whips round the south in minutes.',0.661)
];
export const bodyId=norad=>`sat:${norad}`;
// Satellites chosen from elsewhere than the catalog (the settings page finds
// them at CelesTrak): {norad, name, code, period, ecc}, kept by the phone.
const extras=new Map();
export function addSatellite({norad,name,code,period,ecc=0,still=false}){
  norad=Number(norad);period=Number(period);ecc=Number(ecc)||0;
  if(!(Number.isInteger(norad)&&norad>0&&norad<1e6&&period>60&&period<1e6&&ecc>=0&&ecc<1))throw new RangeError('Not a satellite');
  if(CATALOG.some(c=>c.norad===norad))return catalogEntry(bodyId(norad));
  name=String(name||'Satellite '+norad).replace(/\s+/g,' ').trim().slice(0,40);
  const entry={norad,name,code:codeFor(code||name),period,symbol:'satellite',group:'yours',note:'',...(ecc?{ecc}:{}),...(still===true?{still:true}:{})};
  extras.set(bodyId(norad),entry);return entry;
}
export const forgetSatellites=()=>extras.clear();
export const addedSatellites=()=>[...extras.values()];
export const catalogEntry=body=>CATALOG.find(c=>bodyId(c.norad)===body)||extras.get(body);
// How an orbit is charted, by its period and how oval it is: chartFor (a
// body's own chart: 'world', 'day' or 'hour') and plotFor (what the
// Plotboard shows of it: its 'hour' or its 'day'), with the settings' rules
// (the settings page reads them too).
export {chartFor,plotFor,swiftest,standsStill,SLOW,codeFor};
// The minutes a body takes a lap: a satellite's from its elements if they
// are loaded, else the catalog's; the Sun and Moon come round in about a day.
export const periodOf=body=>body==='sun'?1440:body==='moon'?1490:registry.get(body)?2*Math.PI/registry.get(body).satrec.no:catalogEntry(body)?.period??95;
// How a body is charted: 'hour' on the zoomed chart (the Sun, the Moon and
// slow orbits), 'day' as the whole local day on one chart ('still': always,
// a geostationary satellite having no hour to chart), or 'world' on the
// world band (fast orbits). (By the catalog's period, so a body's chart does
// not turn on whether its elements have arrived.)
export const viewOf=body=>body==='sun'||body==='moon'?'hour':catalogEntry(body)?.still?'still':chartFor(catalogEntry(body)?.period??95,catalogEntry(body)?.ecc);
// What the Plotboard shows of a body: its hour or its day.
export const plotOf=body=>body==='sun'||body==='moon'?'day':plotFor(catalogEntry(body)?.period??95,catalogEntry(body)?.ecc);

// TLE line checksum: digits count their value, minus signs count one.
export const checksum=line=>[...line.slice(0,68)].reduce((s,c)=>s+(c==='-'?1:/\d/.test(c)?Number(c):0),0)%10;
export function parseTLE(text){
  const lines=text.split(/\r?\n/).map(l=>l.trimEnd()).filter(Boolean),l1=lines.find(l=>l.startsWith('1 ')),l2=lines.find(l=>l.startsWith('2 '));
  if(!l1||!l2||l1.length<69||l2.length<69)throw new Error('Not a two-line element set');
  for(const l of [l1,l2])if(checksum(l)!==Number(l[68]))throw new Error('Element set checksum failed');
  if(l1.slice(2,7)!==l2.slice(2,7))throw new Error('Element lines describe different objects');
  const year=Number(l1.slice(18,20)),day=Number(l1.slice(20,32));
  const epoch=Date.UTC(year<57?2000+year:1900+year,0,1)+(day-1)*86400000;
  return {norad:Number(l1.slice(2,7)),lines:[l1,l2],epoch};
}

const registry=new Map();
export function registerElements(text,source){
  const tle=parseTLE(text),satrec=twoline2satrec(...tle.lines);
  if(satrec.error)throw new Error(`SGP4 rejected the elements (${satrec.error})`);
  const entry={...tle,satrec,source,catalog:catalogEntry(bodyId(tle.norad))};
  registry.set(bodyId(tle.norad),entry);return entry;
}
export const elementsFor=body=>registry.get(body);
export function satellitePosition(body,epoch){
  const e=registry.get(body);if(!e)throw new RangeError(`No elements loaded for ${body}`);
  if(Math.abs(epoch-e.epoch)>freshFor(e))throw new RangeError(`Elements for ${e.catalog?.code||body} are too far from this time`);
  return propagatePosition(body,epoch);
}
// SGP4 at a time, without the freshness check (for fitting segments, whose
// ends may lie a little past it).
export function propagatePosition(body,epoch){
  const e=registry.get(body);if(!e)throw new RangeError(`No elements loaded for ${body}`);
  const date=new Date(epoch),state=propagate(e.satrec,date);
  if(!state?.position)throw new Error('Propagation failed');
  const p=eciToGeodetic(state.position,gstime(date)),lat=p.latitude/RAD,lon=p.longitude/RAD;
  return {lat,lon,dir:direction(lat,lon),altitude:p.height};
}
