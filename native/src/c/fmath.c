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
  if(fabs(x)>1e6)x=fmod(x,TWO_PI);
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
