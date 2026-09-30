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

bool sat_segment_decode(const uint8_t *b,SatSegment *seg){
  #define I32(o) ((int32_t)((uint32_t)b[o]|(uint32_t)b[o+1]<<8|(uint32_t)b[o+2]<<16|(uint32_t)b[o+3]<<24))
  seg->norad=I32(0);seg->start=I32(4);seg->span=I32(8);
  float *out[3]={seg->lat,seg->lon,seg->altitude};const int n[3]={SAT_TERMS,SAT_TERMS,SAT_ALT_TERMS};int o=12;
  for(int k=0;k<3;k++)for(int j=0;j<n[k];j++,o+=4){const uint32_t v=(uint32_t)I32(o);memcpy(&out[k][j],&v,4);}
  #undef I32
  return seg->span>0;
}
void sat_segment_position(const SatSegment *seg,int64_t seconds,double *lat,double *lon,double *altitude){
  // satelliteSegmentPosition(): u from the whole second, as the JavaScript.
  const double u=(double)(seconds-seg->start)/(seg->span/2.0)-1;
  *lat=chebyshev(seg->lat,SAT_TERMS,u);*lon=seg_wrap(chebyshev(seg->lon,SAT_TERMS,u));*altitude=chebyshev(seg->altitude,SAT_ALT_TERMS,u);
}
