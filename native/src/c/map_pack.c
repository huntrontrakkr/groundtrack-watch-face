// The map pack's decoder. Mirrors decodeStrip in tools/relief-pack.mjs step
// for step; integer arithmetic only, so both decode identical cells.
#include "map_pack.h"
#include <string.h>

#define SCALE_BITS 12
#define TOTAL (1u<<SCALE_BITS)
#define RANS_L (1u<<23)

static uint16_t le16(const uint8_t *p){return (uint16_t)(p[0]|p[1]<<8);}
static uint32_t le32(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}

// Sequential reads through a small buffer.
typedef struct {const MapPack *pack;uint8_t *buffer;uint32_t at,filled_from,filled;} Stream;
static uint8_t next_byte(Stream *s){
  if(s->at<s->filled_from||s->at>=s->filled_from+s->filled){
    s->filled_from=s->at;s->filled=(uint32_t)s->pack->read(s->pack->source,s->at,s->buffer,256);
    if(!s->filled)return 0;
  }
  return s->buffer[s->at++ - s->filled_from];
}
static bool read_at(const MapPack *p,uint32_t at,uint8_t *out,size_t n){return p->read(p->source,at,out,n)==n;}

bool map_pack_open(MapPack *p,MapReadFn read,void *source){
  memset(p,0,sizeof *p);p->read=read;p->source=source;
  uint8_t h[16];
  if(!read_at(p,0,h,16)||memcmp(h,"GTM1",4))return false;
  if(le16(h+4)!=MAP_WIDTH)return false;
  p->first=le16(h+6);p->rows=le16(h+8);p->strip=h[10];p->radius=h[11];p->levels=h[12];
  const unsigned alphabet=2u*p->radius+2,contexts=2u*p->levels;
  if(!p->strip||!p->levels||p->levels>MAP_MAX_ERROR_LEVELS||alphabet>MAP_MAX_ALPHABET)return false;
  uint32_t at=14;
  if(!read_at(p,at,p->thresholds,p->levels-1))return false;
  at+=p->levels-1;
  uint8_t b[2*MAP_MAX_ALPHABET];
  for(int c=0;c<2;c++){if(!read_at(p,at,b,12))return false;for(int i=0;i<6;i++)p->weights[c][i]=(int16_t)le16(b+2*i);at+=12;}
  for(int i=0;i<64;i+=16){if(!read_at(p,at,b,32))return false;for(int k=0;k<16;k++)p->land_freq[i+k]=le16(b+2*k);at+=32;}
  for(unsigned c=0;c<contexts;c++){
    if(!read_at(p,at,b,2*alphabet))return false;
    p->cum[c][0]=0;for(unsigned s=0;s<alphabet;s++)p->cum[c][s+1]=(uint16_t)(p->cum[c][s]+le16(b+2*s));
    if(p->cum[c][alphabet]!=TOTAL)return false;
    at+=2*alphabet;
  }
  p->strips=(uint16_t)((p->rows+p->strip-1)/p->strip);
  p->offsets_at=at;p->data=at+4u*(p->strips+1u);
  return true;
}

// The causal neighbourhood, as neighbours() in the encoder. r0, r1, r2 are
// the current row and the one and two above; dy_max how many are in the strip.
static void neighbours(const uint8_t *r0,const uint8_t *r1,const uint8_t *r2,int x,int dy_max,int nb[6]){
  const bool up=dy_max>=1,up2=dy_max>=2;
  const int w=x>0?r0[x-1]:up?r1[x]:0;
  const int n=up?r1[x]:w;
  nb[0]=w;nb[1]=n;
  nb[2]=x>0&&up?r1[x-1]:n;
  nb[3]=x<MAP_WIDTH-1&&up?r1[x+1]:n;
  nb[4]=x>1?r0[x-2]:w;
  nb[5]=up2?r2[x]:n;
}
static int predict(const int16_t *w,const int nb[6]){
  int32_t s=128;for(int i=0;i<6;i++)s+=w[i]*nb[i];
  s>>=8;return s<0?0:s>255?255:s;
}

