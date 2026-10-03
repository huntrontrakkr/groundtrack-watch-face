// The chart's data for the watch's own renderer (native/src/c/chart.c): the
// plates, the tracking stations and the relief height table as a resource
// (native/resources/tables.bin, read while a chart is built, so they take
// no room in the app), and the hour figures, taken from the JavaScript so
// both sides use the same numbers to the bit.
//
// tables.bin (little-endian): u16 plates, u16 stations; 256 relief heights
// (f32); per plate u16 flags, u8 zoned[9][3], space, spaceInk, screen,
// waterline, terminator, nightDots, u8 tints, u8 tint[5], f64 limit[5], u8
// depths, u8 depth[2], f64 limit[2] (100 bytes); per station char code[4],
// f64 lat, lon (20 bytes).
//
//   node tools/generate-native-data.mjs
import {writeFileSync,mkdirSync} from 'node:fs';
import {PLATES,CONTOURS,SHELF,SPAN,W,H} from '../src/plates.js';
import {TRACK_Y} from '../src/chart-render.js';
import {reliefMeters} from '../src/relief.js';
import network from '../data/tracking-stations.json' with {type:'json'};
import figureSets from '../data/figures.json' with {type:'json'};
import {FIGURE_SETS} from '../src/plates.js';

const hexDouble=v=>{if(v===Infinity)return 'INFINITY';if(v===-Infinity)return '-INFINITY';const d=new DataView(new ArrayBuffer(8));d.setFloat64(0,v);const b=d.getBigUint64(0);
  // C99 hex float: exact.
  if(v===0)return Object.is(v,-0)?'-0.0':'0.0';
  const sign=b>>63n?'-':'',exp=Number((b>>52n)&0x7ffn),mant=b&0xfffffffffffffn;
  return exp===0?`${sign}0x0.${mant.toString(16).padStart(13,'0')}p-1022`:`${sign}0x1.${mant.toString(16).padStart(13,'0')}p${exp-1023}`;};
const hexFloat=v=>{const f=new DataView(new ArrayBuffer(4));f.setFloat32(0,v);return `0x${f.getUint32(0).toString(16).padStart(8,'0')}u`;};
const g8=c=>c?0xC0|(c[0]/85)<<4|(c[1]/85)<<2|c[2]/85:0;

