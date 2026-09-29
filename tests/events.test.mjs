import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STUDY_EVENTS,nameCode,uniqueCode,pronounceable,atLocal} from '../src/events.js';
import {EnrouteRenderer,PLATES,W} from '../src/enroute-render.js';
import {decodeRelief} from '../src/relief.js';
import {MINUTE} from '../src/ephemeris.js';

const atlas=new Uint8Array(readFileSync('public/land.bin')),meters=decodeRelief(new Uint8Array(readFileSync('public/relief.bin')));
const SUN=Date.parse('2026-09-27T08:24:00Z'),ISS=Date.parse('2019-06-05T12:24:00Z');
const overlap=(a,b)=>!(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y);

test('events are named with five-letter name codes, made from their titles',()=>{
  const cases={Standup:'STAND',Dinner:'DINNR',Run:'RUNNN','Gate B12':'GATEB','Lunch w/ Sam':'LUNCH','School run':'SCHOL',Doctor:'DOCTR','café ☕':'CAFEE','1:1':'EVENT','':'EVENT'};
  for(const [title,code] of Object.entries(cases))assert.equal(nameCode(title),code,title);
  // Whatever the title, a code is five capitals and can be said aloud.
  for(const title of ['Strength training','Rhythm','Pick up kids','Flight to Boston','xxxxxxxxxx','a b c','Q','Ürgent sync!!','Tsktsktsk','1:1 with Ana',...Object.keys(cases)]){
    const code=nameCode(title);assert.match(code,/^[A-Z]{5}$/,title);assert.ok(pronounceable(code),`${title}: ${code}`);
  }
  // Unique on the day: a repeat changes its last letter.
  assert.equal(uniqueCode('Standup',[]),'STAND');const second=uniqueCode('Standup',['STAND']);
  assert.ok(second!=='STAND'&&second.startsWith('STAN')&&pronounceable(second));
  assert.ok(STUDY_EVENTS.every(e=>e.label===nameCode(e.title)));
});

test('event times are local wall-clock times',()=>{
  // Across a daylight-saving change and in a half-hour zone.
  assert.equal(new Date(atLocal(Date.parse('2026-03-08T12:00:00Z'),'America/New_York',12,0)).toISOString(),'2026-03-08T16:00:00.000Z');
  assert.equal(new Date(atLocal(Date.parse('2026-03-08T12:00:00Z'),'America/New_York',1,30)).toISOString(),'2026-03-08T06:30:00.000Z');
  assert.equal(new Date(atLocal(SUN,'Asia/Kolkata',9,30)).toISOString(),'2026-09-27T04:00:00.000Z');
});

test('an event is a filled triangle on the route at its minute, named clear of the figures',()=>{
  const r=new EnrouteRenderer(atlas,meters),state={body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:false,plate:'enroute',events:STUDY_EVENTS};
  const out=r.render(state),[run]=out.events,at=r.camera.track.find(p=>p.epoch===Date.parse('2026-09-27T08:45:00Z'));
  assert.equal(run.label,'RUNNN');assert.ok(Math.abs(run.x-at.x)<=1&&Math.abs(run.y-at.y)<=1);
  const px=(x,y)=>[...out.buf.slice((y*W+x)*3,(y*W+x)*3+3)].join(),ink=PLATES.enroute.ink[0].join();
  for(const [dx,dy] of [[0,-4],[0,0],[-3,1],[3,1],[-4,2],[4,2]])assert.equal(px(run.x+dx,run.y+dy),ink);
  // Wherever in the hour the event falls, its name never covers a figure.
  for(let m=0;m<=60;m+=4){
    const hour=Date.parse('2026-09-27T08:00:00Z'),o=r.render({...state,events:[{epoch:hour+m*MINUTE,label:'STAND'}],readout:m%8===0});
    const [e]=o.events;assert.ok(e,`minute ${m}`);
    if(e.box)for(const b of [o.figure.box,o.figure.nextBox,o.figure.readout].filter(Boolean))assert.ok(!overlap(e.box,b),`minute ${m}`);
    if(e.box)for(const s of o.stations)assert.ok(!overlap(e.box,s.box));
  }
  // Off the route, no fix.
  assert.deepEqual(r.render({...state,events:[{epoch:SUN+6*3600000,label:'LATER'}]}).events,[]);
});

test('events stand on the day strip and the satellite’s world band too',()=>{
  const r=new EnrouteRenderer(atlas,meters);
  const day=r.render({body:'sun',epoch:SUN,timeZone:'America/New_York',clock24:false,plate:'enroute',projection:'fuller',events:STUDY_EVENTS});
  assert.deepEqual(day.events.map(e=>e.label),['RUNNN','DINNR']);
  const world=r.render({body:'iss',epoch:ISS,timeZone:'UTC',clock24:false,plate:'plotboard',events:STUDY_EVENTS});
  assert.deepEqual(world.events.map(e=>e.label),['STAND']);assert.ok(world.events[0].box);
});
