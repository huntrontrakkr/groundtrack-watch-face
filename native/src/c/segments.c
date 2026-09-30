// See segments.h; each step mirrors src/segments.js.
#include "segments.h"
#include "fmath.h"
#include <math.h>
#include <string.h>

static const uint8_t COUNT[SEG_SERIES]={10,10,10,10,8,8,4,8};

bool seg_decode(const uint8_t *b,Segment *seg){
  seg->day=(int32_t)((uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24);
  for(int i=0;i<SEG_COEFFICIENTS;i++){
    const uint32_t v=(uint32_t)b[4+4*i]|(uint32_t)b[5+4*i]<<8|(uint32_t)b[6+4*i]<<16|(uint32_t)b[7+4*i]<<24;
    memcpy(&seg->c[i],&v,4);
  }
  return true;
}
bool seg_decode_watch(const uint8_t *b,Segment *seg){
  memset(seg,0,sizeof *seg);
  seg->day=(int32_t)((uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24);
  for(int i=0;i<SEG_WATCH_COEFFICIENTS;i++){
    const uint32_t v=(uint32_t)b[4+4*i]|(uint32_t)b[5+4*i]<<8|(uint32_t)b[6+4*i]<<16|(uint32_t)b[7+4*i]<<24;
    memcpy(&seg->c[i],&v,4);
  }
  return true;
}
// Clenshaw's recurrence, term for term as chebyshev() in the JavaScript.
static double chebyshev(const float *c,int n,double u){
  double b1=0,b2=0;
  for(int j=n-1;j>=1;j--){const double t=2*u*b1-b2+(double)c[j];b2=b1;b1=t;}
  return u*b1-b2+(double)c[0];
}
double seg_value(const Segment *seg,int series,int64_t seconds){
  int at=0;for(int s=0;s<series;s++)at+=COUNT[s];
  const double u=(double)(seconds-(int64_t)seg->day*86400)/43200-1;
  return chebyshev(seg->c+at,COUNT[series],u);
}
double seg_wrap(double lon){return f_fmod(lon+540,360)-180;}
void seg_position(const Segment *seg,bool moon,int64_t seconds,double *lat,double *lon){
  *lat=seg_value(seg,moon?SEG_MOON_LAT:SEG_SUN_LAT,seconds);
  *lon=seg_wrap(seg_value(seg,moon?SEG_MOON_LON:SEG_SUN_LON,seconds));
}
void seg_moon_light(const Segment *seg,int64_t seconds,double *fraction,bool *waxing){
  *fraction=seg_value(seg,SEG_MOON_FRACTION,seconds);
  const double phase=seg_value(seg,SEG_MOON_PHASE,seconds);
  *waxing=f_fmod(f_fmod(phase,360)+360,360)<180;
}
