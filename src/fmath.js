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

// Arcsine, arccosine and arctangents, after fdlibm's e_asin.c, e_acos.c,
// s_atan.c and e_atan2.c, mirrored by native/src/c/fmath.c.
const PIO2_HI=1.57079632679489655800e+00,PIO2_LO=6.12323399573676603587e-17,PIO4_HI=7.85398163397448278999e-01,PI=3.14159265358979311600e+00,
  PS0=1.66666666666666657415e-01,PS1=-3.25565818622400915405e-01,PS2=2.01212532134862925881e-01,PS3=-4.00555345006794114027e-02,
  PS4=7.91534994289814532176e-04,PS5=3.47933107596021167570e-05,QS1=-2.40339491173441421878e+00,QS2=2.02094576023350569471e+00,
  QS3=-6.88283971605453293030e-01,QS4=7.70381505559019352791e-02;
const low=x=>{F64[0]=x;return U32[0];};
// x with its low word cleared.
const highOnly=x=>{F64[0]=x;U32[0]=0;return F64[0];};
const ratP=t=>t*(PS0+t*(PS1+t*(PS2+t*(PS3+t*(PS4+t*PS5))))),ratQ=t=>1.0+t*(QS1+t*(QS2+t*(QS3+t*QS4)));
export function asin(x){
  const hx=high(x)|0,ix=hx&0x7fffffff;
  if(ix>=0x3ff00000){if(((ix-0x3ff00000)|low(x))===0)return x*PIO2_HI+x*PIO2_LO;return NaN;}
  if(ix<0x3fe00000){
    if(ix<0x3e400000)return x;
    const t=x*x,w=ratP(t)/ratQ(t);return x+x*w;
  }
  let w=1.0-Math.abs(x),t=w*0.5;const p=ratP(t),q=ratQ(t),s=Math.sqrt(t);
  if(ix>=0x3FEF3333){w=p/q;t=PIO2_HI-(2.0*(s+s*w)-PIO2_LO);}
  else{w=highOnly(s);const c=(t-w*w)/(s+w),r=p/q,pp=2.0*s*r-(PIO2_LO-2.0*c),qq=PIO4_HI-2.0*w;t=PIO4_HI-(pp-qq);}
  return hx>0?t:-t;
}
export function acos(x){
  const hx=high(x)|0,ix=hx&0x7fffffff;
  if(ix>=0x3ff00000){if(((ix-0x3ff00000)|low(x))===0)return hx>0?0.0:PI+2.0*PIO2_LO;return NaN;}
  if(ix<0x3fe00000){
    if(ix<=0x3c600000)return PIO2_HI+PIO2_LO;
    const z=x*x,r=ratP(z)/ratQ(z);return PIO2_HI-(x-(PIO2_LO-x*r));
  }
  if(hx<0){const z=(1.0+x)*0.5,s=Math.sqrt(z),r=ratP(z)/ratQ(z),w=r*s-PIO2_LO;return PI-2.0*(s+w);}
  const z=(1.0-x)*0.5,s=Math.sqrt(z),df=highOnly(s),c=(z-df*df)/(s+df),r=ratP(z)/ratQ(z),w=r*s+c;
  return 2.0*(df+w);
}
const ATANHI=[4.63647609000806093515e-01,7.85398163397448278999e-01,9.82793723247329054082e-01,1.57079632679489655800e+00],
  ATANLO=[2.26987774529616870924e-17,3.06161699786838301793e-17,1.39033110312309984516e-17,6.12323399573676603587e-17],
  AT=[3.33333333333329318027e-01,-1.99999999998764832476e-01,1.42857142725034663711e-01,-1.11111104054623557880e-01,
    9.09088713343650656196e-02,-7.69187620504482999495e-02,6.66107313738753120669e-02,-5.83357013379057348645e-02,
    4.97687799461593236017e-02,-3.65315727442169155270e-02,1.62858201153657823623e-02];
export function atan(x){
  const hx=high(x)|0,ix=hx&0x7fffffff;let id;
  if(ix>=0x44100000){if(x!==x)return x+x;return hx>0?ATANHI[3]+ATANLO[3]:-ATANHI[3]-ATANLO[3];}
  if(ix<0x3fdc0000){if(ix<0x3e200000)return x;id=-1;}
  else{
    x=Math.abs(x);
    if(ix<0x3ff30000){if(ix<0x3fe60000){id=0;x=(2.0*x-1.0)/(2.0+x);}else{id=1;x=(x-1.0)/(x+1.0);}}
    else if(ix<0x40038000){id=2;x=(x-1.5)/(1.0+1.5*x);}
    else{id=3;x=-1.0/x;}
  }
  const z=x*x,w=z*z,s1=z*(AT[0]+w*(AT[2]+w*(AT[4]+w*(AT[6]+w*(AT[8]+w*AT[10]))))),s2=w*(AT[1]+w*(AT[3]+w*(AT[5]+w*(AT[7]+w*AT[9]))));
  if(id<0)return x-x*(s1+s2);
  const r=ATANHI[id]-((x*(s1+s2)-ATANLO[id])-x);return hx<0?-r:r;
}
const PI_O_4=7.8539816339744827900E-01,PI_O_2=1.5707963267948965580E+00,PI_LO=1.2246467991473531772E-16,TINY=1.0e-300;
export function atan2(y,x){
  if(x!==x||y!==y)return x+y;
  const hx=high(x)|0,ix=hx&0x7fffffff,lx=low(x),hy=high(y)|0,iy=hy&0x7fffffff,ly=low(y);
  if(((hx-0x3ff00000)|lx)===0)return atan(y);
  const m=((hy>>>31)&1)|((hx>>>30)&2);
  if((iy|ly)===0){if(m<=1)return y;return m===2?PI+TINY:-PI-TINY;}
  if((ix|lx)===0)return hy<0?-PI_O_2-TINY:PI_O_2+TINY;
  if(ix===0x7ff00000){
    if(iy===0x7ff00000)return [PI_O_4+TINY,-PI_O_4-TINY,3.0*PI_O_4+TINY,-3.0*PI_O_4-TINY][m];
    return [0,-0,PI+TINY,-PI-TINY][m];
  }
  if(iy===0x7ff00000)return hy<0?-PI_O_2-TINY:PI_O_2+TINY;
  const k=(iy-ix)>>20;let z;
  if(k>60)z=PI_O_2+0.5*PI_LO;else if(hx<0&&k<-60)z=0.0;else z=atan(Math.abs(y/x));
  switch(m){case 0:return z;case 1:return -z;case 2:return PI-(z-PI_LO);default:return (z-PI_LO)-PI;}
}
