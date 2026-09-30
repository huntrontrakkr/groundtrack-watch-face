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
  assert.equal(JSON.parse(readFileSync('native/package.json','utf8')).version,version);
  assert.equal(python(`print(release.version_for('v${version}'))`).trim(),version);
  python(`
for tag in ['v0.0.9','${version}','v99.0.0']:
    try: release.version_for(tag)
    except ValueError: pass
    else: raise AssertionError('Accepted a mismatched release tag')`);
});

test('the watch app asks for the settings page and the phone\'s location',()=>{
  const caps=JSON.parse(readFileSync('native/package.json','utf8')).pebble.capabilities;
  assert.ok(caps.includes('configurable')&&caps.includes('location'));
});

test('a package is checked for identity, platform, capabilities and the store\'s limits',()=>{
  python(`
import io, json, zipfile, tempfile, os
def pbw(info={}, resources=1000, binary=1000):
    base={'uuid':release.APP_UUID,'versionLabel':'1.2.3','targetPlatforms':['emery'],'watchapp':{'watchface':True},'capabilities':['configurable','location']}
    base.update(info)
    path=tempfile.mktemp(suffix='.pbw')
    with zipfile.ZipFile(path,'w') as z:
        z.writestr('appinfo.json',json.dumps(base));z.writestr('pebble-js-app.js','')
        z.writestr('emery/pebble-app.bin',b'0'*binary);z.writestr('emery/app_resources.pbpack',b'0'*resources);z.writestr('emery/manifest.json','{}')
    return path
release.validate_pbw(pbw(),'1.2.3')
for bad in [dict(info={'uuid':'9c30165f-5852-4e13-8806-9809ab3d4fe3'}),dict(info={'versionLabel':'1.2.4'}),
            dict(info={'targetPlatforms':['emery','basalt']}),dict(info={'capabilities':['configurable']}),
            dict(resources=256*1024+1),dict(binary=64*1024+1)]:
    try: release.validate_pbw(pbw(**bad),'1.2.3')
    except ValueError: pass
    else: raise AssertionError('Accepted '+repr(bad))`);
});

test('the store description fits, and publishing refuses without a listing',()=>{
  python(`
assert 0<len(release.description())<=1600
release.STORE_APP_ID=''
try: release.publish('none.pbw','1.2.3')
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
release.STORE_APP_ID='abc'
release.public_app();release.public_app()
assert all(url==release.API+'/api/v1/apps/id/abc' for url, _ in requests)
assert requests[0][1]['params']!=requests[1][1]['params'], 'A cached response must not verify a later write'`);
});
