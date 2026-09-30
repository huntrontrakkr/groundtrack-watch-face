// Sine and cosine computed to the same bits as src/fmath.js (see there):
// FreeBSD msun's kernels and reduction in plain IEEE double arithmetic.
// Build without fused multiply-adds (-ffp-contract=off).
//
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business. Permission to use,
// copy, modify, and distribute this software is freely granted, provided
// that this notice is preserved.
#include "fmath.h"
#include <stdint.h>
#include <string.h>
#include <math.h>

static const double S1=-1.66666666666666324348e-01,S2=8.33333333332248946124e-03,S3=-1.98412698298579493134e-04,
  S4=2.75573137070700676789e-06,S5=-2.50507602534068634195e-08,S6=1.58969099521155010221e-10;
static const double C1=4.16666666666666019037e-02,C2=-1.38888888888741095749e-03,C3=2.48015872894767294178e-05,
  C4=-2.75573143513906633035e-07,C5=2.08757232129817482790e-09,C6=-1.13596475577881948265e-11;
static const double INVPIO2=6.36619772367581382433e-01,PIO2_1=1.57079632673412561417e+00,PIO2_1T=6.07710050650619224932e-11,
  PIO2_2=6.07710050630396597660e-11,PIO2_2T=2.02226624879595063154e-21,PIO2_3=2.02226624871116645580e-21,
  PIO2_3T=8.47842766036889956997e-32,ROUND=6755399441055744.0,TWO_PI=6.28318530717958647692;

static uint32_t high(double x){uint64_t u;memcpy(&u,&x,8);return (uint32_t)(u>>32);}
static uint32_t low(double x){uint64_t u;memcpy(&u,&x,8);return (uint32_t)u;}
static double from_words(uint32_t hi,uint32_t lo){uint64_t u=(uint64_t)hi<<32|lo;double x;memcpy(&x,&u,8);return x;}

// fdlibm's e_sqrt.c: the square root, correctly rounded, bit by bit in
// integers, as IEEE (and JavaScript's Math.sqrt) requires. The watch's
// libm square root can be an ulp off.
double f_sqrt(double x){
  int32_t ix0=(int32_t)high(x),s0,q,m,t,i;uint32_t r,t1,s1,ix1=low(x),q1;
  const int32_t sign=(int32_t)0x80000000;
  if((ix0&0x7ff00000)==0x7ff00000)return x*x+x;          // inf or NaN
  if(ix0<=0){
    if(((ix0&(~sign))|ix1)==0)return x;                  // +-0
    else if(ix0<0)return NAN;                             // negative
  }
  m=(ix0>>20);
  if(m==0){                                               // subnormal
    while(ix0==0){m-=21;ix0|=(int32_t)(ix1>>11);ix1<<=21;}
    for(i=0;(ix0&0x00100000)==0;i++)ix0<<=1;
    m-=i-1;ix0|=(int32_t)(ix1>>(32-i));ix1<<=i;
  }
  m-=1023;ix0=(ix0&0x000fffff)|0x00100000;
  if(m&1){ix0+=ix0+(int32_t)((ix1&(uint32_t)sign)>>31);ix1+=ix1;}
  m>>=1;
  ix0+=ix0+(int32_t)((ix1&(uint32_t)sign)>>31);ix1+=ix1;
  q=q1=s0=s1=0;r=0x00200000;
  while(r!=0){t=s0+(int32_t)r;if(t<=ix0){s0=t+(int32_t)r;ix0-=t;q+=(int32_t)r;}ix0+=ix0+(int32_t)((ix1&(uint32_t)sign)>>31);ix1+=ix1;r>>=1;}
  r=(uint32_t)sign;
  while(r!=0){
    t1=s1+r;t=s0;
    if((t<ix0)||((t==ix0)&&(t1<=ix1))){
      s1=t1+r;if(((t1&(uint32_t)sign)==(uint32_t)sign)&&(s1&(uint32_t)sign)==0)s0+=1;
      ix0-=t;if(ix1<t1)ix0-=1;ix1-=t1;q1+=r;
    }
    ix0+=ix0+(int32_t)((ix1&(uint32_t)sign)>>31);ix1+=ix1;r>>=1;
  }
  // Round to nearest (ties to even).
  if((ix0|(int32_t)ix1)!=0){
    if(q1==(uint32_t)0xffffffff){q1=0;q+=1;}
    else if(q1==(uint32_t)0xfffffffe){q1+=2;}
    else q1+=(q1&1);
  }
  ix0=(q>>1)+0x3fe00000;ix1=q1>>1;
  if(q&1)ix1|=(uint32_t)sign;
  ix0+=(m<<20);
  return from_words((uint32_t)ix0,ix1);
}

