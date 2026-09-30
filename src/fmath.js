// Sine and cosine that the browser and the watch compute to the same bits.
// Engines' Math.sin and C libraries' sin each round the last bit their own
// way (Node's and glibc's differ for about one input in thirty), which is
// enough to move a pixel at a rounding edge. These are FreeBSD msun's
// kernels (after Sun's fdlibm; accurate to under one ulp) with its
// Cody-Waite reduction, in plain IEEE double arithmetic, mirrored line for
// line by native/src/c/fmath.c.
//
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided
// that this notice is preserved.

const S1=-1.66666666666666324348e-01,S2=8.33333333332248946124e-03,S3=-1.98412698298579493134e-04,
  S4=2.75573137070700676789e-06,S5=-2.50507602534068634195e-08,S6=1.58969099521155010221e-10;
const C1=4.16666666666666019037e-02,C2=-1.38888888888741095749e-03,C3=2.48015872894767294178e-05,
  C4=-2.75573143513906633035e-07,C5=2.08757232129817482790e-09,C6=-1.13596475577881948265e-11;
const INVPIO2=6.36619772367581382433e-01,PIO2_1=1.57079632673412561417e+00,PIO2_1T=6.07710050650619224932e-11,
  PIO2_2=6.07710050630396597660e-11,PIO2_2T=2.02226624879595063154e-21,PIO2_3=2.02226624871116645580e-21,
  PIO2_3T=8.47842766036889956997e-32,ROUND=6755399441055744.0,TWO_PI=6.28318530717958647692;

// The high 32 bits of a double, through a shared buffer (little-endian, as
// every engine that runs this is).
const F64=new Float64Array(1),U32=new Uint32Array(F64.buffer);
const high=x=>{F64[0]=x;return U32[1];};

function kernelSin(x,y,iy){
  const z=x*x,w=z*z,r=S2+z*(S3+z*S4)+z*w*(S5+z*S6),v=z*x;
  if(iy===0)return x+v*(S1+z*r);
  return x-((z*(0.5*y-v*r)-y)-v*S1);
}
function kernelCos(x,y){
  const z=x*x;let w=z*z;const r=z*(C1+z*(C2+z*C3))+w*w*(C4+z*(C5+z*C6)),hz=0.5*z;w=1.0-hz;
  return w+(((1.0-w)-hz)+(z*r-x*y));
}
// x reduced by the nearest multiple of pi/2: returns n, with the remainder
// y0 + y1 left in R0 and R1. Beyond 1e6 (never reached here) x is first
// taken modulo 2 pi, the same way on both sides.
let R0=0,R1=0;
function reduce(x){
  if(Math.abs(x)>1e6)x=x%TWO_PI;
  const fn=(x*INVPIO2+ROUND)-ROUND,n=fn|0;
  let r=x-fn*PIO2_1,w=fn*PIO2_1T,y0=r-w;
  const j=(high(x)>>>20)&0x7ff;
  if(j-((high(y0)>>>20)&0x7ff)>16){
    let t=r;w=fn*PIO2_2;r=t-w;w=fn*PIO2_2T-((t-r)-w);y0=r-w;
    if(j-((high(y0)>>>20)&0x7ff)>49){t=r;w=fn*PIO2_3;r=t-w;w=fn*PIO2_3T-((t-r)-w);y0=r-w;}
  }
  R0=y0;R1=(r-y0)-w;return n;
}
export function sin(x){
  const ix=high(x)&0x7fffffff;
  if(ix<=0x3fe921fb){if(ix<0x3e500000)return x;return kernelSin(x,0,0);}
  if(ix>=0x7ff00000)return NaN;
  const n=reduce(x),a=R0,b=R1;
  switch(n&3){case 0:return kernelSin(a,b,1);case 1:return kernelCos(a,b);case 2:return -kernelSin(a,b,1);default:return -kernelCos(a,b);}
}
export function cos(x){
  const ix=high(x)&0x7fffffff;
  if(ix<=0x3fe921fb){if(ix<0x3e46a09e)return 1.0;return kernelCos(x,0);}
  if(ix>=0x7ff00000)return NaN;
  const n=reduce(x),a=R0,b=R1;
  switch(n&3){case 0:return kernelCos(a,b);case 1:return -kernelSin(a,b,1);case 2:return -kernelCos(a,b);default:return kernelSin(a,b,1);}
}
// The length of (x, y) as both sides compute it: engines' Math.hypot scales
// its arguments its own way; a square root of the sum is exactly rounded.
export const hypot=(x,y)=>Math.sqrt(x*x+y*y);
