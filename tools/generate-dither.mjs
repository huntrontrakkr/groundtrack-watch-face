// Deterministic periodic void-and-cluster threshold tile. Generated offline.
// No game textures or code are used. Gaussian energy discourages clumps.
import {writeFileSync} from 'node:fs';
const N=32,T=N*N,sigma=1.5;
let seed=0x1a2b3c4d;
function random(){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;}
const kernel=new Float64Array(T);
for(let y=0;y<N;y++)for(let x=0;x<N;x++)kernel[y*N+x]=Math.exp(-(Math.min(x,N-x)**2+Math.min(y,N-y)**2)/(2*sigma*sigma));
let bits=new Uint8Array(T),energy=new Float64Array(T);
function update(i,delta){const x=i%N,y=i/N|0;bits[i]+=delta;for(let j=0;j<T;j++){const xx=(j%N-x+N)%N,yy=((j/N|0)-y+N)%N;energy[j]+=delta*kernel[yy*N+xx];}}
function extreme(on){let best=-1,value=on?-Infinity:Infinity;for(let i=0;i<T;i++)if(bits[i]===on&&((on&&energy[i]>value)||(!on&&energy[i]<value))){best=i;value=energy[i];}return best;}
const count=128;
for(let i=0;i<count;){const p=random()*T|0;if(!bits[p]){update(p,1);i++;}}
for(let k=0;k<T*4;k++){const cluster=extreme(1);update(cluster,-1);const hole=extreme(0);update(hole,1);if(cluster===hole)break;}
const initialBits=bits.slice(),initialEnergy=energy.slice(),rank=new Array(T);
for(let i=count-1;i>=0;i--){const p=extreme(1);rank[p]=i;update(p,-1);}
bits=initialBits;energy=initialEnergy;
for(let i=count;i<T;i++){const p=extreme(0);rank[p]=i;update(p,1);}
writeFileSync('data/dither.json',JSON.stringify({size:N,ranks:rank})+'\n');
console.log('Generated 32x32 deterministic stipple thresholds.');
