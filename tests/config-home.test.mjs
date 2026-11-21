// Exercise the actual inline Home initializer and Save handler without needing
// a browser process. The browser integration test covers the complete page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {HOMES} from '../src/home.js';

const html=readFileSync(new URL('../native/pkjs/config.html',import.meta.url),'utf8');
function section(start,end){
  const a=html.indexOf(start),b=html.indexOf(end,a);
  assert.ok(a>=0&&b>a,'settings page handler exists');
  return html.slice(a,b);
}
const initialize=section('  var home=null;try{home=config.settings.home','  var status=document.getElementById(\'status\');');
const close=section('  function close(result){','  // ---- The preview:');
const save=section("  document.getElementById('save').addEventListener('click',function(){",'\n})();');

function formFor(zone,savedHome){
  let mode=null,saveClick=null,focused=null;
  const nodes={'preset-note':{},'preset-row':{},'sec-home':{open:false},status:{textContent:''},
    save:{addEventListener:(event,handler)=>{assert.equal(event,'click');saveClick=handler;}}};
  const field=name=>{let value='';return {get value(){return value;},set value(next){value=String(next);},focus:()=>{focused=name;}};};
  const form={elements:{lat:field('lat'),lon:field('lon'),calendar:field('calendar')}};
  const location={href:''};
  const context=vm.createContext({config:{settings:{home:savedHome,timeZone:zone},preset:HOMES[zone]?.name||null},
    form,document:{getElementById:id=>{assert.ok(id in nodes,id);return nodes[id];}},location,
    hide:(id,value)=>{nodes[id].hidden=value;},show:(name,value)=>{assert.equal(name,'home');mode=value;},picked:name=>{assert.equal(name,'home');return mode;},
    status:nodes.status,s:{body:'moon',plate:'sectional',fx:[]},fuller:false});
  vm.runInContext(initialize+close+save,context);
  return {form,nodes,get mode(){return mode;},set mode(value){mode=value;},get focused(){return focused;},
    save(){saveClick();return location.href?JSON.parse(decodeURIComponent(location.href.slice('pebblejs://close#'.length))):null;}};
}

for(const zone of ['America/Denver','America/Los_Angeles','Europe/Paris']){
  test(`no home or preset in ${zone} does not block unrelated settings`,()=>{
    const page=formFor(zone,'');
    assert.equal(page.mode,'none');assert.equal(page.nodes['preset-row'].hidden,true);
    const result=page.save();assert.ok(result);
    assert.equal(result.body,'moon');assert.equal(result.plate,'sectional');assert.deepEqual(JSON.parse(result.home),{none:true});
  });
}
test('available presets and saved home preferences remain selected',()=>{
  for(const zone of ['UTC','America/New_York','Europe/London','Asia/Kolkata']){
    const page=formFor(zone,'');assert.equal(page.mode,'preset');assert.equal(page.save().home,'');
  }
  for(const zone of ['UTC','America/Denver']){
    const custom=formFor(zone,JSON.stringify({lat:39.74,lon:-104.99,name:'Denver'}));
    assert.equal(custom.mode,'custom');assert.deepEqual(JSON.parse(custom.save().home),{lat:39.74,lon:-104.99,name:'Denver'});
    const none=formFor(zone,JSON.stringify({none:true}));assert.equal(none.mode,'none');assert.deepEqual(JSON.parse(none.save().home),{none:true});
  }
});
test('explicit invalid custom coordinates block Save and reveal the error',()=>{
  for(const [lat,lon] of [['',''],['91','0'],['0','181']]){
    const page=formFor('UTC','');page.mode='custom';page.form.elements.lat.value=lat;page.form.elements.lon.value=lon;
    assert.equal(page.save(),null);assert.equal(page.nodes['sec-home'].open,true);
    assert.match(page.nodes.status.textContent,/Latitude runs/);assert.equal(page.focused,'lat');
  }
});
test('an explicitly entered custom home still saves with decimal commas',()=>{
  const page=formFor('America/Denver','');page.mode='custom';page.form.elements.lat.value='39,74';page.form.elements.lon.value='-104,99';
  assert.deepEqual(JSON.parse(page.save().home),{lat:39.74,lon:-104.99});
});
