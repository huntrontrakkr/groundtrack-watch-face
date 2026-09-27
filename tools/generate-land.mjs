// Natural Earth -> an offline 1-bit equirectangular atlas. D3 handles the
// antimeridian and polar clipping; the scanline fill has no antialiasing.
import {readFileSync, writeFileSync} from 'node:fs';
import {geoEquirectangular, geoPath} from 'd3-geo';
import {feature} from 'topojson-client';
const W=1440,H=720;
const atlas=JSON.parse(readFileSync('node_modules/world-atlas/land-50m.json'));
const land=feature(atlas,atlas.objects.land),rings=[];
let ring;
const context={moveTo(x,y){rings.push(ring=[[x,y]]);},lineTo(x,y){ring.push([x,y]);},closePath(){ring.push(ring[0]);}};
geoPath(geoEquirectangular().scale(W/(2*Math.PI)).translate([W/2,H/2]).precision(.1),context)(land);
const crossings=Array.from({length:H},()=>[]);
for(const points of rings)for(let i=1;i<points.length;i++){
  const [a,b]=[points[i-1],points[i]];
  const lo=Math.max(0,Math.ceil(Math.min(a[1],b[1])-.5));
  const hi=Math.min(H,Math.ceil(Math.max(a[1],b[1])-.5));
  for(let y=lo;y<hi;y++)crossings[y].push(a[0]+(b[0]-a[0])*(y+.5-a[1])/(b[1]-a[1]));
}
const packed=new Uint8Array(W*H/8);
for(let y=0;y<H;y++){
  const xs=crossings[y].sort((a,b)=>a-b);
  for(let i=0;i+1<xs.length;i+=2){
    const lo=Math.max(0,Math.ceil(xs[i]-.5)),hi=Math.min(W,Math.ceil(xs[i+1]-.5));
    for(let x=lo;x<hi;x++){const bit=y*W+x;packed[bit>>3]|=1<<(bit&7);}
  }
}
writeFileSync('public/land.bin',packed);
writeFileSync('data/land.json',JSON.stringify({width:W,height:H,bytes:packed.length,source:'Natural Earth 1:50m land via world-atlas 2.0.2',sampling:'0.25 degree cell centres; little-endian bit order'},null,2)+'\n');
console.log(`Land atlas: ${W}x${H}, ${packed.length} bytes (flash asset, not a proposed RAM allocation).`);