const keys=['enroute','sectional','console','hypsometric','red','crt','sunlight','blueprint','amber','airbrush','dotmatrix','odyssey','trackingboard','survey','operations','nightside','infrared','planetary','vector','graphite','staratlas','moonlit','rodgeryoung'];
if(keys.join()!==Object.keys(PLATES).join())throw new Error('Plate order changed: update native/src/c/chart.h');
const inks=['water','land','coast','contour','shelf','grid','route','ink','mark'];
const plates=keys.map(k=>{
  const p=PLATES[k],flags=[p.night==='zones'?'PLATE_ZONES':0,p.scan?'PLATE_SCAN':0,p.terminator?'PLATE_TERMINATOR':0,p.nightDots?'PLATE_NIGHT_DOTS':0,p.mono?'PLATE_MONO':0,p.dots?'PLATE_DOTS':0,p.waterline?'PLATE_WATERLINE':0,p.shade?'PLATE_SHADE':0,p.lattice?'PLATE_LATTICE':0,p.hal?'PLATE_HAL':0].filter(Boolean).join('|')||'0';
  const tints=p.tints||[],depths=p.depths||[];
  return `  {/* ${k} */ ${flags},{${inks.map(i=>`{${p[i].map(g8).join(',')}}`).join(',')}},${g8(p.space)},${g8(p.spaceInk)},${g8(p.screen)},${g8(p.waterline)},${g8(p.terminator)},${g8(p.nightDots)},\n`+
    `    ${tints.length},{${[0,1,2,3,4].map(i=>g8(tints[i]?.[1])).join(',')}},{${[0,1,2,3,4].map(i=>hexDouble(tints[i]?.[0]??0)).join(',')}},${depths.length},{${[0,1].map(i=>g8(depths[i]?.[1])).join(',')}},{${[0,1].map(i=>hexDouble(depths[i]?.[0]??0)).join(',')}}}`;
});
// The tables resource.
const table=[],u8=v=>table.push(v&255),u16=v=>{u8(v);u8(v>>8);},bin=(n,f)=>{const d=new DataView(new ArrayBuffer(n));f(d);table.push(...new Uint8Array(d.buffer));};
const FLAG={ZONES:1,SCAN:2,TERMINATOR:4,NIGHT_DOTS:8,MONO:16,DOTS:32,WATERLINE:64,SHADE:128,LATTICE:256,HAL:512,WASH:1024};
u16(keys.length);u16(network.stations.length);
for(let c=0;c<256;c++)bin(4,d=>d.setFloat32(0,reliefMeters(c),true));
for(const k of keys){
  const p=PLATES[k],tints=p.tints||[],depths=p.depths||[];
  u16((p.night==='zones'?FLAG.ZONES:0)|(p.scan?FLAG.SCAN:0)|(p.terminator?FLAG.TERMINATOR:0)|(p.nightDots?FLAG.NIGHT_DOTS:0)|(p.mono?FLAG.MONO:0)|(p.dots?FLAG.DOTS:0)|(p.waterline?FLAG.WATERLINE:0)|(p.shade?FLAG.SHADE:0)|(p.lattice?FLAG.LATTICE:0)|(p.hal?FLAG.HAL:0)|(p.wash?FLAG.WASH:0));
  for(const i of inks)for(const c of p[i])u8(g8(c));
  for(const c of [p.space,p.spaceInk,p.screen,p.waterline,p.terminator,p.nightDots])u8(g8(c));
  if(p.wash&&tints.length)throw new Error('A wash uses the two otherwise unused tint inks');
  u8(tints.length);for(let i=0;i<5;i++)u8(g8(p.wash?.[i]??tints[i]?.[1]));for(let i=0;i<5;i++)bin(8,d=>d.setFloat64(0,tints[i]?.[0]??0,true));
  u8(depths.length);for(let i=0;i<2;i++)u8(g8(depths[i]?.[1]));for(let i=0;i<2;i++)bin(8,d=>d.setFloat64(0,depths[i]?.[0]??0,true));
}
for(const s of network.stations){for(let i=0;i<4;i++)u8(i<s.code.length?s.code.charCodeAt(i):0);bin(16,d=>{d.setFloat64(0,s.lat,true);d.setFloat64(8,s.lon,true);});}
if(table.length!==4+1024+keys.length*100+network.stations.length*20)throw new Error('tables.bin layout');
// The relief heights exactly as decodeRelief's Float32Array holds them.
const meters=Float32Array.from({length:256},(_,c)=>reliefMeters(c));
// The figures (data/figures.json, tools/generate-figures.py): every set,
// per size each digit's width, height and rows as bits. figures.bin:
// 'GTF2', u8 sets, u8 sizes, u8 size[5], u8 0; then per set, size and digit
// {u8 width, u8 height, u32 first byte}; then the bits, rows packed MSB
// first, (width+7)/8 bytes a row.
const sizes=[20,28,40,72,80];
if(figureSets.sets.map(s=>s.key).join()!==FIGURE_SETS.map(s=>s[0]).join())throw new Error('Figure sets out of order: regenerate data/figures.json');
const head=[...'GTF2'].map(c=>c.charCodeAt(0)),bits=[],entries=[];
head.push(figureSets.sets.length,sizes.length,...sizes,0);
const TABLE_AT=head.length,BITS_AT=TABLE_AT+6*figureSets.sets.length*sizes.length*10;
for(const set of figureSets.sets)for(const size of sizes)for(const c of '0123456789'){
  const g=set.sizes[size][c],first=BITS_AT+bits.length;
  for(const row of g.rows){for(let x=0;x<g.width;x+=8){let b=0;for(let k=0;k<8;k++)if(row[x+k]==='#')b|=128>>k;bits.push(b);}}
  entries.push(g.width,g.height,first&255,(first>>8)&255,(first>>16)&255,first>>>24);
}
const figuresBin=Uint8Array.from([...head,...entries,...bits]);
// The most bytes the hour figures' digits can take in a build: at 80 px both
// figures are single (two digits), else at 72 px at most four distinct.
const glyphBytes=g=>g.height*Math.ceil(g.width/8),most=(set,size,n)=>Object.values(set.sizes[size]).map(glyphBytes).sort((a,b)=>b-a).slice(0,n).reduce((a,b)=>a+b,0);
const figureRoom=Math.max(...figureSets.sets.map(set=>Math.max(most(set,80,2),most(set,72,4))));

mkdirSync('native/src/c/generated',{recursive:true});
writeFileSync('native/src/c/generated/chart_data.h',`// Generated by tools/generate-native-data.mjs from the JavaScript's plates,
// data/tracking-stations.json, the relief decoding and data/figures.json.
// Do not edit.
#pragma once
#include <math.h>
#include "../chart.h"

#define CHART_W ${W}
#define CHART_H ${H}
#define CHART_SPAN ${SPAN}
#define CHART_TRACK_Y ${TRACK_Y}
#define CHART_SHELF ${SHELF}
static const int CHART_CONTOURS[${CONTOURS.length}]={${CONTOURS.join(',')}};

// native/resources/tables.bin: where its parts begin, and their sizes.
#define TABLE_PLATES ${keys.length}
#define TABLE_STATIONS ${network.stations.length}
#define TABLE_METERS_AT 4
#define TABLE_PLATE_AT(k) (1028+100*(k))
#define TABLE_STATION_AT(k) (1028+100*TABLE_PLATES+20*(k))

// native/resources/figures.bin: ${figureSets.sets.length} sets of figures at ${sizes.join(', ')} px. A set's
// table (per size ten digits, each {u8 width, u8 height, u32 first byte})
// is read for a build; the bits a size at a time.
static const uint8_t FIGURE_SIZES[${sizes.length}]={${sizes.join(',')}};
#define FIGURE_SETS ${figureSets.sets.length}
#define FIGURE_TABLE_AT(set) (${TABLE_AT}+6*50*(set))
// The most the hour figures' digits take in a build, of any set.
#define FIGURE_ROOM ${figureRoom}
`);
mkdirSync('native/resources',{recursive:true});
writeFileSync('native/resources/figures.bin',figuresBin);
writeFileSync('native/resources/tables.bin',Uint8Array.from(table));
console.log(`native/src/c/generated/chart_data.h; native/resources/figures.bin: ${figuresBin.length} bytes (${figureSets.sets.length} sets); native/resources/tables.bin: ${table.length} bytes`);
