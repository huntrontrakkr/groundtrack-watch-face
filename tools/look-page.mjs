// The settings page as the phone opens it (the phone's bundle in node, the
// catalog's elements kept as if fetched), screenshotted in Chromium: the
// top as first seen and the whole page, sections opened.
//   node tools/look-page.mjs   (VW: the width, 390; ROUND=1: a Round 2's
//   phone; R2BTN=1: the Round 2 shown at a touch; OPEN: sections to open,
//   comma-separated; PLATE) -> /tmp/page/new-top.png, new-full.png
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {mkdirSync} from 'node:fs';mkdirSync('/tmp/page',{recursive:true});
const out='/tmp/page/index.js';execFileSync(process.execPath,['tools/build-pkjs.mjs',out],{stdio:'pipe'});
const now=Date.now(),stored={plate:process.env.PLATE||'console',body:'sat:25544',extra:'sat:20580,sat:48274',timeZone:'America/New_York'},listeners={};let opened=null;
const lines=readFileSync('tests/fixtures/celestrak-2026-10-02.tle','utf8').trim().split('\n');
for(let i=0;i+2<lines.length;i+=3){const n=Number(lines[i+1].slice(2,7));stored['tle-'+n]=JSON.stringify({text:lines.slice(i,i+3).join('\n')+'\n',fetched:now,epoch:now-86400e3});}
const context=vm.createContext({console:{log:()=>{}},setTimeout:(f,ms)=>{const t=setTimeout(f,ms);t.unref();return t;},clearTimeout,XMLHttpRequest:class{open(){}send(){}},
  navigator:{geolocation:{getCurrentPosition:(ok,no)=>no&&no()}},localStorage:{getItem:k=>k in stored?stored[k]:null,setItem:(k,v)=>{stored[k]=String(v);},removeItem:k=>{delete stored[k];}},
  Pebble:{addEventListener:(n,f)=>{listeners[n]=f;},openURL:u=>{opened=u;},sendAppMessage:(m,ok)=>{setTimeout(ok,0);},getActiveWatchInfo:()=>({platform:process.env.ROUND?'gabbro':'emery'})}});
vm.runInContext(readFileSync(out,'utf8'),context);
listeners.showConfiguration();for(let i=0;i<100&&!opened;i++)await new Promise(r=>setTimeout(r,60));
const html=decodeURIComponent(opened.slice(opened.indexOf(',')+1));writeFileSync('/tmp/page/page.html',html);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:Number(process.env.VW||390),height:844},deviceScaleFactor:2});
const errs=[];await p.addInitScript(`window.process_open=${JSON.stringify(process.env.OPEN||'sec-look')}`);p.on('pageerror',e=>errs.push(e.message));
await p.goto('file:///tmp/page/page.html');await p.waitForTimeout(2500);
await p.screenshot({path:'/tmp/page/new-top.png'});
if(process.env.R2BTN){await p.click('#screen-r2');await p.waitForTimeout(1500);await p.screenshot({path:'/tmp/page/new-top-r2.png'});}
await p.evaluate(()=>{for(const id of (window.process_open||'sec-look').split(','))document.getElementById(id).open=true;});await p.waitForTimeout(9000);
await p.screenshot({path:'/tmp/page/new-full.png',fullPage:true});
console.log('errors',errs);await b.close();
