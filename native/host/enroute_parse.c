// Scene blobs as src/native-scene.js writes them, parsed for the host
// harnesses (the watch builds its scenes itself). See enroute_core.h.
#include "../src/c/enroute_core.h"
#include <math.h>
#include <string.h>
#define W ENR_W
#define H ENR_H

// Scene blobs, as tools/export-scene.mjs writes them.
typedef struct {const uint8_t *p,*end;bool ok;} Reader;
static void take(Reader *r,void *dst,size_t n){if(r->p+n>r->end){r->ok=false;memset(dst,0,n);return;}memcpy(dst,r->p,n);r->p+=n;}
static uint8_t u8(Reader *r){uint8_t v;take(r,&v,1);return v;}
static uint16_t u16(Reader *r){uint8_t b[2];take(r,b,2);return b[0]|b[1]<<8;}
static int16_t i16(Reader *r){return (int16_t)u16(r);}
static int32_t i32(Reader *r){uint8_t b[4];take(r,b,4);return (int32_t)((uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24);}
static enr_real f64(Reader *r){double v;take(r,&v,8);return (enr_real)v;}
bool enr_parse(const uint8_t *blob,size_t length,EnrScene *s,void *(*alloc)(size_t),bool borrow){
  Reader r={blob,blob+length,true};
  memset(s,0,sizeof *s);
  char magic[4];take(&r,magic,4);
  if(memcmp(magic,"GTS3",4)||u16(&r)!=W||u16(&r)!=H)return false;
  s->flags=u8(&r);s->body=u8(&r);s->forward=(int8_t)u8(&r);s->view=u8(&r);s->hour_start=i32(&r);
  for(int k=0;k<ENR_ZONED;k++)for(int z=0;z<3;z++)s->zoned[k][z]=u8(&r);
  s->space=u8(&r);s->space_ink=u8(&r);s->screen=u8(&r);s->waterline=u8(&r);s->terminator=u8(&r);s->night_dots=u8(&r);
  for(int k=0;k<5;k++)s->tints[k]=u8(&r);
  for(int k=0;k<2;k++)s->depths[k]=u8(&r);
  for(int y=0;y<H;y++)s->row_cos[y]=f64(&r);
  for(int y=0;y<H;y++)s->row_sin[y]=f64(&r);
  for(int x=0;x<W;x++)s->col_cos[x]=f64(&r);
  for(int x=0;x<W;x++)s->col_sin[x]=f64(&r);
  s->c1x=f64(&r);s->normal_x=f64(&r);s->normal_y=f64(&r);s->zulu_x=i16(&r);s->zulu_baseline=i16(&r);
  s->top_x=i16(&r);s->top_baseline=i16(&r);s->height_right=i16(&r);s->height_baseline=i16(&r);
  s->tape_x0=i16(&r);s->tape_x1=i16(&r);s->tape_baseline=i16(&r);s->tape_lo=i16(&r);s->tape_hi=i16(&r);
  s->home_x=i16(&r);s->home_y=i16(&r);for(int k=0;k<4;k++)s->home_box[k]=i16(&r);
  s->callout_left=i16(&r);s->callout_top=i16(&r);s->callout_bottom=i16(&r);take(&r,s->hour_text,3);
  s->avoid_count=u8(&r);if(s->avoid_count>12)return false;
  for(int k=0;k<s->avoid_count;k++)for(int j=0;j<4;j++)s->avoid[k][j]=i16(&r);
  for(int m=0;m<60;m++){
    EnrMinute *e=&s->minutes[m];
    for(int k=0;k<3;k++)e->sun[k]=f64(&r);
    e->mx=f64(&r);e->my=f64(&r);e->moon_fraction=f64(&r);e->waxing=u8(&r);take(&r,e->zulu,5);take(&r,e->minute,2);take(&r,e->top,24);
    e->index=i16(&r);take(&r,e->height,8);e->circle=u8(&r);
  }
  const unsigned circles=u16(&r);if(circles>60)return false;
  for(unsigned k=0;k<circles;k++){
    const unsigned n=u16(&r);if(n>255||!r.ok)return false;
    s->circle_px[k]=alloc(n?2*n:1);if(!s->circle_px[k])return false;
    s->circle_count=(uint8_t)(k+1);s->circle_n[k]=(uint8_t)n;take(&r,s->circle_px[k],2*n);
  }
  s->track_count=u16(&r);s->track_t0=i32(&r);s->track_step=i16(&r);
  s->track=alloc(sizeof(EnrPoint)*(s->track_count?s->track_count:1));
  if(!s->track)return false;
  for(int k=0;k<s->track_count;k++){EnrPoint *p=&s->track[k];p->x=i16(&r);p->y=i16(&r);p->flags=u8(&r);}
  for(int y=0;y<=H;y++)s->row_offset[y]=u16(&r);
  const size_t runs=s->row_offset[H];
  if(!r.ok||(size_t)(r.end-r.p)!=runs||runs%2)return false;
  for(int y=0;y<H;y++){
    // Every row's runs must cover exactly its width.
    if(s->row_offset[y]>s->row_offset[y+1])return false;
    int width=0;for(size_t k=s->row_offset[y];k<s->row_offset[y+1];k+=2)width+=r.p[k];
    if(width!=W)return false;
  }
  if(borrow)s->runs=r.p;
  else{uint8_t *copy=alloc(runs?runs:1);if(!copy)return false;memcpy(copy,r.p,runs);s->runs=copy;s->owns_runs=true;}
  enr_ready(s);
  return true;
}
