// Public-domain relief -> a quarter-degree equirectangular grid that lines up
// with public/land.bin. Source: the AWS Open Data "Terrain Tiles" (Tilezen
// Joerd), terrarium encoding, zoom 3. At this zoom the tiles are built from
// USGS GMTED2010 on land and NOAA ETOPO1 elsewhere; every tile's
// X-Imagery-Sources header is recorded so the attribution stays exact.
import {writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

const Z=3,N=1<<Z,SIZE=256,W=1440,H=720,CACHE='node_modules/.cache/terrarium';
mkdirSync(CACHE,{recursive:true});

function decodePNG(buffer){
  // 8-bit, non-interlaced RGB or RGBA: all the terrarium tiles use.
  let offset=8,width,height,channels;const data=[];
  while(offset<buffer.length){
    const length=buffer.readUInt32BE(offset),type=buffer.toString('latin1',offset+4,offset+8),body=buffer.subarray(offset+8,offset+8+length);
    if(type==='IHDR'){
      width=body.readUInt32BE(0);height=body.readUInt32BE(4);
      if(body[8]!==8||![2,6].includes(body[9])||body[12]!==0)throw new Error('Unsupported PNG');
      channels=body[9]===2?3:4;
    }else if(type==='IDAT')data.push(body);
    offset+=12+length;
  }
  const raw=inflateSync(Buffer.concat(data)),stride=width*channels,out=new Uint8Array(stride*height);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],row=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),at=y*stride;
    for(let x=0;x<stride;x++){
      const a=x>=channels?out[at+x-channels]:0,b=y?out[at-stride+x]:0,c=y&&x>=channels?out[at-stride+x-channels]:0;
      let v=row[x];
      if(filter===1)v+=a;else if(filter===2)v+=b;else if(filter===3)v+=(a+b)>>1;
      else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      out[at+x]=v&255;
    }
  }
  return {width,height,channels,data:out};
}

const sources={},elevation=new Float32Array(N*SIZE*N*SIZE);
for(let ty=0;ty<N;ty++)for(let tx=0;tx<N;tx++){
  const file=`${CACHE}/${Z}-${tx}-${ty}`;
  if(!existsSync(`${file}.png`)){
    const response=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if(!response.ok)throw new Error(`Tile ${tx},${ty}: ${response.status}`);
    writeFileSync(`${file}.png`,Buffer.from(await response.arrayBuffer()));
    writeFileSync(`${file}.txt`,response.headers.get('x-amz-meta-x-imagery-sources')||'');
  }
  for(const s of readFileSync(`${file}.txt`,'utf8').split(',').map(v=>v.trim().split('/')[0]).filter(Boolean))sources[s]=(sources[s]||0)+1;
  const png=decodePNG(readFileSync(`${file}.png`));
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
    const i=(y*SIZE+x)*png.channels,[r,g,b]=png.data.subarray(i,i+3);
    elevation[(ty*SIZE+y)*N*SIZE+tx*SIZE+x]=r*256+g+b/256-32768;
  }
}
const allowed=['gmted','etopo1'];
if(Object.keys(sources).some(s=>!allowed.includes(s)))throw new Error(`Unexpected sources ${Object.keys(sources)}: review attribution first`);

// Web Mercator sampling. Each quarter-degree cell averages nine bilinear
// samples; beyond the tiles' 85.05 degree limit the edge rows are reused.
const G=N*SIZE,LIMIT=85.0511;
function sample(lat,lon){
  const phi=Math.max(-LIMIT,Math.min(LIMIT,lat))*Math.PI/180;
  const u=(lon+180)/360*G-.5,v=(1-Math.log(Math.tan(Math.PI/4+phi/2))/Math.PI)/2*G-.5;
  const i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
  const at=(x,y)=>elevation[Math.max(0,Math.min(G-1,y))*G+((x%G)+G)%G];
  return (at(i,j)*(1-fu)+at(i+1,j)*fu)*(1-fv)+(at(i,j+1)*(1-fu)+at(i+1,j+1)*fu)*fv;
}
// Square-root codes keep detail in low ground and in the shallow sea:
// 0..63 is depth to 11,000 m, 64..255 is height to 8,850 m.
const encode=e=>e>=0?64+Math.round(Math.sqrt(Math.min(e,8850)/8850)*191):Math.round(63-Math.sqrt(Math.min(-e,11000)/11000)*63);
const grid=new Uint8Array(W*H);let highest=-Infinity,deepest=Infinity;
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  let sum=0;
  for(const dy of [-1/3,0,1/3])for(const dx of [-1/3,0,1/3])sum+=sample(90-(y+.5+dy)*.25,-180+(x+.5+dx)*.25);
  const e=sum/9;highest=Math.max(highest,e);deepest=Math.min(deepest,e);grid[y*W+x]=encode(e);
}
writeFileSync('public/relief.bin',grid);
writeFileSync('data/relief.json',JSON.stringify({
  width:W,height:H,bytes:grid.length,
  sampling:'0.25 degree cell centres, row 0 at 90N, column 0 at 180W; mean of nine bilinear samples per cell',
  encoding:'code 0-63: depth -11000*((63-code)/63)^2 m; code 64-255: height 8850*((code-64)/191)^2 m',
  source:'AWS Open Data Terrain Tiles (Tilezen Joerd), terrarium PNG, zoom 3',
  imagerySources:sources,
  attribution:['Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration','GMTED2010 terrain data courtesy of the U.S. Geological Survey'],
  range:{highest:Math.round(highest),deepest:Math.round(deepest)}
},null,2)+'\n');
console.log(`Relief grid: ${W}x${H}, ${grid.length} bytes, ${Math.round(deepest)} to ${Math.round(highest)} m. Sources: ${JSON.stringify(sources)}`);
