// The map pack's decoder. Mirrors decodeTile in tools/map-pack.mjs step
// for step; integer arithmetic only, so both decode identical cells.
#include "map_pack.h"
#include <string.h>

#define SCALE_BITS 12
#define TOTAL (1u<<SCALE_BITS)
#define RANS_L (1u<<23)
#define L MAP_LEVELS

static uint16_t le16(const uint8_t *p){return (uint16_t)(p[0]|p[1]<<8);}
static uint32_t le32(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool read_at(const MapPack *p,uint32_t at,uint8_t *out,size_t n){return p->read(p->source,at,out,n)==n;}

double map_cell_degrees(int resolution){return 0.25*(1<<resolution);}

bool map_pack_open(MapPack *p,MapReadFn read,void *source,void *(*alloc)(size_t)){
  memset(p,0,sizeof *p);p->read=read;p->source=source;
  uint8_t h[8];
  if(!read_at(p,0,h,8)||memcmp(h,"GTM2",4)||h[4]!=MAP_TILE||h[5]!=MAP_LEVELS||h[6]<1||h[6]>MAP_MIPS)return false;
  p->mips=h[6];p->levels=h[5];
  uint32_t at=8;uint8_t b[64];
  if(!read_at(p,at,b,2*MAP_LEVELS))return false;
  for(int k=0;k<MAP_LEVELS;k++)p->height[k]=(int16_t)le16(b+2*k);
  at+=2*MAP_LEVELS;
  if(!read_at(p,at,b,32))return false;
  for(int k=0;k<16;k++)p->land_freq[k]=le16(b+2*k);
  at+=32;
  uint8_t present[(MAP_CONTEXTS+7)/8];if(!read_at(p,at,present,sizeof present))return false;at+=sizeof present;
  int n=0;for(int c=0;c<MAP_CONTEXTS;c++)if(present[c>>3]>>(c&7)&1)n++;
  p->tables=alloc(sizeof(uint16_t)*(size_t)n*(L+1));if(!p->tables)return false;
  uint16_t *t=p->tables;
  for(int c=0;c<MAP_CONTEXTS;c++){
    if(!(present[c>>3]>>(c&7)&1)){p->cum[c]=NULL;continue;}
    if(!read_at(p,at,b,2*L))return false;
    at+=2*L;
    t[0]=0;
    for(int s=0;s<L;s++)t[s+1]=(uint16_t)(t[s]+le16(b+2*s));
    if(t[L]!=TOTAL)return false;
    p->cum[c]=t;t+=L+1;
  }
  for(int m=0;m<p->mips;m++){
    MapMip *q=&p->mip[m];
    if(!read_at(p,at,b,7))return false;
    q->resolution=b[0];q->width=le16(b+1);q->first=le16(b+3);q->rows=le16(b+5);at+=7;
    q->cols=(uint16_t)((q->width+MAP_TILE-1)/MAP_TILE);q->trows=(uint16_t)((q->rows+MAP_TILE-1)/MAP_TILE);
    q->offsets_at=at;at+=4u*((uint32_t)q->cols*q->trows+1);q->data=at;
    uint8_t e[4];
    if(!read_at(p,q->offsets_at+4u*((uint32_t)q->cols*q->trows),e,4))return false;
    at+=le32(e);
  }
  return true;
}
void map_pack_close(MapPack *p,void (*release)(void *)){release(p->tables);p->tables=0;}

// Sequential reads through a small buffer.
typedef struct {const MapPack *p;uint32_t at,end,from,filled;uint8_t *buf;} Reader;
static uint8_t next_byte(Reader *r){
  if(r->at>=r->end)return 0;
  if(r->at<r->from||r->at>=r->from+r->filled){
    r->from=r->at;size_t n=r->end-r->at<256?r->end-r->at:256;
    r->filled=(uint32_t)r->p->read(r->p->source,r->at,r->buf,n);if(!r->filled)return 0;
  }
  return r->buf[r->at++ - r->from];
}
bool map_tile(const MapPack *p,int m,int tx,int ty,uint8_t *out,uint8_t *buffer){
  if(m<0||m>=p->mips)return false;
  const MapMip *q=&p->mip[m];
  if(tx<0||ty<0||tx>=q->cols||ty>=q->trows)return false;
  const uint32_t k=(uint32_t)ty*q->cols+tx;uint8_t o[8];
  if(!read_at(p,q->offsets_at+4*k,o,8))return false;
  const uint32_t from=q->data+le32(o),end=q->data+le32(o+4);
  const int x0=tx*MAP_TILE,y0=q->first+ty*MAP_TILE;
  const int w=q->width-x0<MAP_TILE?q->width-x0:MAP_TILE,h=q->first+q->rows-y0<MAP_TILE?q->first+q->rows-y0:MAP_TILE;
  if(end-from==2){
    uint8_t f[2];
    if(!read_at(p,from,f,2))return false;
    memset(out,f[0]<<4|f[1],MAP_TILE*MAP_TILE);return true;
  }
  Reader r={p,from,end,0,0,buffer};
  uint32_t x=0;for(int i=0;i<4;i++)x|=(uint32_t)next_byte(&r)<<(8*i);
  #define CELL(cx,cy) (((cx)<0||(cy)<0||(cx)>=w||(cy)>=h)?0:out[(cy)*MAP_TILE+(cx)])
  for(int cy=0;cy<h;cy++)for(int cx=0;cx<w;cx++){
    const int lc=(CELL(cx-1,cy)>>4)|(CELL(cx,cy-1)>>4)<<1|(CELL(cx-1,cy-1)>>4)<<2|(CELL(cx+1,cy-1)>>4)<<3;
    const uint32_t f=p->land_freq[lc];uint32_t slot=x&(TOTAL-1);
    const int l=slot<TOTAL-f?0:1;const uint32_t start=l?TOTAL-f:0,freq=l?f:TOTAL-f;
    x=freq*(x>>SCALE_BITS)+slot-start;while(x<RANS_L)x=(x<<8)|next_byte(&r);
    const int c=(l*L+(CELL(cx-1,cy)&15))*L+(CELL(cx,cy-1)&15);
    const uint16_t *cum=p->cum[c];if(!cum)return false;
    slot=x&(TOTAL-1);int s=0;while(cum[s+1]<=slot)s++;
    x=(uint32_t)(cum[s+1]-cum[s])*(x>>SCALE_BITS)+slot-cum[s];while(x<RANS_L)x=(x<<8)|next_byte(&r);
    out[cy*MAP_TILE+cx]=(uint8_t)(l<<4|s);
  }
  #undef CELL
  // Beyond the mip's edge, sea at the lowest level.
  for(int cy=0;cy<MAP_TILE;cy++)for(int cx=0;cx<MAP_TILE;cx++)if(cx>=w||cy>=h)out[cy*MAP_TILE+cx]=0;
  return true;
}