bool map_pack_rows(const MapPack *p,MapWork *wk,int row0,int row1,MapRowFn fn,void *context){
  if(row0<p->first)row0=p->first;
  if(row1>p->first+p->rows)row1=p->first+p->rows;
  if(row0>=row1)return true;
  const int esc=2*p->radius+1;
  int k=(row0-p->first)/p->strip;
  Stream s={p,wk->buffer,0,0,0};
  for(int y=k*p->strip;y<row1-p->first;k++){
    uint8_t o[4];
    if(!read_at(p,p->offsets_at+4u*k,o,4))return false;
    s.at=p->data+le32(o);
    uint32_t x=0;for(int i=0;i<4;i++)x|=(uint32_t)next_byte(&s)<<(8*i);
    const int y0=y,end=y0+p->strip<p->rows?y0+p->strip:p->rows;
    for(;y<end&&y<row1-p->first;y++){
      const int dy_max=y-y0<2?y-y0:2,cur=(y-y0)%3;
      uint8_t *r0=wk->relief[cur],*r1=wk->relief[(cur+2)%3],*r2=wk->relief[(cur+1)%3];
      uint8_t *l0=wk->land[cur],*l1=wk->land[(cur+2)%3],*l2=wk->land[(cur+1)%3];
      uint8_t *e0=wk->err[(y-y0)&1],*e1=wk->err[(y-y0+1)&1];
      for(int c=0;c<MAP_WIDTH;c++){
        // Land, from six neighbouring land bits.
        #define LB(row,xx,dy) ((dy)>dy_max||(xx)<0||(xx)>=MAP_WIDTH?0:(row)[xx])
        const int lctx=LB(l0,c-1,0)|LB(l1,c,1)<<1|LB(l1,c-1,1)<<2|LB(l1,c+1,1)<<3|LB(l0,c-2,0)<<4|LB(l2,c,2)<<5;
        #undef LB
        const uint32_t f=p->land_freq[lctx];
        uint32_t slot=x&(TOTAL-1);
        int cls;uint32_t start,freq;
        if(slot<TOTAL-f){cls=0;start=0;freq=TOTAL-f;}else{cls=1;start=TOTAL-f;freq=f;}
        x=freq*(x>>SCALE_BITS)+slot-start;while(x<RANS_L)x=(x<<8)|next_byte(&s);
        l0[c]=(uint8_t)cls;
        // Relief, predicted, its difference coded by land and error energy.
        int nb[6];neighbours(r0,r1,r2,c,dy_max,nb);
        #define EB(row,xx,dy) ((dy)>dy_max||(xx)<0||(xx)>=MAP_WIDTH?0:(row)[xx])
        const int sum=EB(e0,c-1,0)+EB(e1,c,1)+EB(e1,c-1,1)+EB(e1,c+1,1)+(EB(e0,c-2,0)>>1);
        #undef EB
        const int act=2*sum+(nb[0]>nb[2]?nb[0]-nb[2]:nb[2]-nb[0])+(nb[1]>nb[2]?nb[1]-nb[2]:nb[2]-nb[1])+(nb[3]>nb[1]?nb[3]-nb[1]:nb[1]-nb[3]);
        int lv=0;while(lv<p->levels-1&&act>=p->thresholds[lv])lv++;
        const uint16_t *cum=p->cum[cls*p->levels+lv];
        slot=x&(TOTAL-1);
        // The symbol whose range holds the slot: binary search.
        int lo=0,hi=esc;
        while(lo<hi){const int mid=(lo+hi+1)>>1;if(cum[mid]<=slot)lo=mid;else hi=mid-1;}
        x=(uint32_t)(cum[lo+1]-cum[lo])*(x>>SCALE_BITS)+slot-cum[lo];while(x<RANS_L)x=(x<<8)|next_byte(&s);
        const int pr=predict(p->weights[cls],nb);int v;
        if(lo==esc){
          int nib[2];
          for(int i=0;i<2;i++){slot=x&(TOTAL-1);nib[i]=(int)(slot>>8);x=256u*(x>>SCALE_BITS)+slot-((uint32_t)nib[i]<<8);while(x<RANS_L)x=(x<<8)|next_byte(&s);}
          v=nib[0]|nib[1]<<4;
        }else v=pr+lo-p->radius;
        r0[c]=(uint8_t)v;
        const int e=v-pr<0?pr-v:v-pr;e0[c]=(uint8_t)(e>255?255:e);
      }
      if(y+p->first>=row0)fn(context,y+p->first,r0,l0);
    }
  }
  return true;
}
