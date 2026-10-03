// The settings page offers a setting only where it changes what the watch
// draws, and every setting it offers does: src/settings-rules.js (the page's
// and the phone's one account of which settings a chart takes) against the
// watch's own code, which draws every value of every setting for every body
// on each face in every context of the others (tools/audit-settings.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {audit,SETTINGS} from '../tools/audit-settings.mjs';
import {settingsFor} from '../src/settings-rules.js';
import {viewOf,plotOf} from '../src/satellites.js';
import {execFileSync} from 'node:child_process';

test('an upgrade preserves settings and does not interpret old padding as a ticker',()=>{
  execFileSync('make',['-s','-C','native/host','settings_check'],{stdio:'pipe'});
  execFileSync('native/host/settings_check',[],{stdio:'pipe'});
});

test('every setting offered changes the face, and none that changes it is withheld',{timeout:600000},async()=>{
  // CelesTrak's elements of 29 September 2026, the next afternoon in Berlin
  // (so the 24-hour clock shows), with a home and an event in the hour.
  const result=await audit({tle:readFileSync('tests/fixtures/celestrak-2026-09-29.tle','utf8'),epoch:Date.parse('2026-09-30T13:20:00Z')});
  assert.equal(Object.keys(result).length,4+9+9);
  for(const [where,settings] of Object.entries(result)){
    const [face,body]=where.split(' ');
    for(const [key,contexts] of Object.entries(settings))for(const c of contexts){
      const rules=settingsFor(face,body,viewOf(body),{span:c.span,readout:c.readout,tape:c.tape,plot:plotOf(body)}),at=`${where}, ${key} with ${JSON.stringify(c)}`;
      const expected=
        key==='readout'?Math.max(1,rules.readout.length):
        key==='numerals'?(rules.numerals?'some':1):
        key==='tape'?(rules.tape?5:1):
        key==='transfer'?(rules.transfer?'some':1):
        key==='span'?(rules.span?2:1):
        key==='bare'?(rules.bare?2:1):
        // (A sheet with no open space for it has no scale bar.)
        key==='legend'?(rules.legend?'upto':1):
        key==='corner'?(rules.light?3:2):
        'all';
      if(expected==='upto')continue;
      if(expected==='all')assert.equal(c.distinct,c.of,`${at}: only ${c.distinct} of its ${c.of} values draw differently`);
      else if(expected==='some')assert.ok(c.distinct>=c.of-1,`${at}: only ${c.distinct} of its ${c.of} values draw differently`);
      else assert.equal(c.distinct,expected,`${at}: ${c.distinct} of its values draw differently, the page offers ${expected}`);
    }
  }
  assert.deepEqual(Object.keys(SETTINGS).sort(),['bare','clock24','corner','events','figures','home','legend','margin','numerals','plate','readout','span','tape','ticker','transfer']);
});
