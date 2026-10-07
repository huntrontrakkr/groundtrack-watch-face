import test from 'node:test';
import assert from 'node:assert/strict';
import {trackingSelection,trackingRemove} from '../src/tracking-selection.js';
const state={body:'sat:25544',extra:['sat:20580','sat:48274'],also:[]};
test('primary promotion and replacement swap selected satellites without duplicates',()=>{
  for(let slot=0;slot<3;slot++)for(const key of [state.body,...state.extra,'sat:40267']){
    const next=trackingSelection(state,slot,key),selected=[next.body,...next.extra];
    assert.equal(selected[slot],key);assert.equal(new Set(selected).size,3);
    if([state.body,...state.extra].includes(key))assert.deepEqual([...selected].sort(),[state.body,...state.extra].sort());
  }
  assert.deepEqual(state,{body:'sat:25544',extra:['sat:20580','sat:48274'],also:[]});
});
test('adding and removing companions preserves the primary and respects capacity',()=>{
  assert.equal(trackingSelection(state,-1,'sat:40267'),null);
  assert.equal(trackingRemove(state,state.body),null);
  const one=trackingRemove(state,'sat:20580');assert.equal(one.body,state.body);
  assert.equal(trackingSelection(one,1,state.body),null,'an empty slot cannot take away the primary');
  assert.deepEqual(trackingSelection(one,-1,'sat:40267').extra,['sat:40267','sat:48274']);
});
test('Sun and Moon can be primary and stay marked when a companion is promoted',()=>{
  for(const body of ['sun','moon']){
    const before={body,extra:['sat:40267','sat:20580'],also:[]};
    const next=trackingSelection(before,0,'sat:40267');
    assert.equal(next.body,'sat:40267');assert.deepEqual(next.extra,['','sat:20580']);assert.deepEqual(next.also,[body]);
    assert.equal(trackingSelection(state,1,body),null);
    assert.equal(trackingSelection(state,0,body).body,body);
  }
});
