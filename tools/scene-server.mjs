// A development scene server for the native app: builds the current local
// hour's scene on request, as the phone does itself. Set the phone's
// sceneServer setting to use it instead, to try renderer changes without
// rebuilding the app.
//
//   node tools/scene-server.mjs [port]
//   GET /scene?body=sun&plate=enroute&flag=1&zone=America/New_York
import {createServer} from 'node:http';
import {buildScene} from './export-scene.mjs';
import {civilHour} from '../src/chart-render.js';

const port=Number(process.argv[2]||5199);
createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname!=='/scene'){response.writeHead(404);response.end();return;}
  try{
    const zone=url.searchParams.get('zone')||'UTC',start=civilHour(Date.now(),zone);
    const {scene}=buildScene({timeZone:zone,body:url.searchParams.get('body')||'sun',start,plate:url.searchParams.get('plate')||'enroute',flag:url.searchParams.get('flag')==='1'});
    response.writeHead(200,{'content-type':'application/octet-stream','content-length':scene.length});response.end(scene);
    console.log(`${new Date().toISOString()} scene ${url.search} ${scene.length} bytes`);
  }catch(error){response.writeHead(500,{'content-type':'text/plain'});response.end(String(error.message));}
}).listen(port,()=>console.log(`Scene server on http://localhost:${port}/scene`));
