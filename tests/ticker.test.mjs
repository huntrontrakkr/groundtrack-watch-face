import test from 'node:test';
import assert from 'node:assert/strict';
import {renderer} from './core-fixture.mjs';
import {elementsFor} from '../src/satellites.js';
import {PLATES,W,H} from '../src/plates.js';
import {registerLiveFixture} from './tle-fixture.mjs';
import {registerNominal} from '../src/nominal.js';

registerNominal();registerLiveFixture();
const at=Date.parse('2026-09-30T13:00:00Z');
const charts=[
  {body:'sun'}, {body:'moon',readout:true}, {body:'sat:36585'},
  {body:'sat:42738'}, {body:'sun',face:'plotboard'},
  ...['fixed','tape','slide','clock','route'].map(tape=>({body:'sat:25544',tape})),
  {body:'sat:25544',projection:'fuller'}, {body:'sun',projection:'fuller'},
  {body:'sat:36585',projection:'fuller'}, {body:'sat:42738',projection:'fuller'}
];

test('the optional minute ticker stays visible and fixed on every view and plate',async()=>{
  const r=await renderer();
  for(const plate of Object.keys(PLATES)){
    let fixed=null;
    for(const c of charts){
      const state={...c,epoch:at+24*60000,timeZone:'UTC',clock24:true,plate,readout:c.readout||false};
      const off=r.render({...state,ticker:false}),on=r.render({...state,ticker:true});
      assert.equal(off.ticker,null);
      assert.equal(on.ticker.minute,'24');
      const b=on.ticker.box;assert.ok(b.w>=40&&b.h>=24&&b.x>=0&&b.y>=0&&b.x+b.w<=W&&b.y+b.h<H-10);
      // The same local minute in a fixed panel, even with the world turning.
      const panel=[];
      for(let y=b.y;y<b.y+b.h;y++)panel.push(...on.frame.slice(y*W+b.x,y*W+b.x+b.w));
      if(fixed)assert.deepEqual(panel,fixed,`${plate} ${JSON.stringify(c)} moved or obscured the ticker`);
      else fixed=panel;
      // Choosing the ticker changes its panel; the chart outside keeps
      // all its original pixels (there are no calendar events in this case).
      let changed=0;
      for(let y=0;y<H;y++)for(let x=0;x<W;x++){
        if(x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h){changed+=on.frame[y*W+x]!==off.frame[y*W+x];continue;}
        assert.equal(on.frame[y*W+x],off.frame[y*W+x],`${plate} ${JSON.stringify(c)} changed outside the panel at ${x},${y}`);
      }
      assert.ok(changed>300);
    }
  }
});

test('the ticker counts local minutes across decimal and hour boundaries',async()=>{
  const r=await renderer(),panels=new Set();
  for(const minute of [0,1,9,10,29,30,59,60]){
    const out=r.render({body:'sun',epoch:at+minute*60000,timeZone:'Asia/Kathmandu',clock24:false,plate:'operations',ticker:true,zone:'body'});
    assert.equal(out.ticker.minute,String((minute+45)%60).padStart(2,'0'));
    const b=out.ticker.box,rows=[];
    for(let y=b.y;y<b.y+b.h;y++)rows.push(...out.frame.slice(y*W+b.x,y*W+b.x+b.w));
    panels.add(rows.join(','));
  }
  assert.equal(panels.size,7,'the following hour repeats the same minute counter');
});

test('satellite sunlight is selectable on each chart and old elements take precedence',async()=>{
  const r=await renderer();
  for(const c of [{body:'sat:25544'},{body:'sat:25544',projection:'fuller'},{body:'sat:36585'},{body:'sat:42738'}]){
    const fresh=r.render({...c,epoch:at,timeZone:'UTC',clock24:true,plate:'operations',corner:'light'});
    assert.ok(fresh.scene.minutes.every(m=>/^(?:[A-Z0-9]{1,3} )?(SUNLIT|ECLIPSE)$/.test(m.corner)));
  }
  const old=r.render({body:'sat:25544',epoch:elementsFor('sat:25544').epoch+60*3600000,timeZone:'UTC',clock24:true,plate:'operations',corner:'light'});
  assert.ok(old.scene.minutes.every(m=>m.corner.startsWith('EL OLD')));
});
