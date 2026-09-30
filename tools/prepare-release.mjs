// Sets a new version in package.json, the faces' package.json and the lockfile,
// once its release notes are written (after Dymaxion's).
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const version=process.argv[2];
if(!/^\d+\.\d+\.\d+$/.test(version||''))throw new Error('Usage: npm run release:prepare -- 0.2.0');
const current=JSON.parse(readFileSync('package.json','utf8')).version;
const compare=(a,b)=>{for(let i=0;i<3;i++){const d=+a.split('.')[i]-+b.split('.')[i];if(d)return d;}return 0;};
if(compare(version,current)<=0)throw new Error('Choose a version newer than '+current);
if(!existsSync(`releases/v${version}.md`))throw new Error(`Write releases/v${version}.md first.`);
for(const path of ['package.json','native/package.json','native-plotboard/package.json']){
  const source=readFileSync(path,'utf8');
  writeFileSync(path,source.replace(/("version"\s*:\s*")[^"]+("\s*[,}])/,(_,before,after)=>before+version+after));
}
execFileSync('npm',['install','--package-lock-only','--ignore-scripts'],{stdio:'inherit'});
console.log(`Version ${version} prepared. Review and commit, then merge to main: CI tests, packages and releases it.`);
