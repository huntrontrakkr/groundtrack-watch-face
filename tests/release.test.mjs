import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const python=script=>execFileSync('python3',['-c',`
import importlib.util, sys, types
spec=importlib.util.spec_from_file_location('release','tools/release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
${script}`],{stdio:'pipe'}).toString();

test('versions agree, and a tag must name the version',()=>{
  const version=JSON.parse(readFileSync('package.json','utf8')).version;
  for(const face of ['native','native-plotboard'])assert.equal(JSON.parse(readFileSync(`${face}/package.json`,'utf8')).version,version);
  assert.equal(python(`print(release.version_for('v${version}'))`).trim(),version);
  python(`
for tag in ['v0.0.9','${version}','v99.0.0']:
    try: release.version_for(tag)
    except ValueError: pass
    else: raise AssertionError('Accepted a mismatched release tag')`);
});

test('each face asks for the settings page and the phone\'s location, with its own identity and the same messages and resources',()=>{
  const [a,b]=['native','native-plotboard'].map(f=>JSON.parse(readFileSync(`${f}/package.json`,'utf8')).pebble);
  for(const p of [a,b])assert.ok(p.capabilities.includes('configurable')&&p.capabilities.includes('location'));
  assert.notEqual(a.uuid,b.uuid);assert.deepEqual([a.displayName,b.displayName],['Groundtrack Enroute','Groundtrack Plotboard']);
  assert.deepEqual(a.messageKeys,b.messageKeys);assert.deepEqual(a.resources,b.resources);
});

test('a package is checked for identity, platform, capabilities and the store\'s limits',()=>{
  python(`
import io, json, zipfile, tempfile, os
def pbw(info={}, resources=1000, binary=1000):
    base={'uuid':release.FACES['enroute'].uuid,'versionLabel':'1.2.3','targetPlatforms':['emery'],'watchapp':{'watchface':True},'capabilities':['configurable','location']}
    base.update(info)
    path=tempfile.mktemp(suffix='.pbw')
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('appinfo.json',json.dumps(base));z.writestr('pebble-js-app.js','')
        z.writestr('emery/pebble-app.bin',b'0'*binary);z.writestr('emery/app_resources.pbpack',b'0'*resources);z.writestr('emery/manifest.json','{}')
    return path
release.validate_pbw(pbw(),'1.2.3',release.FACES['enroute'])
for bad in [dict(info={'uuid':'9c30165f-5852-4e13-8806-9809ab3d4fe3'}),dict(info={'uuid':release.FACES['plotboard'].uuid}),dict(info={'versionLabel':'1.2.4'}),
            dict(info={'targetPlatforms':['emery','basalt']}),dict(info={'capabilities':['configurable']}),
            dict(resources=256*1024+1),dict(binary=64*1024+1)]:
    try: release.validate_pbw(pbw(**bad),'1.2.3',release.FACES['enroute'])
    except ValueError: pass
    else: raise AssertionError('Accepted '+repr(bad))`);
});

test('the store description fits, and publishing refuses without a listing',()=>{
  python(`
for face in release.FACES.values(): assert 0<len(release.description(face))<=1600
face=release.FACES['plotboard'];face.store_id=''
try: release.publish('1.2.3',face)
except RuntimeError as e: assert 'listing' in str(e)
else: raise AssertionError('Published without a listing')`);
});

test('store verification reads fresh public metadata after each write',()=>{
  python(`
requests=[]
def get(url, **kwargs):
    requests.append((url, kwargs))
    return types.SimpleNamespace(raise_for_status=lambda:None, json=lambda:{'data':[{'latest_release':{'version':'0.1.0'}}]})
sys.modules['requests']=types.SimpleNamespace(get=get)
face=release.FACES['enroute'];face.store_id='abc'
release.public_app(face);release.public_app(face)
assert all(url==release.API+'/api/v1/apps/id/abc' for url, _ in requests)
assert requests[0][1]['params']!=requests[1][1]['params'], 'A cached response must not verify a later write'`);
});