// fdlibm's e_fmod.c: x - n*y exactly, n = trunc(x/y), as JavaScript's %.
// The watch's libm fmod gives wrong results.
double f_fmod(double x,double y){
  int32_t n,hx,hy,hz,ix,iy,sx,i;uint32_t lx,ly,lz;
  hx=(int32_t)high(x);lx=low(x);hy=(int32_t)high(y);ly=low(y);
  sx=hx&(int32_t)0x80000000;hx^=sx;hy&=0x7fffffff;
  if((hy|(int32_t)ly)==0||(hx>=0x7ff00000)||((hy|(int32_t)((ly|-ly)>>31))>0x7ff00000))return (x*y)/(x*y);
  if(hx<=hy){
    if((hx<hy)||(lx<ly))return x;
    if(lx==ly)return from_words((uint32_t)sx,0);         // +-0 with x's sign
  }
  if(hx<0x00100000){if(hx==0){for(ix=-1043,i=(int32_t)lx;i>0;i<<=1)ix-=1;}else{for(ix=-1022,i=(hx<<11);i>0;i<<=1)ix-=1;}}
  else ix=(hx>>20)-1023;
  if(hy<0x00100000){if(hy==0){for(iy=-1043,i=(int32_t)ly;i>0;i<<=1)iy-=1;}else{for(iy=-1022,i=(hy<<11);i>0;i<<=1)iy-=1;}}
  else iy=(hy>>20)-1023;
  if(ix>=-1022)hx=0x00100000|(0x000fffff&hx);
  else{n=-1022-ix;if(n<=31){hx=(int32_t)((uint32_t)hx<<n|lx>>(32-n));lx<<=n;}else{hx=(int32_t)(lx<<(n-32));lx=0;}}
  if(iy>=-1022)hy=0x00100000|(0x000fffff&hy);
  else{n=-1022-iy;if(n<=31){hy=(int32_t)((uint32_t)hy<<n|ly>>(32-n));ly<<=n;}else{hy=(int32_t)(ly<<(n-32));ly=0;}}
  n=ix-iy;
  while(n--){
    hz=hx-hy;lz=lx-ly;if(lx<ly)hz-=1;
    if(hz<0){hx=hx+hx+(int32_t)(lx>>31);lx=lx+lx;}
    else{if((hz|(int32_t)lz)==0)return from_words((uint32_t)sx,0);hx=hz+hz+(int32_t)(lz>>31);lx=lz+lz;}
  }
  hz=hx-hy;lz=lx-ly;if(lx<ly)hz-=1;
  if(hz>=0){hx=hz;lx=lz;}
  if((hx|(int32_t)lx)==0)return from_words((uint32_t)sx,0);
  while(hx<0x00100000){hx=hx+hx+(int32_t)(lx>>31);lx=lx+lx;iy-=1;}
  if(iy>=-1022){hx=((hx-0x00100000)|((iy+1023)<<20));return from_words((uint32_t)(hx|sx),lx);}
  n=-1022-iy;
  if(n<=20){lx=(lx>>n)|((uint32_t)hx<<(32-n));hx>>=n;}
  else if(n<=31){lx=(uint32_t)(hx<<(32-n))|(lx>>n);hx=sx;}
  else{lx=(uint32_t)(hx>>(n-32));hx=sx;}
  return from_words((uint32_t)(hx|sx),lx);
}

static double kernel_sin(double x,double y,int iy){
  const double z=x*x,w=z*z,r=S2+z*(S3+z*S4)+z*w*(S5+z*S6),v=z*x;
  if(iy==0)return x+v*(S1+z*r);
  return x-((z*(0.5*y-v*r)-y)-v*S1);
}
static double kernel_cos(double x,double y){
  const double z=x*x;double w=z*z;const double r=z*(C1+z*(C2+z*C3))+w*w*(C4+z*(C5+z*C6)),hz=0.5*z;w=1.0-hz;
  return w+(((1.0-w)-hz)+(z*r-x*y));
}
static int reduce(double x,double *y0,double *y1){
  if(fabs(x)>1e6)x=f_fmod(x,TWO_PI);
  // volatile keeps the rounding trick from being folded away.
  volatile double t0=x*INVPIO2+ROUND;const double fn=t0-ROUND;const int n=(int)fn;
  double r=x-fn*PIO2_1,w=fn*PIO2_1T,y=r-w;
  const int j=(int)((high(x)>>20)&0x7ff);
  if(j-(int)((high(y)>>20)&0x7ff)>16){
    double t=r;w=fn*PIO2_2;r=t-w;w=fn*PIO2_2T-((t-r)-w);y=r-w;
    if(j-(int)((high(y)>>20)&0x7ff)>49){t=r;w=fn*PIO2_3;r=t-w;w=fn*PIO2_3T-((t-r)-w);y=r-w;}
  }
  *y0=y;*y1=(r-y)-w;return n;
}
double f_sin(double x){
  const uint32_t ix=high(x)&0x7fffffff;
  if(ix<=0x3fe921fb){if(ix<0x3e500000)return x;return kernel_sin(x,0,0);}
  if(ix>=0x7ff00000)return NAN;
  double a,b;const int n=reduce(x,&a,&b);
  switch(n&3){case 0:return kernel_sin(a,b,1);case 1:return kernel_cos(a,b);case 2:return -kernel_sin(a,b,1);default:return -kernel_cos(a,b);}
}
double f_cos(double x){
  const uint32_t ix=high(x)&0x7fffffff;
  if(ix<=0x3fe921fb){if(ix<0x3e46a09e)return 1.0;return kernel_cos(x,0);}
  if(ix>=0x7ff00000)return NAN;
  double a,b;const int n=reduce(x,&a,&b);
  switch(n&3){case 0:return kernel_cos(a,b);case 1:return -kernel_sin(a,b,1);case 2:return -kernel_cos(a,b);default:return kernel_sin(a,b,1);}
}
