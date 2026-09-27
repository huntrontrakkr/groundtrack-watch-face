export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const linear=Array.from({length:256},(_,i)=>(i/255)**2.2);
const levels=[0,85,170,255];
const screen4=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
// A small ordered screen produces stable, deliberately arranged pixel
// mixtures. Pair selection happens in linear light. Each displayed pixel
// is still one of the 64 native colors; there is no temporal dithering.
const nativePalette=[];
for(const r of levels)for(const g of levels)for(const b of levels)nativePalette.push({rgb:[r,g,b],linear:[linear[r],linear[g],linear[b]]});
const mixCache=new Map();
const metric=(a,b)=>a.reduce((s,v,i)=>s+(v-b[i])**2*[.28,.52,.20][i],0);
function colorPair(color){
  const rgb=color.map(v=>clamp(Math.round(v),0,255)),key=rgb.join(',');
  if(mixCache.has(key))return mixCache.get(key);
  const target=rgb.map(v=>linear[v]);
  if(rgb[0]===rgb[1]&&rgb[1]===rgb[2]){
    const lo=Math.min(2,Math.floor(rgb[0]/85)),a=levels[lo],b=levels[lo+1],pair={a:[a,a,a],b:[b,b,b],f:(target[0]-linear[a])/(linear[b]-linear[a])};
    mixCache.set(key,pair);return pair;
  }
  const ranked=nativePalette.map(p=>({...p,error:metric(p.linear,target)})).sort((a,b)=>a.error-b.error);
  const brackets=rgb.map(v=>[levels[Math.min(2,Math.floor(v/85))],levels[Math.min(2,Math.floor(v/85))+1]]);
  const near=ranked.filter((p,i)=>i<8||p.rgb.every((v,k)=>brackets[k].includes(v)));
  let best={a:near[0].rgb,b:near[0].rgb,f:0,error:near[0].error};
  for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){
    const a=near[i],b=near[j],delta=b.linear.map((v,k)=>v-a.linear[k]),length=metric(a.linear,b.linear);
    // Never mix opposing hues to manufacture a neutral. That produces
    // magenta/green confetti even when its numerical average is correct.
    if(delta.some(v=>v>0)&&delta.some(v=>v<0))continue;
    const f=clamp(delta.reduce((s,v,k)=>s+v*(target[k]-a.linear[k])*[.28,.52,.20][k],0)/length);
    const mean=mix(a.linear,b.linear,f);
    // Prefer coherent pairs to unrelated channel speckles. A small spatial
    // variance cost suppresses colored confetti without sacrificing shading.
    const error=metric(mean,target)+.035*f*(1-f)*length;
    if(error<best.error)best={a:a.rgb,b:b.rgb,f,error};
  }
  // Bounded browser cache; a native port would precompute material ramps.
  if(mixCache.size>32768)mixCache.clear();mixCache.set(key,best);return best;
}
export function mixDisplayColor(color,x,y,mixing=true){
  if(!mixing)return color.map(value=>Math.round(clamp(value,0,255)/85)*85);
  const pair=colorPair(color),threshold=(screen4[(y&3)*4+(x&3)]+.5)/16;
  return threshold<pair.f?pair.b:pair.a;
}
export function quantizeImage(source,mixing=true){
  const out=new Uint8ClampedArray(source.data.length);
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
    const i=(y*source.width+x)*4,c=mixDisplayColor([source.data[i],source.data[i+1],source.data[i+2]],x,y,mixing);
    out[i]=c[0];out[i+1]=c[1];out[i+2]=c[2];out[i+3]=255;
  }
  return out;
}

// Signed distance to the coast in display pixels. The distance is an
// illustrative shoreline treatment, not bathymetry or measured elevation.
export function coastDistance(mask,w,h){
  const dist=new Float32Array(mask.length).fill(w+h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if((x&&mask[i-1]!==mask[i])||(x<w-1&&mask[i+1]!==mask[i])||(y&&mask[i-w]!==mask[i])||(y<h-1&&mask[i+w]!==mask[i]))dist[i]=.5;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;let d=dist[i];if(x)d=Math.min(d,dist[i-1]+1);if(y)d=Math.min(d,dist[i-w]+1);if(x&&y)d=Math.min(d,dist[i-w-1]+Math.SQRT2);if(x<w-1&&y)d=Math.min(d,dist[i-w+1]+Math.SQRT2);dist[i]=d;
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const i=y*w+x;let d=dist[i];if(x<w-1)d=Math.min(d,dist[i+1]+1);if(y<h-1)d=Math.min(d,dist[i+w]+1);if(x<w-1&&y<h-1)d=Math.min(d,dist[i+w+1]+Math.SQRT2);if(x&&y<h-1)d=Math.min(d,dist[i+w-1]+Math.SQRT2);dist[i]=d;
  }
  return dist.map((d,i)=>mask[i]?d:-d);
}
export function soften(mask,w,h,radius=2){
  const temp=new Float32Array(mask.length),out=new Float32Array(mask.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let v=0,n=0;for(let dx=-radius;dx<=radius;dx++){const xx=x+dx;if(xx<0||xx>=w)continue;v+=mask[y*w+xx];n++;}temp[y*w+x]=v/n;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let v=0,n=0;for(let dy=-radius;dy<=radius;dy++){const yy=y+dy;if(yy<0||yy>=h)continue;v+=temp[yy*w+x];n++;}out[y*w+x]=v/n;
  }
  return out;
}
