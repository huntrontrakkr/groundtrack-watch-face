// Groundtrack Enroute, native core. See enroute_core.h. Each step mirrors
// src/enroute-render.js closely enough to match it pixel for pixel.
#include "enroute_core.h"
#include "departure_font.h"
#include "fmath.h"
#include "face.h"
// A Fuller sheet, on a face that can draw one.
#define ROLLED(s) (FACE_ROLL&&(!FACE_CHART||(s)->fuller))
#include <math.h>
#include <string.h>
#include <stdlib.h>

#define W ENR_W
#define H ENR_H
// sin(-0.833°) and sin(-6°), the browser's own values.
static const enr_real SUNRISE_SINE=-0.014538080502496949,CIVIL_TWILIGHT_SINE=-0.10452846326765346;
static const uint8_t BAYER[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
// Layers over the ground, from the class plane's high nibble: the network's
// grid is drawn over home's acquisition circle; early knockouts and ink lie
// under the route's bold line, late ones over the body.
enum {L_PLAIN,L_CONTOUR,L_COAST,L_SHELF,L_WATERLINE,L_CLEARED,L_GRID,L_ROUTE,L_INK,L_MARK,L_SPACE_INK,L_NET_GRID,L_EARLY_CLEARED,L_EARLY_INK,L_LATE_CLEARED,L_LATE_INK};
// Ground classes, from the low nibble.
enum {G_WATER,G_LAND,G_SPACE,G_TINT0,G_DEPTH0=8};

// JavaScript's Math.round: half-way cases round up.
static int js_round(enr_real v){return (int)f_floor(v+(enr_real)0.5);}
static int sign(enr_real v){return (v>0)-(v<0);}

typedef struct {
  const EnrScene *s;
  const EnrMinute *m;
  uint8_t *frame;
  int stride;
  // While the base is drawn, rows y-1, y and y+1 decoded.
  const uint8_t *rows[3];
  int row_y;
  // Measuring: plots only widen this box (x0, y0, x1, y1), drawing nothing.
  bool measure;int box[4];
  // The minute's night (below).
  const struct Night *n;
} Ctx;

// Night's thresholds are decided in 2^30 fixed point first: the Sun's height
// at a pixel is within a few units of row_cos*P(x) + row_sin*u2 (on a Fuller
// sheet, of the grid's integer height), and only a pixel within MARGIN of a
// threshold takes the double sums, whose bits the browser's decide. The fast
// sums cost a few integer instructions; the doubles, in software on the
// watch, a few hundred.
#define Q30 1073741824.0
// ENR_EXACT (for tests) takes the double sums everywhere.
#ifdef ENR_EXACT
#define MARGIN ((int64_t)1<<40)
#else
#define MARGIN 64
#endif
#define BLOCKS ((W+15)/16)
static int32_t q30(enr_real v){return (int32_t)(v*(enr_real)Q30);}
// One minute's night: on the cylindrical charts P(x) in Q30 for each column
// and its least and greatest in each 16-pixel block; on a Fuller sheet the
// Sun in each tile's face frame, and a few rows of heights (FULLER_NONE
// off the net).
#define FULLER_NONE INT32_MIN
#define NIGHT_ROWS 3
typedef struct Night {
  const EnrMinute *m;
  // A draw is cylindrical or Fuller: these tables are never used together.
  // Keep h outside the union so cylindrical draws can still free its NULL.
  union {
    struct {int32_t p[ENR_W],u2,lo[BLOCKS],hi[BLOCKS];};
    struct {int32_t sun[ENR_TILES][3];int held[NIGHT_ROWS];uint8_t have[NIGHT_ROWS][ENR_W/8];};
  };
  int32_t (*h)[ENR_W];   // NIGHT_ROWS rows, a Fuller sheet's only
} Night;
// Lettering and leaders go through one list of pixels, drawn one at a
// time. The longest is a satellite's pass line: 24 characters of at most 24
// pixels each.
typedef EnrPx Px;
#define SCRATCH 640
// The minute renderer's working memory, taken for each drawing only: a
// chart is built while none is drawn, and has it then. Two nights: the
// minute drawn and, drawing over the last minute, that one.
// Taken in pieces of a few KB each (the heap after a Fuller build is small
// and broken up): the masks only when drawing over the last minute, the
// Fuller heights only for a Fuller sheet, the class cache if there is room.
#define CACHE_ROWS 16
#define DIGITS 128
typedef struct {
  // The pixel list and the two nights, each its own piece (2.5 and 2.8
  // KB: after a Fuller build no free stretch may hold the whole).
  // (Past the list's SCRATCH pixels, DIGITS more for the flag's minute; the
  // minute's boxes and a turned row lie here too: the watch's stack is
  // 2 KB, the system's own calls on it as well.)
  Px *scratch_px;uint8_t window[3][ENR_W];
  int boxes[4*(3+16)];uint8_t turned[ENR_W];
  uint64_t *mask,*nmask;
  #define TILE_ROWS 4
  uint8_t tiles[TILE_ROWS][ENR_W];int tiles_y[TILE_ROWS],tiles_next;
  // Decoded rows for class_at outside the base pass's window, for
  // lettering, which comes back to the same rows glyph after glyph
  // (cache_rows decodes a pixel list's rows first); other lookups walk
  // their row's runs. slot_of: a row's slot, or 255.
  uint8_t (*cache)[ENR_W];int cache_y[CACHE_ROWS],cache_next;uint8_t slot_of[ENR_H];
  Night *night;
} Work;
static Work *work;
#define scratch (work->scratch_px)
static __attribute__((noinline)) void night_ready(const EnrScene *s,Night *n,const EnrMinute *m){
  if(n->m==m)return;
  n->m=m;for(int k=0;k<NIGHT_ROWS;k++)n->held[k]=-100;
  if(ROLLED(s)){
    const EnrFuller *f=s->fuller;const enr_real *u=m->sun;
    for(int t=0;t<f->tile_count;t++){const double *b=f->bases[f->tile_face[t]];for(int k=0;k<3;k++){const double v=(u[0]*b[3*k]+u[1]*b[3*k+1]+u[2]*b[3*k+2])*32768,r=f_floor(v);n->sun[t][k]=(int32_t)(v-r>=0.5?r+1:r);}}
    return;
  }
  for(int b=0;b<BLOCKS;b++){n->lo[b]=INT32_MAX;n->hi[b]=INT32_MIN;}
  for(int x=0;x<W;x++){const int32_t p=q30(s->col_cos[x]*m->sun[0]+s->col_sin[x]*m->sun[1]);n->p[x]=p;if(p<n->lo[x>>4])n->lo[x>>4]=p;if(p>n->hi[x>>4])n->hi[x>>4]=p;}
  n->u2=q30(m->sun[2]);
}
static int64_t floor_div(int64_t v,int d){return v>=0?v/d:-((-v+d-1)/d);}
// fuller-ground.js: a pixel's height on tile t from the three grid points
// round it, in integers, as h / 2^29.
static int32_t fuller_point(const EnrScene *s,const Night *n,int t,int x,int y){
  const EnrFuller *f=s->fuller;const int N=ENR_NIGHT_N,F=ENR_FULLER_N;
  const int32_t *q=f->tile_grid[t];const int64_t qx=4*x+2,qy=4*y+2;
  int64_t a=floor_div(q[0]+q[1]*qx+q[2]*qy,256),b=floor_div(q[3]+q[4]*qx+q[5]*qy,256);
  // The place on the grid, held to the face; then on the night's grid.
  a=a<0?0:a>F*256?F*256:a;b=b<0?0:b>F*256-a?F*256-a:b;
  a/=F/N;b/=F/N;
  const int ia=(int)(a/256),ib=(int)(b/256),fa=(int)(a-ia*256),fb=(int)(b-ib*256);
  int i0,w0,i1=0,w1=0,i2=0,w2=0;
  #define GI(aa,bb) ((aa)*(N+1)-(aa)*((aa)-1)/2+(bb))
  if(ia+ib>=N){i0=GI(ia,ib);w0=256;}
  else if(fa+fb<=256){i0=GI(ia,ib);w0=256-fa-fb;i1=GI(ia+1,ib);w1=fa;i2=GI(ia,ib+1);w2=fb;}
  else{i0=GI(ia+1,ib+1);w0=fa+fb-256;i1=GI(ia,ib+1);w1=256-fa;i2=GI(ia+1,ib);w2=256-fb;}
  #undef GI
  const int16_t *d=f->dirs;int64_t h=0;
  for(int k=0;k<3;k++){const int32_t c=(d[i0*3+k]*w0+d[i1*3+k]*w1+d[i2*3+k]*w2)>>8;h+=(int64_t)c*n->sun[t][k];}
  return (int32_t)h;
}
// Which tile each pixel of a row lies on (tile + 1; 0 off the net).
static const uint8_t *row_tiles(const EnrScene *s,int y){
  for(int k=0;k<TILE_ROWS;k++)if(work->tiles_y[k]==y)return work->tiles[k];
  const int k=work->tiles_next;work->tiles_next=(k+1)%TILE_ROWS;
  const EnrFuller *f=s->fuller;const uint8_t *p=f->tile_piece[f->tile_offset[y]/ENR_RUN_PIECE]+f->tile_offset[y]%ENR_RUN_PIECE;
  for(int x=0;x<W;p+=2)for(int j=0;j<p[0]&&x<W;j++)work->tiles[k][x++]=p[1];
  work->tiles_y[k]=y;return work->tiles[k];
}
// A pixel's height, computed when first asked and kept with its row's
// (NIGHT_ROWS rows at a time).
static int32_t fuller_h(const EnrScene *s,Night *n,int x,int y){
  int slot=-1;
  for(int k=0;k<NIGHT_ROWS;k++)if(n->held[k]==y){slot=k;break;}
  if(slot<0){
    // Keep the rows either side of y; replace the farthest.
    slot=0;for(int k=1;k<NIGHT_ROWS;k++){const int dk=abs(n->held[k]-y),ds=abs(n->held[slot]-y);if(dk>ds)slot=k;}
    n->held[slot]=y;memset(n->have[slot],0,sizeof n->have[slot]);
  }
  if(n->have[slot][x>>3]>>(x&7)&1)return n->h[slot][x];
  const uint8_t t=row_tiles(s,y)[x];
  const int32_t h=t?fuller_point(s,n,t-1,x,y):FULLER_NONE;
  n->h[slot][x]=h;n->have[slot][x>>3]|=(uint8_t)(1<<(x&7));return h;
}
// A pixel's height in Q30 by the fast sums (INT64_MIN off a Fuller net).
static int64_t fast_h(const Ctx *c,int x,int y){
  const EnrScene *s=c->s;
  if(ROLLED(s)){const int32_t h=fuller_h(s,(Night *)c->n,x,y);return h==FULLER_NONE?INT64_MIN:(int64_t)h<<1;}
  return ((int64_t)s->row_q[y][0]*c->n->p[x]+(int64_t)s->row_q[y][1]*c->n->u2)>>30;
}
// The same by the doubles, whose bits the browser's decide.
static enr_real exact_h(const Ctx *c,int x,int y){
  const EnrScene *s=c->s;const enr_real *u=c->n->m->sun;
  if(ROLLED(s))return (enr_real)fuller_h(s,(Night *)c->n,x,y)/536870912.0;
  return s->row_cos[y]*s->col_cos[x]*u[0]+s->row_cos[y]*s->col_sin[x]*u[1]+s->row_sin[y]*u[2];
}
static void touch(Ctx *c,int x,int y){
  if(x<c->box[0])c->box[0]=x;
  if(y<c->box[1])c->box[1]=y;
  if(x>c->box[2])c->box[2]=x;
  if(y>c->box[3])c->box[3]=y;
}

// A row's runs (their piece, and where they start in it).
static const uint8_t *row_runs_of(const EnrScene *s,int y){return s->run_piece[s->row_offset[y]/ENR_RUN_PIECE]+s->row_offset[y]%ENR_RUN_PIECE;}
// A pixel's class: from the decoded rows when they hold it, otherwise by
// walking its row's runs.
static void decode_row(const EnrScene *s,int y,uint8_t *out){
  const uint8_t *p=row_runs_of(s,y);
  for(int x=0;x<W;){
    if(p[0]>ENR_RUN_MAX){const int n=p[0]-ENR_RUN_MAX;for(int k=1;k<=n&&x+1<W;k++){out[x++]=p[k]&15;out[x++]=p[k]>>4;}p+=n+1;}
    else{if(!p[0])break;for(int k=0;k<p[0]&&x<W;k++)out[x++]=p[1];p+=2;}
  }
}
// The class at x along a row's runs.
static uint8_t run_class(const uint8_t *p,int x){
  for(int at=0;at<W;){
    if(p[0]>ENR_RUN_MAX){const int n=p[0]-ENR_RUN_MAX;if(x<at+2*n){const uint8_t b=p[1+((x-at)>>1)];return (x-at)&1?b>>4:b&15;}at+=2*n;p+=n+1;}
    else{if(!p[0])break;at+=p[0];if(x<at)return p[1];p+=2;}
  }
  return G_SPACE;
}
// A pixel's class: from the decoded rows when they hold it, from the cache
// when it holds its row, otherwise by walking its row's runs.
static uint8_t class_at(const Ctx *c,int x,int y){
  if(c->rows[1]&&y>=c->row_y-1&&y<=c->row_y+1&&c->rows[y-c->row_y+1])return c->rows[y-c->row_y+1][x];
  const int slot=work->slot_of[y];if(slot!=255)return work->cache[slot][x];
  return run_class(row_runs_of(c->s,y),x);
}
// The rows of a pixel list decoded into the cache (lettering reads each of
// its rows many times over).
static void cache_rows(const EnrScene *s,const Px *px,int n){
  if(!work->cache)return;
  for(int i=0;i<n;i++){
    const int y=px[i].y;if(y<0||y>=H||work->slot_of[y]!=255)continue;
    const int k=work->cache_next;work->cache_next=(k+1)%CACHE_ROWS;
    if(work->cache_y[k]>=0)work->slot_of[work->cache_y[k]]=255;
    decode_row(s,y,work->cache[k]);work->cache_y[k]=y;work->slot_of[y]=(uint8_t)k;
  }
}
static bool has_dir(const Ctx *c,int x,int y){return (class_at(c,x,y)&15)!=G_SPACE;}
// Whether the Sun's height at a pixel is at least a threshold (level, and
// its fixed-point value q).
static bool above(const Ctx *c,int x,int y,enr_real level,int32_t q){
  const int64_t h=fast_h(c,x,y);
  if(h>=(int64_t)q+MARGIN)return true;
  if(h<(int64_t)q-MARGIN)return false;
  return exact_h(c,x,y)>=level;
}
// Day, dusk or night as flat zones, dithered through civil twilight.
static int zone(const Ctx *c,int x,int y){
  if(!(c->s->flags&ENR_NIGHT_ZONES)||!has_dir(c,x,y))return 0;
  const EnrScene *s=c->s;const int b=BAYER[(y&3)*4+(x&3)];
  const int64_t h=fast_h(c,x,y);
  const int32_t *q=s->night_q;
  // Clear of every threshold that matters here: decided by the fast sum.
  if(h>=(int64_t)q[0]+MARGIN)return 0;
  if(h<(int64_t)q[1]-MARGIN)return 2;
  if(h<(int64_t)q[0]-MARGIN&&h>=(int64_t)q[1]+MARGIN&&(h<(int64_t)q[2+b]-MARGIN||h>=(int64_t)q[2+b]+MARGIN))return h<(int64_t)q[2+b]?2:1;
  const enr_real a=exact_h(c,x,y);
  if(a>=SUNRISE_SINE)return 0;
  if(a<CIVIL_TWILIGHT_SINE)return 2;
  const enr_real t=(SUNRISE_SINE-a)/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);
  return t*16>b+(enr_real)0.5?2:1;
}
// The paper screen's dot: where t > 0 and t*4 > the pixel's Bayer value.
static bool screen_dot(const Ctx *c,int x,int y){
  const int b=BAYER[(y&3)*4+(x&3)];const int64_t h=fast_h(c,x,y),q=c->s->night_q[18+b];
  if(h<q-MARGIN)return true;
  if(h>=q+MARGIN)return false;
  enr_real t=(SUNRISE_SINE-exact_h(c,x,y))/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);t=t<0?0:t>1?1:t;return t>0&&b<t*4;
}
static int zone_at(const Ctx *c,int x,int y){
  x=x<0?0:x>W-1?W-1:x;y=y<0?0:y>H-1?H-1:y;
  return zone(c,x,y);
}
static uint8_t base_color(const EnrScene *s,int ground,int z){
  // On the lattice, knockouts and what is cleared are the plain ground.
  if(s->lattice)return s->space;
  if(ground==G_WATER)return s->zoned[ENR_WATER][z];
  if(ground==G_LAND)return s->zoned[ENR_LAND][z];
  if(ground==G_SPACE)return s->space;
  if(ground<G_DEPTH0)return s->tints[ground-G_TINT0];
  return s->depths[ground-G_DEPTH0];
}
// The lattice's dot at a pixel: in each 4x4 cell a dot whose size grows
// with the height's tint (2x2, a plus, 3x3); water a single point; between
// the dots, the plain ground.
static const uint16_t LATTICE_DOT[4]={0x0660,0x0672,0x0777,0x0020};  // rows of the cell, 4 bits each: tint 0, 1, 2+, water
// The band patterns, each band's lit pixels in a 4x4 cell (bit (y&3)*4+(x&3)):
// density dots (ordered, sparse to solid); hatching, densest in deep
// shadow (as with shaded relief, band 0) to none in full light; raster
// rows, more of them as the band rises. (The mesh is a line every 8 px.)
static const uint16_t PATTERN[3][5]={{0x0405,0x8525,0xA5A7,0xAFAF,0xFFFF},{0x96F9,0x9669,0x1248,0x0208,0x0000},{0x000F,0x0F0F,0x0F0F,0x0FFF,0xFFFF}};
static uint8_t ground_color(const EnrScene *s,int ground,int z,int x,int y){
  if(s->pattern&&ground>=G_TINT0&&ground<G_DEPTH0){
    const int k=ground-G_TINT0;
    return (s->pattern==4?(x&7)&&(y&7):PATTERN[s->pattern-1][k]>>((y&3)*4+(x&3))&1)?s->tints[k]:s->zoned[ENR_LAND][z];
  }
  if(s->wash&&ground<2&&s->tints[ground]&&((x+y)&3)&&!z)return s->tints[ground];
  if(!s->lattice)return base_color(s,ground,z);
  if(ground==G_SPACE)return s->space;
  const int k=ground==G_WATER||ground>=G_DEPTH0?3:ground==G_LAND?0:ground-G_TINT0>2?2:ground-G_TINT0;
  if(!(LATTICE_DOT[k]>>((3-(y&3))*4+(3-(x&3)))&1))return s->space;
  if(k==3)return s->zoned[ENR_WATER][z];
  return z||ground==G_LAND?s->zoned[ENR_LAND][z]:s->tints[ground-G_TINT0];
}
// Ink drawn after the body: the space ink over space, home's mark round
// home, the ink elsewhere.
static bool home_mark(const EnrScene *s,int x,int y){
  for(int k=0;k<s->mark_count;k++)if(s->marks[k][0]==x&&s->marks[k][1]==y)return true;
  return false;
}
static uint8_t late_ink(const EnrScene *s,int ground,int x,int y,int z){
  if(home_mark(s,x,y))return s->zoned[ENR_MARK][z];
  return ground==G_SPACE?s->space_ink:s->zoned[ENR_INK][z];
}
// (The sliding band is the world round: its columns wrap.)
static int sliding_x(const EnrScene *s,int x){return FACE_WORLD&&(s->flags&ENR_SLIDING_WORLD)?((x%W)+W)%W:x;}
// (Only the band's rows come round: what is drawn in the panel above them,
// the tape's labels a little past its ends say, is cut off at the edge.)
#define SLIDE_TOP 67
#define PLOT_X(c,x,y) ((y)>=SLIDE_TOP?sliding_x((c)->s,(x)):(x))
static void plot(Ctx *c,int x,int y,uint8_t color){
  x=PLOT_X(c,x,y);
  if(x<0||y<0||x>=W||y>=H)return;
  if(c->measure){touch(c,x,y);return;}
  c->frame[y*c->stride+x]=color;
}
// A knockout: plain ground, without night's screen.
static void clear(Ctx *c,int x,int y){
  x=PLOT_X(c,x,y);
  if(x<0||y<0||x>=W||y>=H)return;
  if(c->measure){touch(c,x,y);return;}
  plot(c,x,y,base_color(c->s,class_at(c,x,y)&15,zone(c,x,y)));
}

// Where a minute can change the base: blocks of 16 pixels, row by row. A
// pixel's Sun height is row_cos*P(x) + row_sin*u2 with P(x) = col_cos*u0 +
// col_sin*u1, so over a block it lies between the row's values at the
// block's least and greatest P (row_cos is never negative). On a Fuller
// sheet the height along a row's run on one tile is a convex mix of its
// grid points' heights, which lie within the scene's slack of the run's
// end pixels' (enr_ready). A block whose range is day (at or over sunrise)
// or night (under civil twilight) can't change; the rest can.
// A block's night at one minute: 0 all day, 1 all night, 2 in between.
static int block_state(const Ctx *c,int y,int b){
  const EnrScene *s=c->s;const int32_t *q=s->night_q;int64_t lo,hi;
  if(ROLLED(s)){
    const uint8_t *tiles=row_tiles(s,y);const int x0=b*16,x1=x0+15<W?x0+15:W-1;
    lo=INT64_MAX;hi=INT64_MIN;
    for(int x=x0;x<=x1;){
      const int t=tiles[x];if(!t){x++;continue;}
      int e=x;while(e<x1&&tiles[e+1]==t)e++;
      const int64_t a=(int64_t)fuller_h(s,(Night *)c->n,x,y)<<1,z=(int64_t)fuller_h(s,(Night *)c->n,e,y)<<1;
      lo=a<lo?a:lo;hi=a>hi?a:hi;lo=z<lo?z:lo;hi=z>hi?z:hi;
      x=e+1;
    }
    if(lo>hi)return 0;
    lo-=s->fuller->slack;hi+=s->fuller->slack;
  }else{
    lo=((int64_t)s->row_q[y][0]*c->n->lo[b]+(int64_t)s->row_q[y][1]*c->n->u2)>>30;
    hi=((int64_t)s->row_q[y][0]*c->n->hi[b]+(int64_t)s->row_q[y][1]*c->n->u2)>>30;
  }
  return lo>=(int64_t)q[0]+MARGIN?0:hi<(int64_t)q[1]-MARGIN?1:2;
}

// The hour's chart in the plate's colors, with night laid over the ground.
static bool crosses(const Ctx *c,int x,int y,enr_real level,int32_t q){
  const int nx[4]={x-1,x+1,x,x},ny[4]={y,y,y-1,y+1};const bool here=above(c,x,y,level,q);
  for(int k=0;k<4;k++){
    if(nx[k]<0||nx[k]>=W||ny[k]<0||ny[k]>=H||!has_dir(c,nx[k],ny[k]))continue;
    if(above(c,nx[k],ny[k],level,q)!=here)return true;
  }
  return false;
}
// The night a symbol's ink takes where the browser inks it by one point's
// (Console's ink changes with night): the rose, hexagon and reporting
// point (ink drawn with the route) by their station's, a network station's
// ring by its centre's; the rest, their own pixel's.
static int ink_zone(const Ctx *c,int x,int y,bool route_ink,int z){
  const EnrScene *s=c->s;
  if(route_ink){
    const int d0=(x-s->c0[0])*(x-s->c0[0])+(y-s->c0[1])*(y-s->c0[1]),d1=(x-s->c1[0])*(x-s->c1[0])+(y-s->c1[1])*(y-s->c1[1]);
    // The reporting point stands a pixel above its station, and is inked by
    // its own centre.
    return d0<=d1?zone_at(c,s->c0[0],s->c0[1]):zone_at(c,s->c1[0],s->c1[1]-1);
  }
  for(int k=0;k<s->station_count;k++){const int dx=x-s->stations[k][0],dy=y-s->stations[k][1];if(dx*dx+dy*dy<=5)return zone_at(c,s->stations[k][0],s->stations[k][1]);}
  return z;
}
// An event's triangle, inked (after the body) by its fix's night where the
// ink changes with night; other ink drawn after the body, by its own.
static int fix_zone(const Ctx *c,int x,int y,int z){
  const EnrScene *s=c->s;
  if(!(s->flags&ENR_NIGHT_ZONES)||(s->zoned[ENR_INK][0]==s->zoned[ENR_INK][1]&&s->zoned[ENR_INK][0]==s->zoned[ENR_INK][2]))return z;
  for(int k=0;k<s->event_count;k++){const int dx=x-s->events[k].x,dy=y-s->events[k].y;if(dx>=-4&&dx<=4&&dy>=-4&&dy<=2)return zone_at(c,s->events[k].x,s->events[k].y);}
  return z;
}
// What night makes of a pixel, as an integer: its zone, the screen's dot,
// and whether it is above sunrise and above civil twilight (the drawn
// terminator reads those of its neighbours).
static int night_key(const Ctx *c,int x,int y){
  const EnrScene *s=c->s;int key=0;
  if(s->flags&ENR_NIGHT_ZONES)key=zone(c,x,y);else key=screen_dot(c,x,y)?1:0;
  if(s->flags&ENR_TERMINATOR)key|=(above(c,x,y,SUNRISE_SINE,s->night_q[0])?4:0)|(above(c,x,y,CIVIL_TWILIGHT_SINE,s->night_q[1])?8:0);
  return key;
}
// A pixel of the base, given its class and its block's night (known: 0 day,
// 1 night, 2 to be worked out).
static uint8_t base_pixel(const Ctx *c,int x,int y,uint8_t cls,int known,bool anchored){
  const EnrScene *s=c->s;const bool zones=s->flags&ENR_NIGHT_ZONES,terminator=s->flags&ENR_TERMINATOR;
  const int ground=cls&15,layer=cls>>4;
  // Known night: zone 0 or 2 (none without a direction, over space).
  const bool dir=ground!=G_SPACE;
  const int z=known==2?zone(c,x,y):!zones||!dir?0:known==1?2:0;
  uint8_t col;
  if(layer<=L_WATERLINE){
    col=layer==L_CONTOUR?s->zoned[ENR_CONTOUR][z]:layer==L_COAST?s->zoned[ENR_COAST][z]:layer==L_SHELF?s->zoned[ENR_SHELF][z]:layer==L_WATERLINE?s->waterline:ground_color(s,ground,z,x,y);
    if((s->flags&ENR_SCAN)&&z&&y%(z==2?2:4)==1)col=s->space;
    if(terminator&&dir){
      if(known==2&&((x+y)>>1)%3!=2&&crosses(c,x,y,SUNRISE_SINE,s->night_q[0]))col=s->terminator;
      else if(known==2&&(x+y)%3==0&&crosses(c,x,y,CIVIL_TWILIGHT_SINE,s->night_q[1]))col=s->terminator;
      else if((s->flags&ENR_NIGHT_DOTS)&&z==2&&x%4==0&&y%4==((x>>2)&1)*2)col=s->night_dots;
    }
    if(!zones&&dir&&(known==2?screen_dot(c,x,y):known==1&&BAYER[(y&3)*4+(x&3)]<4))col=s->screen;
  }
  else if(layer==L_CLEARED||layer==L_EARLY_CLEARED||layer==L_LATE_CLEARED)col=base_color(s,ground,z);
  else if(layer==L_GRID||layer==L_NET_GRID)col=s->zoned[ENR_GRID][z];
  else if(layer==L_ROUTE)col=s->zoned[ENR_ROUTE][z];
  else if(layer==L_INK||layer==L_EARLY_INK)col=s->zoned[ENR_INK][anchored?ink_zone(c,x,y,layer==L_INK,z):z];
  else if(layer==L_MARK)col=s->zoned[ENR_MARK][z];
  else if(layer==L_SPACE_INK)col=s->space_ink;
  else col=late_ink(s,ground,x,y,anchored?fix_zone(c,x,y,z):z);
  return col;
}
// The four neighbours of a changed pixel drawn again: on a terminator plate
// their colour reads it. row: the decoded rows y-1, y, y+1.
static int neighbours_again(Ctx *c,uint8_t *const row[3],int x,int y,bool anchored){
  static const int NX[4]={-1,1,0,0},NY[4]={0,0,-1,1};int drawn=0;
  for(int k=0;k<4;k++){
    const int nx=x+NX[k],ny=y+NY[k];if(nx<0||nx>=W||ny<0||ny>=H)continue;
    const uint8_t cls=row[ny-y+1][nx];if((cls&15)==G_SPACE)continue;
    drawn++;c->frame[ny*c->stride+nx]=base_pixel(c,nx,ny,cls,2,anchored);
  }
  return drawn;
}
// The base: everywhere; or, with masks, whole in the 16-pixel blocks each
// row's mask marks and, in the blocks nmask marks, only the pixels whose
// night differs from the minute `from` drew (the frame holds that minute).
// Returns the pixels drawn.
static __attribute__((noinline)) int draw_base(Ctx *c,const uint64_t *mask,const uint64_t *nmask,const Night *from){
  const EnrScene *s=c->s;
  const bool zones=s->flags&ENR_NIGHT_ZONES,terminator=s->flags&ENR_TERMINATOR;
  const bool anchored=zones&&(s->zoned[ENR_INK][0]!=s->zoned[ENR_INK][1]||s->zoned[ENR_INK][0]!=s->zoned[ENR_INK][2]);
  // Rows y-1, y and y+1 decoded, and which rows they hold.
  uint8_t (*const window)[W]=work->window;int held[3]={-100,-100,-100},drawn=0;
  Ctx old=*c;old.n=from;
  for(int y=0;y<H;y++){
    if(mask&&!mask[y]&&!nmask[y])continue;
    uint8_t *row[3];
    for(int k=0;k<3;k++){
      const int want=y-1+k;row[k]=0;
      if(want<0||want>=H)continue;
      int slot=-1;for(int j=0;j<3;j++)if(held[j]==want)slot=j;
      if(slot<0){for(int j=0;j<3;j++)if(held[j]<y-1||held[j]>y+1){slot=j;break;}decode_row(s,want,window[slot]);held[slot]=want;}
      row[k]=window[slot];
    }
    c->rows[0]=row[0];c->rows[1]=row[1];c->rows[2]=row[2];c->row_y=y;old.rows[0]=row[0];old.rows[1]=row[1];old.rows[2]=row[2];old.row_y=y;
    const uint8_t *here=row[1];
    // Each block's night at this minute. Where a block is all day or all
    // night (and, for the drawn terminator, so is every block round it), a
    // pixel's own night is known without its Sun height: zone 0 or 2, no
    // screen or the full screen, no terminator. The rest take the sums.
    uint8_t known_row[BLOCKS];
    for(int b=0;b<BLOCKS;b++)known_row[b]=(uint8_t)block_state(c,y,b);
    if(terminator){
      uint8_t near[3][BLOCKS];
      for(int k=0;k<3;k++)for(int b=0;b<BLOCKS;b++){const int yy=y-1+k;near[k][b]=yy<0||yy>=H?known_row[b]:k==1?known_row[b]:(uint8_t)block_state(c,yy,b);}
      for(int b=0;b<BLOCKS;b++){
        int v=near[1][b];
        for(int k=0;k<3&&v!=2;k++)for(int db=-1;db<=1;db++){const int bb=b+db;if(bb<0||bb>=BLOCKS)continue;if(near[k][bb]!=v){v=2;break;}}
        known_row[b]=(uint8_t)v;
      }
    }
    for(int x=0;x<W;x++){
      const int b=x>>4;
      // The masks are in 4-pixel blocks: a moving part's box costs less.
      if(mask&&!(mask[y]>>(x>>2)&1)){
        if(!(nmask[y]>>(x>>2)&1)){x|=3;continue;}
        // Only where night changed since `from` in a way this pixel's colour
        // reads: its zone, where the class's colour varies with it, or a
        // scan line or an outline plate's dot falls here; the paper
        // screen's dot; and, on a terminator plate, its own sunrise and
        // twilight (its neighbours read those: they are drawn again too).
        const uint8_t cls=here[x];
        if((cls&15)==G_SPACE)continue;
        int matters=0;
        if(zones){if((s->zone_matters[cls>>3]>>(cls&7)&1)||((s->flags&ENR_SCAN)&&(y&1))||((s->flags&ENR_NIGHT_DOTS)&&x%4==0&&y%4==((x>>2)&1)*2))matters|=3;}
        else if((cls>>4)<=L_WATERLINE)matters|=1;
        if(terminator)matters|=12;
        if(!((night_key(&old,x,y)^night_key(c,x,y))&matters))continue;
        drawn++;c->frame[y*c->stride+x]=base_pixel(c,x,y,here[x],2,anchored);
        if(terminator)drawn+=neighbours_again(c,row,x,y,anchored);
        continue;
      }
      drawn++;
      c->frame[y*c->stride+x]=base_pixel(c,x,y,here[x],known_row[b],anchored);
      // A block drawn whole beside one change-tested: its changed pixels'
      // neighbours there read them too.
      if(terminator&&nmask&&(here[x]&15)!=G_SPACE&&night_key(&old,x,y)!=night_key(c,x,y))drawn+=neighbours_again(c,row,x,y,anchored);
    }
  }
  c->rows[0]=c->rows[1]=c->rows[2]=0;
  return drawn;
}

// The route behind the body is bold: a second pixel beside the fine line,
// where nothing drawn later in the hour covers it.
typedef void (*PixelFn)(Ctx *,int,int,void *);
static void segment(Ctx *c,int x,int y,int xx,int yy,PixelFn fn,void *arg){
  const int dx=abs(xx-x),sx=x<xx?1:-1,dy=-abs(yy-y),sy=y<yy?1:-1;int err=dx+dy;
  for(int n=0;n<4000;n++){fn(c,x,y,arg);if(x==xx&&y==yy)break;const int e=2*err;if(e>=dy){err+=dy;x+=sx;}if(e<=dx){err+=dx;y+=sy;}}
}
static void bold_pixel(Ctx *c,int x,int y,void *arg){
  // A heavy route's second pixel is the hour's; behind the body it takes
  // a third, on the other side. (The sliding band's columns wrap.)
  const bool steep=*(bool *)arg,heavy=FACE_ROLL&&c->s->heavy;x=sliding_x(c->s,x);const int bx=sliding_x(c->s,steep?(heavy?x-1:x+1):x),by=steep?y:(heavy?y+1:y-1);
  if(bx<0||by<0||bx>=W||by>=H)return;
  // (On the world band, within the band: the builder's route stops there.)
  if(VIEW_IS_WORLD(c->s->view)&&(by<c->s->height_baseline+6||by>H-10))return;
  const int layer=class_at(c,bx,by)>>4;
  // Only what was drawn before the route (ground, grid, the network's ink
  // and knockouts, a one-ink plate's casing) lies under the bold line.
  if(layer<=L_WATERLINE||layer==L_GRID||layer==L_NET_GRID||layer==L_EARLY_CLEARED||layer==L_EARLY_INK)plot(c,bx,by,c->s->zoned[ENR_ROUTE][zone_at(c,x,y)]);
}
static void draw_bold_route(Ctx *c,int minute){
  const EnrScene *s=c->s;const int32_t now=minute*60;
  for(int k=1;k<s->track_count;k++){
    const EnrPoint *a=&s->track[k-1],*b=&s->track[k];
    if((b->flags&ENR_JUMP)||!(a->flags&b->flags&ENR_HOUR)||s->track_t0+k*(int32_t)s->track_step>now)continue;
    bool steep=b->flags&ENR_STEEP;
    segment(c,a->x,a->y,b->x,b->y,bold_pixel,&steep);
  }
}

// Home's acquisition circle on the world band, under everything but the
// ground and the graticule.
static void draw_circle(Ctx *c){
  const EnrScene *s=c->s;const int k=c->m->circle;
  if(k>=s->circle_count)return;
  for(int i=0;i<s->circle_n[k];i++){
    const int x=s->circle_px[k][2*i],y=s->circle_px[k][2*i+1],layer=class_at(c,x,y)>>4;
    if(layer<=L_WATERLINE||layer==L_GRID)plot(c,x,y,s->zoned[ENR_MARK][zone(c,x,y)]);
  }
}

// The body's own symbol on a knockout.
// A body's symbol at a place: the chart's own body, or the Sun or Moon
// marked beside it.
static void draw_mark(Ctx *c,int body,int mx,int my){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  const uint8_t mk=s->zoned[ENR_MARK][zone_at(c,mx,my)];
  for(int dy=-7;dy<=7;dy++)for(int dx=-7;dx<=7;dx++)if(dx*dx+dy*dy<=6.6*6.6)clear(c,mx+dx,my+dy);
  if(body==ENR_SUN&&s->hal){
    // HAL 9000's eye: a chrome ring, the dark lens, the red eye and its
    // hot centre (GColor8: AAAAAA, 555555, AA0000, FF0000, FFAA00, FFFFAA).
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++){
      const int d=dx*dx+dy*dy;
      const uint8_t col=d<=2?0xFE:d<=5?0xF8:d<=13?0xF0:d<=20?0xE0:d<=29?0xD5:d<=43?0xEA:0;
      if(col)plot(c,mx+dx,my+dy,col);
    }
  }else if(body==ENR_SUN){
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++){const int d=dx*dx+dy*dy;if(d<=5.2*5.2&&d>3.6*3.6)plot(c,mx+dx,my+dy,mk);}
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++)if(dx*dx+dy*dy<=1.5*1.5)plot(c,mx+dx,my+dy,mk);
  }else if(body==ENR_MOON){
    const enr_real r=5.2,f=m->moon_fraction;
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++){
      if(dx*dx+dy*dy>r*r)continue;
      const enr_real rest=r*r-dy*dy,edge=(enr_real)f_sqrt(rest>0?rest:0),side=m->waxing?dx:-dx;
      if(side>=(1-2*f)*edge||dx*dx+dy*dy>(r-1.2)*(r-1.2))plot(c,mx+dx,my+dy,mk);
    }
  }else if(body==ENR_SATELLITE){
    for(int k=-1;k<=1;k++)for(int d=-1;d<=1;d++)plot(c,mx+d,my+k,mk);
    for(int side=-1;side<=1;side+=2){
      for(int k=2;k<=3;k++)plot(c,mx+side*k,my,mk);
      for(int k=4;k<=6;k++)for(int d=-2;d<=2;d++)if(abs(d)==2||k==4||k==6)plot(c,mx+side*k,my+d,mk);
    }
  }else{
    for(int k=-5;k<=5;k++){plot(c,mx+k,my,mk);if(abs(k)>=3){plot(c,mx+k,my-1,mk);plot(c,mx+k,my+1,mk);}}
    for(int k=-2;k<=2;k++)for(int d=-1;d<=1;d++)plot(c,mx+d,my+k,mk);
  }
}
static void draw_body(Ctx *c){draw_mark(c,c->s->body,js_round(c->m->mx),js_round(c->m->my));}

// Lettering in Departure Mono, and the chart's knockout under it.
// (The lettering's glyphs, widths and pixels serve the builder too.)
static const EnrGlyph *glyph(char ch){const int k=enr_font_index(ch);return k>=0&&ENR_FONT_GLYPHS?&ENR_FONT_GLYPHS[k]:0;}
int enr_text_width(const char *text,int n){int w=0;for(int i=0;i<n;i++){const EnrGlyph *g=glyph(text[i]);if(g)w+=g->advance;}return w;}
int enr_text_pixels(const char *text,int n,int x,int baseline,Px *out){
  int count=0,cx=x;
  #define PUT(px) do{if(count<SCRATCH-128)out[count++]=(px);}while(0)
  for(int i=0;i<n;i++){
    const EnrGlyph *g=glyph(text[i]);if(!g)continue;
    for(int r=0;r<g->count;r++){const EnrRun *run=&ENR_FONT_RUNS[g->first+r];for(int k=0;k<run->n;k++)PUT(((Px){cx+g->left+run->x+k,baseline-g->top+run->y}));}
    cx+=g->advance;
  }
  return count;
}
#undef PUT
// Measuring for the study: the flag's pennant and the callout's figures
// without their staff, leader and halos.
static bool s_figures_only;
// As the browser's letter(): clear a halo round every pixel, then ink.
static void letter(Ctx *c,const Px *px,int n,int ink_key,int halo){
  cache_rows(c->s,px,n);
  if(s_figures_only)halo=0;
  for(int i=0;i<n;i++)for(int dy=-halo;dy<=halo;dy++)for(int dx=-halo;dx<=halo;dx++)clear(c,px[i].x+dx,px[i].y+dy);
  for(int i=0;i<n;i++){
    const int wx=PLOT_X(c,px[i].x,px[i].y),cx=wx<0?0:wx>W-1?W-1:wx,cy=px[i].y<0?0:px[i].y>H-1?H-1:px[i].y;
    const bool space=(class_at(c,cx,cy)&15)==G_SPACE;
    plot(c,px[i].x,px[i].y,space?c->s->space_ink:c->s->zoned[ink_key][zone_at(c,wx,px[i].y)]);
  }
}
// A leader routed like a circuit trace: 45 degrees, then straight.
static int circuit(int ax,int ay,int bx,int by,enr_real clearance,Px *out){
  const int dx=bx-ax,dy=by-ay,diag=abs(dx)<abs(dy)?abs(dx):abs(dy),sx=sign(dx),sy=sign(dy);
  int x=ax,y=ay,n=0;
  #define KEEP(px,py) do{if(f_sqrt((double)((px-ax)*(px-ax)+(py-ay)*(py-ay)))>=clearance)out[n++]=(Px){px,py};}while(0)
  KEEP(x,y);
  for(int k=0;k<diag;k++){x+=sx;y+=sy;KEEP(x,y);}
  while(x!=bx||y!=by){if(x!=bx)x+=sx;else y+=sy;KEEP(x,y);}
  #undef KEEP
  return n;
}
// The minute flag: a staff from the body flying a pennant with the minutes
// reversed out of the route's ink.
// A colour that reads on an ink (GColor8, 0b11rrggbb): the plate's paper
// or space where it stands well off the ink's lightness, else black or
// white, whichever is further. Lightness in tenths: 3r + 6g + 1b, 0-30.
static int lightness(uint8_t c){return 3*((c>>4)&3)+6*((c>>2)&3)+((c)&3);}
static uint8_t on_ink(const EnrScene *s,uint8_t ink){
  const int l=lightness(ink),p=lightness(s->space);
  if(abs(p-l)>=12)return s->space;
  return l>=15?0xC0:0xFF;
}
// The watch's state for the margins' corner (enr_status).
static char s_status[8];
void enr_status(const char *text){int n=0;for(;text&&text[n]&&n<7;n++)s_status[n]=text[n];s_status[n]=0;}
// The watch's battery (percent) and its state (ENR_CHARGING, ENR_NO_LINK,
// ENR_NO_FUEL: the fuel line not wanted).
static uint8_t s_power[2]={100,0};
void enr_power(int percent,int state){s_power[0]=(uint8_t)(percent<0?0:percent>100?100:percent);s_power[1]=(uint8_t)state;}
// The fuel line: along the top edge a gauge of the battery, filled over
// a dotted track in the route's ink (the mark's in reserve, at 20% and
// under; the lettering's while charging), ticked at the quarters as a
// fuel gauge is; broken
// into dashes while the phone is out of reach, as a position is drawn
// without a fix.
static __attribute__((noinline)) void draw_fuel(Ctx *c){
  const EnrScene *s=c->s;const int f=s_power[1],e=s_power[0]*W/100;
  if(f&ENR_NO_FUEL)return;
  const uint8_t fill=s->zoned[f&ENR_CHARGING?ENR_INK:s_power[0]<=20?ENR_MARK:ENR_ROUTE][0];
  for(int x=0;x<W;x++){
    const bool on=x<e&&!((f&ENR_NO_LINK)&&x%6>3);
    if(on||!(x&1))plot(c,x,0,on?fill:s->zoned[ENR_GRID][0]);
    if(on||(x%(W/4)==0&&x))plot(c,x,1+!on,fill);
  }
}
static void draw_flag(Ctx *c){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  const int mx=js_round(m->mx),my=js_round(m->my);
  const enr_real nx=s->normal_x,ny=s->normal_y;
  const int tw=enr_text_width(m->minute,2)-1,fh=11,fw=tw+6,point=6,ahead=s->forward>0?1:-1;
  const enr_real room=s->forward>0?s->c1x-mx:mx-s->c1x;
  const int sx=js_round(mx+nx*20),top=js_round(my+ny*20)-(ny<=0?4:0)-(ny>0?fh-4:0);
  const int d=fabs(nx)>0.5?sign(nx):room<fw+point+8?-ahead:ahead;
  // Measured for the study, the pennant alone (no staff).
  Px *px=scratch;int n=s_figures_only?0:circuit(mx,my,sx,ny<=0?top:top+fh-1,8,px);
  for(int y=0;y<fh;y++){
    const int tip=js_round(point*(1-fabs((enr_real)(2*y-(fh-1)))/(fh-1)));
    for(int x=0;x<fw+tip&&n<SCRATCH;x++)px[n++]=(Px){d>0?sx+1+x:sx-1-x,top+y};
  }
  letter(c,px,n,ENR_ROUTE,1);
  // The minutes in a colour that stands off the pennant's ink, not the
  // ground showing through.
  Px *const digits=work->scratch_px+SCRATCH;const int k=enr_text_pixels(m->minute,2,d>0?sx+4:sx-fw+2,top+10,digits);
  for(int i=0;i<k;i++){const int x=digits[i].x,y=digits[i].y;plot(c,x,y,on_ink(s,s->zoned[ENR_ROUTE][zone_at(c,x,y)]));}
}

// The world band's tape: the route's ink filled along the baseline up to
// the index, and the index itself, over the tape's graduations.
static void draw_transfer(Ctx *c);
static void draw_index(Ctx *c){
  const EnrScene *s=c->s;const int B=s->tape_baseline,ix=c->m->index;
  const uint8_t fill=s->zoned[ENR_ROUTE][0];
  for(int x=s->tape_x0;x<=s->tape_x1;x++)if((s->forward>0?x<=ix:x>=ix)&&(class_at(c,x,B+1)>>4)==L_PLAIN)plot(c,x,B+1,fill);
  for(int k=0;k<6;k++)for(int d=-k;d<=k;d++)plot(c,ix+d,B-7+k,s->space);
  for(int k=0;k<5;k++)for(int d=-k;d<=k;d++)plot(c,ix+d,B-6+k,s->space_ink);
  draw_transfer(c);
}
// With the minute flag, the minutes stand over the index instead.
static void draw_readout(Ctx *c){
  const EnrScene *s=c->s;const int lw=enr_text_width(c->m->minute,2),want=js_round(c->m->index-lw/(enr_real)2);
  const int lx=want>s->tape_hi?s->tape_hi:want,x=lx<s->tape_lo?s->tape_lo:lx;
  const int n=enr_text_pixels(c->m->minute,2,x,s->tape_baseline-10,scratch);
  for(int i=0;i<n;i++)plot(c,scratch[i].x,scratch[i].y,s->space_ink);
}
// Of what was drawn after the body, what the browser draws after the minute
// flag too: home's mark and the margins.
// What was drawn after the body in the hour's layer, drawn again over it.
static void draw_late(Ctx *c,const int *box){
  if(box[0]>box[2]||c->measure)return;
  const EnrScene *s=c->s;
  for(int y=box[1]<0?0:box[1];y<=box[3]&&y<H;y++)for(int x=box[0]<0?0:box[0];x<=box[2]&&x<W;x++){
    const uint8_t cls=class_at(c,x,y);const int layer=cls>>4;
    if(layer==L_LATE_CLEARED)plot(c,x,y,base_color(s,cls&15,zone(c,x,y)));
    else if(layer==L_LATE_INK)plot(c,x,y,late_ink(s,cls&15,x,y,fix_zone(c,x,y,zone(c,x,y))));
  }
}
static void draw_text(Ctx *c,const char *text,int max,int x,int right,int baseline){
  int len=0;while(len<max&&text[len])len++;
  if(!len)return;
  if(right)x=right-enr_text_width(text,len);
  letter(c,scratch,enr_text_pixels(text,len,x,baseline,scratch),ENR_INK,1);
}
// The day's time callout (renderEnroute's callout() with `aside`, in the
// 'colon' figures): the hour in Jost, a colon and the minutes smaller on
// the same baseline, set in open map at the left, level with the body; its
// shoulder ruled under it and the leader run to the body like a circuit
// trace, breaking for lettering.
// A glyph of the callout: a Jost figure, the drawn colon, or a Departure
// Mono figure at double size; solid in the ink, outlined, or in the
// route's ink.
enum {K_JOST,K_COLON,K_MONO};
enum {G_SOLID,G_HOLLOW,G_ACCENT};
typedef struct {uint8_t kind,size,group;char ch;int16_t x,y;} Glyph;
static int fig_height(const EnrScene *s,int size,char ch){return ch==':'?s->figures[size].height[0]:s->figures[size].height[ch-'0'];}
// The colon, drawn to match the figures: two rounded square dots the weight
// of the strokes, one on the baseline, one at the height of the middle bar.
static int colon_side(const EnrScene *s,int size){const int d=js_round(s->figures[size].height[0]/(enr_real)7);return d>3?d:3;}
static int fig_width(const EnrScene *s,int size,char ch){return ch==':'?colon_side(s,size):s->figures[size].width[ch-'0'];}
// A Departure Mono figure doubled: its pixels relative to (x, baseline).
static bool mono_bit(char ch,int gx,int gy){
  const EnrGlyph *g=glyph(ch);if(!g||gx<0)return false;
  const int px=gx>>1,ry=(gy>>1)+g->top;
  for(int r=0;r<g->count;r++){const EnrRun *run=&ENR_FONT_RUNS[g->first+r];if(run->y==ry&&px>=g->left+run->x&&px<g->left+run->x+run->n)return true;}
  return false;
}
static bool glyph_bit(const EnrScene *s,const Glyph *g,int gx,int gy){
  if(g->kind==K_MONO)return mono_bit(g->ch,gx,gy);
  if(g->kind==K_COLON){
    const int h=s->figures[g->size].height[0],d=colon_side(s,g->size),top=js_round(h*(enr_real)0.3);
    const int r=gy>=top&&gy<top+d?gy-top:gy>=h-d?gy-(h-d):-1;
    if(r<0||gx<0||gx>=d)return false;
    return !((gx==0||gx==d-1)&&(r==0||r==d-1)&&d>3);
  }
  const int k=g->ch-'0',w=s->figures[g->size].width[k],h=s->figures[g->size].height[k];
  if(gx<0||gy<0||gx>=w||gy>=h)return false;
  return s->fig_bits[s->figures[g->size].first[k]+gy*((w+7)/8)+(gx>>3)]&(128>>(gx&7));
}
// The box a glyph's pixels may fill: x0, y0 and the size, from its origin.
static void glyph_box(const EnrScene *s,const Glyph *g,int *x0,int *y0,int *w,int *h){
  if(g->kind==K_MONO){*x0=0;*y0=-32;*w=2*7+2;*h=40;return;}
  *x0=0;*y0=0;*w=fig_width(s,g->size,g->ch);*h=fig_height(s,g->size,g->ch);
}
static bool solid_at(const EnrScene *s,const Glyph *g,int n,int group,int x,int y){
  for(int i=0;i<n;i++)if(g[i].group==group&&glyph_bit(s,&g[i],x-g[i].x,y-g[i].y))return true;
  return false;
}
// The space between figures: a sixteenth of the size, in pixels.
static int gap_for(const EnrScene *s,int size){return js_round(s->figure_px[size]/(enr_real)16);}
// figurePixels(): a run of figures on a shared top, each glyph bottom-aligned.
static int figure_run(const EnrScene *s,const char *t,int n,int size,int x,int y,int group,Glyph *out){
  int h=0;for(int i=0;i<n;i++){const int gh=fig_height(s,size,t[i]);if(gh>h)h=gh;}
  for(int i=0;i<n;i++){out[i]=(Glyph){t[i]==':'?K_COLON:K_JOST,(uint8_t)size,(uint8_t)group,t[i],(int16_t)x,(int16_t)(y+h-fig_height(s,size,t[i]))};x+=fig_width(s,size,t[i])+gap_for(s,size);}
  return n;
}
static int run_width(const EnrScene *s,const char *t,int n,int size){int w=0;for(int i=0;i<n;i++)w+=fig_width(s,size,t[i]);return w+gap_for(s,size)*(n-1);}
// timeFigure(): the glyphs relative to the hour's top left, in the scene's
// style; returns the width.
static int time_figure(const EnrScene *s,const EnrMinute *m,int big,int small,Glyph *g,int *count,int *height){
  int hn=0;while(hn<3&&s->hour_text[hn])hn++;
  const int fh=fig_height(s,big,'0'),gap=gap_for(s,big),sh=fig_height(s,small,'0');
  int n=figure_run(s,s->hour_text,hn,big,0,0,G_SOLID,g),x=run_width(s,s->hour_text,hn,big);
  switch(s->numerals){
  case ENR_COLON:
    x+=gap+1;n+=figure_run(s,":",1,small,x,fh-sh,G_SOLID,g+n);x+=colon_side(s,small)+gap+1;
    n+=figure_run(s,m->minute,2,small,x,fh-sh,G_SOLID,g+n);x+=run_width(s,m->minute,2,small);break;
  case ENR_EVEN:
    x+=gap+3;n+=figure_run(s,m->minute,2,big,x,0,G_HOLLOW,g+n);x+=run_width(s,m->minute,2,big);break;
  case ENR_MONO:
    x+=gap+3;for(int k=0;k<2;k++)g[n++]=(Glyph){K_MONO,0,G_SOLID,m->minute[k],(int16_t)(x+14*k),(int16_t)fh};
    x+=28-2;break;
  default:
    x+=gap+3;n+=figure_run(s,m->minute,2,small,x,fh-sh,s->numerals==ENR_ACCENT?G_ACCENT:G_SOLID,g+n);x+=run_width(s,m->minute,2,small);
  }
  *count=n;*height=fh;return x;
}
// Whether a leader's pixel is clear of lettering.
static bool open_at(const EnrScene *s,Px p){
  for(int a=0;a<s->avoid_count;a++){const int16_t *b=s->avoid[a];if(p.x>=b[0]-2&&p.x<b[0]+b[2]+2&&p.y>=b[1]-2&&p.y<b[1]+b[3]+2)return false;}
  return true;
}
// A leader: circuitPath() from the body to (sx, sy), then the shoulder from
// there to (ex, sy); returns its length, and in *shown how many are open.
static int leader(const EnrScene *s,int bx,int by,int sx,int sy,int ex,Px *line,int *shown){
  int k=circuit(bx,by,sx,sy,9,line);
  const int dx=ex>sx?1:-1;
  for(int x=sx;k<SCRATCH;x+=dx){line[k++]=(Px){(int16_t)x,(int16_t)sy};if(x==ex)break;}
  int kept=0;for(int i=0;i<k;i++)if(open_at(s,line[i]))line[kept++]=line[i];
  *shown=kept;return k;
}
// setTime(): the figure lettered in ink (solid and outlined), then the
// route's ink (accented minutes), each as one lettering: every knockout,
// then the ink.
static void set_time(Ctx *c,const Glyph *g,int n,int fx,int fy){
  const EnrScene *s=c->s;
  for(int ink=0;ink<2;ink++)for(int pass=0;pass<2;pass++)for(int i=0;i<n;i++){
    if((g[i].group==G_ACCENT)!=(ink==1))continue;
    int x0,y0,w,h;glyph_box(s,&g[i],&x0,&y0,&w,&h);
    for(int gy=y0;gy<y0+h;gy++)for(int gx=x0;gx<x0+w;gx++){
      if(!glyph_bit(s,&g[i],gx,gy))continue;
      const int lx=g[i].x+gx,ly=g[i].y+gy;
      // An outlined figure keeps the pixels at its edge.
      if(g[i].group==G_HOLLOW&&solid_at(s,g,n,G_HOLLOW,lx+1,ly)&&solid_at(s,g,n,G_HOLLOW,lx-1,ly)&&solid_at(s,g,n,G_HOLLOW,lx,ly+1)&&solid_at(s,g,n,G_HOLLOW,lx,ly-1))continue;
      const int x=fx+lx,y=fy+ly;
      if(!pass){if(!s_figures_only)for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)clear(c,x+dx,y+dy);continue;}
      const int cx=x<0?0:x>W-1?W-1:x,cy=y<0?0:y>H-1?H-1:y;
      plot(c,x,y,(class_at(c,cx,cy)&15)==G_SPACE?s->space_ink:s->zoned[ink?ENR_ROUTE:ENR_INK][zone_at(c,x,y)]);
    }
  }
}
// The world band's tape panel (SCALE in enroute-render.js).
#define TAPE_B 46
#define TAPE_P 67
// The sliding tape: the index stands still in the middle and the tape runs
// past it, three pixels a minute, the hour figures riding their marks (this
// hour's pinned at the left until the next pushes it off), cut off at the
// edges like any tape.
static void sliding_figures(Ctx *c,int which);
static int slide_offset(const EnrScene *s,const EnrMinute *m);
// How the tape's minutes of this hour fall on the route, in a strip under
// the panel: the route's own minutes ticked (a vernier), a stroke from each
// five minutes leaning toward its place on the route (a comb), or chevrons
// where the route squeezes the minutes (in) or stretches them (out). Under
// the sliding tape each minute's mark stands PX from the last; under the
// fixed ruler where its index stands that minute. (The strip is the band's:
// drawn at its turned columns.)
static void draw_transfer(Ctx *c){
  const EnrScene *s=c->s;const int now=(int)(c->m-s->minutes),IX=W/2,PX=3;const uint8_t ink=s->space_ink;
  if(!s->transfer)return;
  const bool sliding=s->flags&ENR_SLIDING_TAPE;const int off=slide_offset(s,c->m),t0=TAPE_P+1;
  #define RX(m) ((int)js_round(s->minutes[m].mx)-off)
  #define AX(m) (sliding?IX+((m)-now)*PX:s->minutes[m].index)
  for(int m=0;m<60;m++){
    const int a=AX(m);int r=RX(m);
    if(sliding){r=(r+W)%W;if(a<3||a>=W-3)continue;}
    else if(r<0||r>=W)continue;
    if(s->transfer==1){const int len=m%15==0?5:m%5==0?3:1;for(int d=0;d<len;d++)plot(c,r+off,t0+d,ink);}
    else if(m%5)continue;
    else if(s->transfer==2){int lean=(r-a)/6;lean=lean>4?4:lean<-4?-4:lean;for(int d=0;d<6;d++)plot(c,a+lean*d/5+off,t0+d,ink);}
    else if(m>0&&m<59){
      // (Against the tape's own two minutes, the route's: more or fewer.)
      const int step=abs(RX(m+1)-RX(m-1)),tape=abs(AX(m+1)-AX(m-1)),in=step*10<tape*7,out=step*10>tape*14;
      if((in||out)&&step<W/2)for(int j=0;j<3;j++){const int dx=in?(j==1?2:3):(j==1?3:2);plot(c,a-dx+off,t0+1+j,ink);plot(c,a+dx+off,t0+1+j,ink);}
    }
  }
  #undef AX
  #undef RX
}
static void draw_sliding_tape(Ctx *c){
  const EnrScene *s=c->s;const int B=TAPE_B,P=TAPE_P,IX=W/2,PX=3,now=(int)(c->m-s->minutes);const uint8_t fill=s->zoned[ENR_ROUTE][0],ink=s->space_ink;
  for(int y=0;y<P;y++)for(int x=0;x<W;x++)plot(c,x,y,s->space);
  for(int x=0;x<W;x++){plot(c,x,P-1,ink);plot(c,x,B,ink);if(x<=IX)plot(c,x,B+1,fill);}
  for(int m=now-(IX+PX-1)/PX-12;m<=now+(IX+PX-1)/PX+12;m++){
    const int x=IX+(m-now)*PX,mm=((m%60)+60)%60,len=mm==0?12:mm%15==0?6:mm%5==0?4:2;
    for(int d=1;d<=len;d++)plot(c,x,B+d,ink);
    if(mm==0)for(int d=1;d<=6;d++)plot(c,x,B-d,ink);
    else if(mm%15==0){char label[2]={(char)('0'+mm/10),(char)('0'+mm%10)};const int lw=enr_text_width(label,2),n=enr_text_pixels(label,2,x-lw/2+1,B+17,scratch);for(int i=0;i<n;i++)plot(c,scratch[i].x,scratch[i].y,ink);}
  }
  sliding_figures(c,0);
  draw_transfer(c);
  for(int y=0;y<P-1;y++)plot(c,IX,y,fill);
  for(int kk=0;kk<6;kk++)for(int d=-kk;d<=kk;d++)plot(c,IX+d,B-7+kk,s->space);
  for(int kk=0;kk<5;kk++)for(int d=-kk;d<=kk;d++)plot(c,IX+d,B-6+kk,ink);
  // With the world sliding, the index line on down through the map to the
  // body, under what is drawn after it (home, the margins).
  // (Drawn in the band's own columns, before it is turned: at the body's.)
  if(s->flags&ENR_SLIDING_WORLD){
    const int top=s->height_baseline+6,my=js_round(c->m->my),bx=sliding_x(s,js_round(c->m->mx));
    for(int y=top;y<my-8;y++)if(((y-top)>>1)%2==0&&(class_at(c,bx,y)>>4)<L_LATE_CLEARED)plot(c,bx,y,s->zoned[ENR_ROUTE][zone_at(c,bx,y)]);
  }
}
// The sliding tape's figures: this hour's and the next's (which: 0 both,
// 1 this hour's only, 2 the next's only, for measuring).
static void sliding_figures(Ctx *c,int which){
  const EnrScene *s=c->s;const int IX=W/2,PX=3,now=(int)(c->m-s->minutes);const uint8_t ink=s->space_ink;
  if(!s->fig_bits)return;
  int hn=0,nn=0;while(hn<3&&s->tape_hour[hn])hn++;
  while(nn<3&&s->tape_next[nn])nn++;
  const int cw=run_width(s,s->tape_hour,hn,2),nw=run_width(s,s->tape_next,nn,2);
  const int nx=js_round(IX+(60-now)*PX-nw/(enr_real)2);int cx=js_round(IX+(0-now)*PX-cw/(enr_real)2);cx=cx>4?cx:4;cx=cx<nx-cw-8?cx:nx-cw-8;
  Glyph g[6];const int n=figure_run(s,s->tape_hour,hn,2,cx,4,G_SOLID,g),k=figure_run(s,s->tape_next,nn,2,nx,4,G_HOLLOW,g+n);
  for(int i=(which==2?n:0);i<(which==1?n:n+k);i++){
    int x0,y0,w,h;glyph_box(s,&g[i],&x0,&y0,&w,&h);
    for(int gy=y0;gy<y0+h;gy++)for(int gx=x0;gx<x0+w;gx++){
      const int x=g[i].x+gx,y=g[i].y+gy;
      if(x<0||x>=W||!glyph_bit(s,&g[i],gx,gy))continue;
      // The next hour outlined: its edge on the tape (off the tape is not
      // the figure's).
      #define ON(a,b) ((a)>=0&&(a)<W&&solid_at(s,g+n,k,G_HOLLOW,a,b))
      if(g[i].group==G_HOLLOW&&ON(x+1,y)&&ON(x-1,y)&&ON(x,y+1)&&ON(x,y-1))continue;
      #undef ON
      plot(c,x,y,ink);
    }
  }
}
// The world band's panel as a clock: the time in the callout's figures,
// the largest that fit, centred in the panel; over space, the outlined
// figures keeping their edge and accented minutes in the route's ink.
static void draw_panel_clock(Ctx *c){
  const EnrScene *s=c->s;
  if(!s->fig_bits)return;
  Glyph g[8];int n,fh,fw=time_figure(s,c->m,2,1,g,&n,&fh);
  if(fw>W-12)fw=time_figure(s,c->m,1,0,g,&n,&fh);
  const int fx=(W-fw)/2,fy=(TAPE_P-1-fh)/2;
  for(int i=0;i<n;i++){
    int x0,y0,w,h;glyph_box(s,&g[i],&x0,&y0,&w,&h);
    for(int gy=y0;gy<y0+h;gy++)for(int gx=x0;gx<x0+w;gx++){
      if(!glyph_bit(s,&g[i],gx,gy))continue;
      const int lx=g[i].x+gx,ly=g[i].y+gy;
      if(g[i].group==G_HOLLOW&&solid_at(s,g,n,G_HOLLOW,lx+1,ly)&&solid_at(s,g,n,G_HOLLOW,lx-1,ly)&&solid_at(s,g,n,G_HOLLOW,lx,ly+1)&&solid_at(s,g,n,G_HOLLOW,lx,ly-1))continue;
      plot(c,fx+lx,fy+ly,g[i].group==G_ACCENT?s->zoned[ENR_ROUTE][0]:s->space_ink);
    }
  }
}
// The time callout (renderEnroute's callout()): on the whole-day chart set
// aside in open map at the left, level with the body, with its shoulder
// under it; on the hour chart hung under the body on whichever side keeps
// it on the face and its leader clearest of lettering. Its leader runs to
// the body like a circuit trace and breaks for lettering.
// Where the callout goes this minute: its glyphs, the figure's top left,
// and its leader (in scratch, the pixels clear of lettering: *shown).
// The hour and Fuller day use the same choice of side and leader.
static __attribute__((noinline)) int callout_side(const EnrScene *s,int bx,int by,int sy,int fw,int *shown){
  int best=0,score[2];
  for(int k=0;k<2;k++){
    const int side=k?-1:1,sx=bx+side*10;int f=side>0?sx+2:sx-2-fw;f=f<W-4-fw?f:W-4-fw;f=f>4?f:4;
    int open;const int len=leader(s,bx,by,sx,sy,side>0?f+fw:f-1,scratch,&open);
    const bool fits=side>0?sx+2+fw<=W-4:sx-2-fw>=4;
    score[k]=(fits?0:1000)+(len-open)*10+(side==(bx<W/2?1:-1)?0:1);
  }
  if(score[1]<score[0])best=1;
  const int side=best?-1:1,sx=bx+side*10;int f=side>0?sx+2:sx-2-fw;f=f<W-4-fw?f:W-4-fw;f=f>4?f:4;
  leader(s,bx,by,sx,sy,side>0?f+fw:f-1,scratch,shown);return f;
}
static bool callout_place(Ctx *c,Glyph *g,int *n,int *fx,int *fy,int *shown){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  if(!s->fig_bits)return false;
  const int bx=js_round(m->mx),by=js_round(m->my);
  int fh;Px *line=scratch;
  if(VIEW_IS_DAY(s->view)&&ROLLED(s)){
    // A Fuller day sheet: the time hangs in the open paper above the net
    // where there is room, otherwise above or below the body, on the side
    // whose leader crosses least lettering.
    const int fs=fig_height(s,2,'0'),head=s->callout_top-4;const double net=s->fuller->net_top;
    const bool room=net-head>=fs+16,up=room||by-26-fs>=4+head;
    const double mid=(net-head-fs)/2,low=f_floor(mid);
    const int reach=room?by-(head+(int)(mid-low>=0.5?low+1:low)+fs+3):26,sy=up?by-reach:by+reach;
    const int fw=time_figure(s,m,2,1,g,n,&fh);
    *fx=callout_side(s,bx,by,sy,fw,shown);*fy=up?sy-3-fh:sy+3;
  }else if(VIEW_IS_DAY(s->view)){
    const bool big=time_figure(s,m,2,1,g,n,&fh)<=s->callout_left-6;
    const int fw=time_figure(s,m,big?2:1,big?1:0,g,n,&fh);
    *fy=by-fh;if(*fy>s->callout_bottom-fh-3)*fy=s->callout_bottom-fh-3;
    if(*fy<s->callout_top)*fy=s->callout_top;
    *fx=6;const int y=*fy+fh+3,ex=*fx+fw+1;
    // circuitPath() to the shoulder's near end, then the shoulder.
    int k=circuit(bx,by,ex,y,9,line);
    for(int x=*fx-1;x<=ex&&k<SCRATCH;x++)line[k++]=(Px){(int16_t)x,(int16_t)y};
    *shown=0;for(int i=0;i<k;i++)if(open_at(s,line[i]))line[(*shown)++]=line[i];
  }else{
    const int fw=time_figure(s,m,1,0,g,n,&fh),sy=by+26;
    *fx=callout_side(s,bx,by,sy,fw,shown);*fy=sy+3;
  }
  return true;
}
static void draw_callout(Ctx *c){
  Glyph g[8];int n,fx,fy,shown;
  if(!callout_place(c,g,&n,&fx,&fy,&shown))return;
  if(!s_figures_only)letter(c,scratch,shown,ENR_INK,1);
  set_time(c,g,n,fx,fy);
}
// A box: x, y, w, h (w 0 for none).
typedef struct {int x,y,w,h;} Box;
// The counter readout: this hour's figure as the time, hour and minutes
// composed as the callout's and the panel clock's are, at the place the
// builder left for it, knocked out of the map like the figure it replaces.
static void draw_counter(Ctx *c){
  const EnrScene *s=c->s;if(!s->counter||!s->fig_bits)return;
  Glyph g[8];int n,fh;const int big=s->counter==2?2:1;
  time_figure(s,c->m,big,big-1,g,&n,&fh);
  set_time(c,g,n,s->fig_box[0][0],s->fig_box[0][1]);
}
// The bounds of glyphs' pixels as drawn (an outlined figure's outline), at
// (fx, fy), within x0..x1 (the tape's edges).
static Box glyph_bounds(const EnrScene *s,const Glyph *g,int n,int fx,int fy,int x0,int x1){
  int a=W*4,b=H*4,cx=-W*4,cy=-H*4;
  for(int i=0;i<n;i++){
    int gx0,gy0,w,h;glyph_box(s,&g[i],&gx0,&gy0,&w,&h);
    for(int gy=gy0;gy<gy0+h;gy++)for(int gx=gx0;gx<gx0+w;gx++){
      if(!glyph_bit(s,&g[i],gx,gy))continue;
      const int lx=g[i].x+gx,ly=g[i].y+gy;
      if(g[i].group==G_HOLLOW&&solid_at(s,g,n,G_HOLLOW,lx+1,ly)&&solid_at(s,g,n,G_HOLLOW,lx-1,ly)&&solid_at(s,g,n,G_HOLLOW,lx,ly+1)&&solid_at(s,g,n,G_HOLLOW,lx,ly-1))continue;
      const int x=fx+lx,y=fy+ly;if(x<x0||x>x1)continue;
      a=x<a?x:a;cx=x>cx?x:cx;b=y<b?y:b;cy=y>cy?y:cy;
    }
  }
  return cx<a?(Box){0,0,0,0}:(Box){a,b,cx-a+1,cy-b+1};
}
// What an event's name gives way to this minute: the minute flag or the
// time callout, the minutes over the fixed tape, the sliding tape's
// figures (both solid, as the browser counts them).
static int minute_boxes(Ctx *c,Box *out){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;int n=0;
  if(VIEW_IS_DAY(s->view)||(VIEW_IS_HOUR(s->view)&&(s->flags&ENR_CALLOUT))){
    Glyph g[8];int k,fx,fy,shown;if(callout_place(c,g,&k,&fx,&fy,&shown))out[n++]=glyph_bounds(s,g,k,fx,fy,-W,2*W);
  }else if(VIEW_IS_HOUR(s->view)&&(s->flags&ENR_MINUTE_FLAG)){
    const int mx=js_round(m->mx),my=js_round(m->my);const enr_real nx=s->normal_x,ny=s->normal_y;
    const int tw=enr_text_width(m->minute,2)-1,fh=11,fw=tw+6,point=6,ahead=s->forward>0?1:-1;
    const enr_real room=s->forward>0?s->c1x-mx:mx-s->c1x;
    const int sx=js_round(mx+nx*20),top=js_round(my+ny*20)-(ny<=0?4:0)-(ny>0?fh-4:0);
    const int d=fabs(nx)>0.5?sign(nx):room<fw+point+8?-ahead:ahead;
    out[n++]=(Box){d>0?sx+1:sx-fw-point,top,fw+point,fh};
  }else if(VIEW_IS_WORLD(s->view)&&(s->flags&ENR_SLIDING_TAPE)&&s->fig_bits){
    const int IX=W/2,PX=3,now=(int)(m-s->minutes);int hn=0,nn=0;while(hn<3&&s->tape_hour[hn])hn++;
    while(nn<3&&s->tape_next[nn])nn++;
    const int cw=run_width(s,s->tape_hour,hn,2),nw=run_width(s,s->tape_next,nn,2);
    const int nx=js_round(IX+(60-now)*PX-nw/(enr_real)2);int cx=js_round(IX+(0-now)*PX-cw/(enr_real)2);cx=cx>4?cx:4;cx=cx<nx-cw-8?cx:nx-cw-8;
    Glyph g[3];int k=figure_run(s,s->tape_hour,hn,2,0,0,G_SOLID,g);out[n]=glyph_bounds(s,g,k,cx,4,0,W-1);if(out[n].w)n++;
    k=figure_run(s,s->tape_next,nn,2,0,0,G_SOLID,g);out[n]=glyph_bounds(s,g,k,nx,4,0,W-1);if(out[n].w)n++;
  }else if(VIEW_IS_WORLD(s->view)&&s->clock){
    // The panel's clock: events' names give way to it.
    out[n++]=(Box){4,2,W-8,TAPE_P-4};
  }else if(VIEW_IS_WORLD(s->view)&&(s->flags&ENR_MINUTE_FLAG)){
    const int lw=enr_text_width(m->minute,2),want=js_round(m->index-lw/(enr_real)2),lx=want>s->tape_hi?s->tape_hi:want;
    out[n++]=(Box){lx<s->tape_lo?s->tape_lo:lx,s->tape_baseline-18,lw,8};
  }
  return n;
}
// Events' names, each where it is clear this minute of the minute's own
// lettering and of the names before it.
static void draw_events(Ctx *c){
  const EnrScene *s=c->s;if(!s->event_count)return;
  _Static_assert(sizeof(Box)==4*sizeof(int),"a box is four ints");
  Box *const boxes=(Box *)work->boxes;int nb=minute_boxes(c,boxes);
  for(int k=0;k<s->event_count;k++){
    if(!s->events[k].clear)continue;
    const int16_t *b=s->events[k].box;bool free=true;
    for(int j=0;j<nb&&free;j++){const Box *o=&boxes[j];if(o->w&&!(o->x+o->w+1<=b[0]||b[0]+b[2]+1<=o->x||o->y+o->h+1<=b[1]||b[1]+b[3]+1<=o->y))free=false;}
    if(!free)continue;
    boxes[nb++]=(Box){b[0],b[1],b[2],b[3]};
    int len=0;while(len<5&&s->events[k].name[len])len++;
    letter(c,scratch,enr_text_pixels(s->events[k].name,len,s->events[k].lx,s->events[k].y-7,scratch),ENR_INK,1);
  }
}

// What moves each minute, in the order the browser draws it: the body and
// its flag (or the tape's index and minutes), what was drawn over them, then
// the margins' Zulu time, pass line and height. PART_ALL draws them all; a
// single part is drawn alone, to measure where it goes.
enum {PART_ALL,PART_SUN,PART_MOON,PART_BODY,PART_INDEX,PART_READOUT,PART_CALLOUT,PART_EVENTS,PART_ZULU,PART_TOP,PART_HEIGHT,PART_SOURCE,PART_CIRCLE,PARTS};
// The sliding band: how far its columns are turned at a minute (the body's
// column comes under the index, W/2), and the rows turned (the band and
// the route, between the tape's panel and the bottom margin). What stands
// still over the band (the height, the source line) is drawn on the band
// at its turned columns, before the turn.
_Static_assert(SLIDE_TOP==TAPE_P,"the band is turned from under the tape's panel");
#define SLIDE_BOTTOM (H-10)
static int slide_offset(const EnrScene *s,const EnrMinute *m){return FACE_WORLD&&(s->flags&ENR_SLIDING_WORLD)?(((int)js_round(m->mx)-W/2)%W+W)%W:0;}
static void slide_rows(uint8_t *frame,int stride,int off){
  if(!FACE_WORLD||!off)return;
  uint8_t *const turned=work->turned;
  for(int y=SLIDE_TOP;y<=SLIDE_BOTTOM;y++){
    uint8_t *row=frame+y*stride;
    memcpy(turned,row+off,W-off);memcpy(turned+W-off,row,off);memcpy(row,turned,W);
  }
}
static void draw_moving(Ctx *c,int part){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;const bool world=VIEW_IS_WORLD(s->view),flag=(s->flags&ENR_MINUTE_FLAG)&&VIEW_IS_HOUR(s->view);
  if(part==PART_CIRCLE){draw_circle(c);return;}
  // The Sun and Moon beside the body, under it.
  for(int k=0;k<2;k++)if((!part||part==PART_SUN+k)&&m->also[k][0]<255)draw_mark(c,k,m->also[k][0],m->also[k][1]);
  if(!part||part==PART_BODY){
    // The body, then what lies over it; the flag, then what lies over that.
    Ctx box=*c;box.measure=true;
    draw_body(c);
    if(!part){box.box[0]=W;box.box[1]=H;box.box[2]=-1;box.box[3]=-1;draw_body(&box);draw_late(c,box.box);}
    // (Measured with the body, the flag's box; drawn last of all, below.)
    if(flag&&part)draw_flag(c);
  }
  if((VIEW_IS_DAY(s->view)||(VIEW_IS_HOUR(s->view)&&(s->flags&ENR_CALLOUT)))&&(!part||part==PART_CALLOUT)){
    // (Over what the hour's layer drew late, as the flag is: it is the time.)
    draw_callout(c);
  }
  if(world&&(!part||part==PART_INDEX)){if(s->clock)draw_panel_clock(c);else if(s->flags&ENR_SLIDING_TAPE)draw_sliding_tape(c);else draw_index(c);}
  if(world&&!s->clock&&!(s->flags&ENR_SLIDING_TAPE)&&(s->flags&ENR_MINUTE_FLAG)&&(!part||part==PART_READOUT))draw_readout(c);
  if(!part||part==PART_EVENTS)draw_events(c);
  if(!part||part==PART_ZULU)draw_text(c,m->zulu,5,s->zulu_x,0,s->zulu_baseline);
  if(!part||part==PART_TOP)draw_text(c,m->top,sizeof m->top,s->top_x,0,s->top_baseline);
  const int off=slide_offset(s,m);
  // The margins' corner, or in its place the watch's state.
  if(s->height_right&&(!part||part==PART_HEIGHT))draw_text(c,s_status[0]?s_status:m->corner,s_status[0]?(int)sizeof s_status:(int)sizeof m->corner,0,s->height_right+off,s->height_baseline);
  if(world&&(s->flags&ENR_SLIDING_WORLD)&&(!part||part==PART_SOURCE))draw_text(c,s->source,sizeof s->source,s->top_x+off,0,s->height_baseline);
  // The minute flag over everything: it is the time.
  if(flag&&!part)draw_flag(c);
  if(!world&&s->counter&&(!part||part==PART_READOUT))draw_counter(c);
  if(!part)draw_fuel(c);
}
static int render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride,const uint64_t *mask,const uint64_t *nmask,const Night *from){
  minute=minute<0?0:minute>59?59:minute;
  Ctx c={scene,&scene->minutes[minute],frame,row_stride,{0,0,0},0,false,{0,0,0,0},NULL};
  night_ready(scene,&work->night[0],c.m);c.n=&work->night[0];
  const int drawn=draw_base(&c,mask,nmask,from);
  draw_circle(&c);
  draw_bold_route(&c,minute);
  draw_moving(&c,PART_ALL);
  slide_rows(frame,row_stride,slide_offset(scene,c.m));
  return drawn;
}
static void work_end(void);
static bool work_begin(const EnrScene *s,bool masks){
  work=malloc(sizeof(Work));if(!work)return false;
  memset(work,0,sizeof *work);
  work->scratch_px=malloc(sizeof(Px)*(SCRATCH+DIGITS));work->night=malloc(sizeof(Night)*2);
  if(!work->scratch_px||!work->night){work_end();return false;}
  memset(work->night,0,sizeof(Night)*2);for(int k=0;k<TILE_ROWS;k++)work->tiles_y[k]=-1;for(int k=0;k<CACHE_ROWS;k++)work->cache_y[k]=-1;memset(work->slot_of,255,sizeof work->slot_of);
  if(masks){work->mask=malloc(sizeof(uint64_t)*2*H);if(!work->mask){work_end();return false;}work->nmask=work->mask+H;}
  if(ROLLED(s))for(int k=0;k<2;k++){work->night[k].h=malloc(sizeof(int32_t)*NIGHT_ROWS*W);if(!work->night[k].h){work_end();return false;}}
  work->cache=malloc(sizeof(uint8_t)*CACHE_ROWS*W);
  return true;
}
static void work_end(void){if(!work)return;free(work->mask);if(work->night){free(work->night[0].h);free(work->night[1].h);}free(work->night);free(work->scratch_px);free(work->cache);free(work);work=NULL;}
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride){if(work_begin(scene,false)){render(scene,minute,frame,row_stride,NULL,NULL,NULL);work_end();}}

void enr_ready(EnrScene *s){
  if(!ROLLED(s))for(int y=0;y<H;y++){s->row_q[y][0]=q30(s->row_cos[y]);s->row_q[y][1]=q30(s->row_sin[y]);}
  // Night's thresholds: sunrise, civil twilight, the zones' dither for each
  // Bayer value (t*16 > b + 0.5) and the paper screen's (t*4 > b, and t > 0).
  const enr_real S=SUNRISE_SINE,C=CIVIL_TWILIGHT_SINE;
  s->night_q[0]=q30(S);s->night_q[1]=q30(C);
  for(int b=0;b<16;b++){s->night_q[2+b]=q30(S-(b+(enr_real)0.5)/16*(S-C));s->night_q[18+b]=b>=4?INT32_MIN/2:q30(b?S-b/(enr_real)4*(S-C):S);}
  memset(s->ground_rows,0,sizeof s->ground_rows);
  // (A row with no ground is one run of space, or two.)
  for(int y=0;y<H;y++){const uint8_t *p=row_runs_of(s,y);for(int x=0;x<W;x+=p[0],p+=2)if(p[0]>ENR_RUN_MAX||!p[0]||(p[1]&15)!=G_SPACE){s->ground_rows[y>>3]|=(uint8_t)(1<<(y&7));break;}}
  // Which classes change colour with the zone (base_pixel's choices).
  memset(s->zone_matters,0,sizeof s->zone_matters);
  for(int cls=0;cls<256;cls++){
    const int g=cls&15,l=cls>>4;const uint8_t *z=NULL,*z2=NULL;
    if(l==L_CONTOUR)z=s->zoned[ENR_CONTOUR];else if(l==L_COAST)z=s->zoned[ENR_COAST];else if(l==L_SHELF)z=s->zoned[ENR_SHELF];
    else if(l<=L_WATERLINE||l==L_CLEARED||l==L_EARLY_CLEARED||l==L_LATE_CLEARED){if(l!=L_WATERLINE)z=g==G_WATER?s->zoned[ENR_WATER]:g==G_LAND||(s->pattern&&l<L_WATERLINE&&g>=G_TINT0&&g<G_DEPTH0)?s->zoned[ENR_LAND]:NULL;
      // On the lattice: the dots take the zoned colours; what is cleared is plain.
      if(s->lattice){if(l<=L_WATERLINE&&g!=G_SPACE)z=g==G_WATER||g>=G_DEPTH0?s->zoned[ENR_WATER]:s->zoned[ENR_LAND];else z=NULL;}
    }
    else if(l==L_GRID||l==L_NET_GRID)z=s->zoned[ENR_GRID];else if(l==L_ROUTE)z=s->zoned[ENR_ROUTE];
    else if(l==L_INK||l==L_EARLY_INK)z=s->zoned[ENR_INK];else if(l==L_MARK)z=s->zoned[ENR_MARK];
    else if(l==L_LATE_INK){z=s->zoned[ENR_INK];z2=s->zoned[ENR_MARK];}
    if((z&&(z[0]!=z[1]||z[0]!=z[2]))||(z2&&(z2[0]!=z2[1]||z2[0]!=z2[2])))s->zone_matters[cls>>3]|=(uint8_t)(1<<(cls&7));
  }
  if(ROLLED(s)){
    // Along a row's run on one tile the height is a convex mix of the
    // heights at the grid points of the cells the run crosses, unit
    // directions all within an angle R of the run's middle: R half the
    // run's span (at most a block, 16 pixels) plus two cells, the span
    // widened by 15% for the projection's stretch. Such a height is within
    // 1 - cos R of the ends' (with the sine's bulge at most that), bounded
    // above by the series to its sixth power, plus the interpolation's
    // shortening of the directions within a cell.
    const EnrFuller *f=s->fuller;const double edge=1.1071487177940904,cell=edge/ENR_FULLER_N,night_cell=edge/ENR_NIGHT_N;double worst=0;
    for(int t=0;t<f->tile_count;t++){
      const int32_t *q=f->tile_grid[t];const double da=4.0*q[1]/65536,db=4.0*q[4]/65536;
      const double perpx=cell*f_sqrt(da*da+db*db+da*db),R=8*perpx*1.15+2*night_cell;
      const double r2=R*R,bulge=r2/2-r2*r2/24+r2*r2*r2/720;
      if(bulge>worst)worst=bulge;
    }
    s->fuller->slack=q30(worst+2e-4)+MARGIN;
  }
}
// The blocks where night can differ between two minutes.
static __attribute__((noinline)) void night_blocks(const Ctx *a,const Ctx *b,uint64_t *mask){
  const EnrScene *s=a->s;
  // Night never shows over space.
  for(int y=0;y<H;y++)if(s->ground_rows[y>>3]>>(y&7)&1)for(int k=0;k<BLOCKS;k++){
    const int s0=block_state(a,y,k),s1=block_state(b,y,k);
    if(s0==2||s1==2||s0!=s1)mask[y]|=(uint64_t)15<<(4*k);
  }
}
static void box_blocks(const int *box,uint64_t *mask){
  if(box[0]>box[2])return;
  const int x0=box[0]<0?0:box[0],x1=box[2]>W-1?W-1:box[2],y0=box[1]<0?0:box[1],y1=box[3]>H-1?H-1:box[3];
  uint64_t bits=0;for(int b=x0>>2;b<=x1>>2;b++)bits|=(uint64_t)1<<b;
  for(int y=y0;y<=y1;y++)mask[y]|=bits;
}
static void moved(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride);
int enr_render_update(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride){
  if(!work_begin(scene,from>=0&&from<=59)){
    // Without room for the masks, the minute whole.
    if(!work_begin(scene,false))return -1;
    from=-1;
  }
  // (What changed is found first and its frame left, before the minute is
  // drawn: the watch's stack is 2 KB.)
  minute=minute<0?0:minute>59?59:minute;
  const bool over=from>=0&&from<=59;
  if(over)moved(scene,from,minute,frame,row_stride);
  const int drawn=over?render(scene,minute,frame,row_stride,work->mask,work->nmask,&work->night[1]):render(scene,minute,frame,row_stride,NULL,NULL,NULL);
  work_end();return drawn;
}
// The blocks to draw again over minute `from`: in work->mask those drawn
// whole, in work->nmask those whose night is to be tested.
static __attribute__((noinline)) void moved(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride){
  // The sliding band turned back to its own columns, as minute `from` was
  // drawn; render turns it on again.
  slide_rows(frame,row_stride,(W-slide_offset(scene,&scene->minutes[from]))%W);
  uint64_t *const mask=work->mask,*const nmask=work->nmask;memset(mask,0,sizeof(uint64_t)*H);memset(nmask,0,sizeof(uint64_t)*H);
  Ctx a={scene,&scene->minutes[from],frame,row_stride,{0,0,0},0,false,{0,0,0,0},NULL},b=a;b.m=&scene->minutes[minute];
  night_ready(scene,&work->night[1],a.m);a.n=&work->night[1];night_ready(scene,&work->night[0],b.m);b.n=&work->night[0];
  night_blocks(&a,&b,nmask);
  // A symbol inked by one point's night is drawn again whole when that
  // point's night changes.
  if((scene->flags&ENR_NIGHT_ZONES)&&(scene->zoned[ENR_INK][0]!=scene->zoned[ENR_INK][1]||scene->zoned[ENR_INK][0]!=scene->zoned[ENR_INK][2])){
    // (As wide round the reporting point as round the rose: where the two
    // stand close, a slow body's hour on the world band, the rose's ink
    // nearer the reporting point takes that point's night.)
    const int16_t pts[3][3]={{scene->c0[0],scene->c0[1],21},{scene->c1[0],(int16_t)(scene->c1[1]-1),21}};
    const int n=2+scene->station_count;
    for(int k=0;k<n+scene->event_count;k++){
      const int x=k<2?pts[k][0]:k<n?scene->stations[k-2][0]:scene->events[k-n].x,y=k<2?pts[k][1]:k<n?scene->stations[k-2][1]:scene->events[k-n].y,r=k<2?pts[k][2]:k<n?3:5;
      if(zone_at(&a,x,y)!=zone_at(&b,x,y)){const int box[4]={x-r,y-r,x+r,y+r};box_blocks(box,mask);}
    }
  }
  // What moved: where it was and where it is, each part on its own. Home's
  // acquisition circle moves only when the satellite's height moves it.
  const bool circle=scene->minutes[from].circle!=scene->minutes[minute].circle;
  for(int k=0;k<2;k++)for(int part=PART_SUN;part<PARTS;part++){
    if(part==PART_CIRCLE&&!circle)continue;
    // (The Sun and Moon beside the body move a pixel in some minutes.)
    if(part<PART_BODY&&!memcmp(scene->minutes[from].also[part-PART_SUN],scene->minutes[minute].also[part-PART_SUN],2))continue;
    Ctx c={scene,&scene->minutes[k?minute:from],frame,row_stride,{0,0,0},0,true,{W,H,-1,-1},NULL};
    c.n=k?&work->night[0]:&work->night[1];draw_moving(&c,part);box_blocks(c.box,mask);
  }
  // Blocks drawn whole need no change test.
  for(int y=0;y<H;y++)nmask[y]&=~mask[y];
}

void enr_free(EnrScene *s,void (*release)(void *)){
  if(s->track)release(s->track);
  for(int k=0;k<s->circle_count;k++)release(s->circle_px[k]);
  s->circle_count=0;
  if(s->fig_bits)release(s->fig_bits);
  s->fig_bits=0;
  for(int k=0;k<ENR_RUN_PIECES;k++){if(s->run_piece[k])release(s->run_piece[k]);s->run_piece[k]=0;}
  if(s->minutes)release(s->minutes);
  if(s->rows_block)release(s->rows_block);
  s->minutes=0;s->rows_block=0;
  if(ROLLED(s)&&s->fuller){for(int k=0;k<ENR_TILE_PIECES;k++)if(s->fuller->tile_piece[k])release(s->fuller->tile_piece[k]);release(s->fuller->dirs);release(s->fuller);s->fuller=0;}
  s->track=0;
}

// The study's measures (enroute_core.h).
void enr_measure(const EnrScene *scene,int minute,int part,int16_t out[4]){
  out[0]=out[1]=out[2]=out[3]=0;
  if(!work_begin(scene,false))return;
  minute=minute<0?0:minute>59?59:minute;
  Ctx c={scene,&scene->minutes[minute],NULL,0,{0,0,0},0,true,{W,H,-1,-1},NULL};
  night_ready(scene,&work->night[0],c.m);c.n=&work->night[0];
  const bool world=VIEW_IS_WORLD(scene->view);
  switch(part){
  case ENR_MEASURE_BODY:draw_body(&c);break;
  case ENR_MEASURE_FLAG:s_figures_only=true;if((scene->flags&ENR_MINUTE_FLAG)&&VIEW_IS_HOUR(scene->view))draw_flag(&c);s_figures_only=false;break;
  case ENR_MEASURE_CALLOUT:s_figures_only=true;if(VIEW_IS_DAY(scene->view)||(VIEW_IS_HOUR(scene->view)&&(scene->flags&ENR_CALLOUT)))draw_callout(&c);s_figures_only=false;break;
  case ENR_MEASURE_TAPE_HOUR:if(world&&(scene->flags&ENR_SLIDING_TAPE))sliding_figures(&c,1);break;
  case ENR_MEASURE_TAPE_NEXT:if(world&&(scene->flags&ENR_SLIDING_TAPE))sliding_figures(&c,2);break;
  case ENR_MEASURE_INDEX:if(world){if(scene->clock)draw_panel_clock(&c);else if(scene->flags&ENR_SLIDING_TAPE)draw_sliding_tape(&c);else draw_index(&c);}break;
  case ENR_MEASURE_COUNTER:s_figures_only=true;if(!world)draw_counter(&c);s_figures_only=false;break;
  }
  if(c.box[2]>=c.box[0]){out[0]=(int16_t)c.box[0];out[1]=(int16_t)c.box[1];out[2]=(int16_t)(c.box[2]-c.box[0]+1);out[3]=(int16_t)(c.box[3]-c.box[1]+1);}
  // The body is drawn on the band before it is turned.
  if(part==ENR_MEASURE_BODY&&out[2])out[0]=(int16_t)(((out[0]-slide_offset(scene,c.m))%W+W)%W);
  work_end();
}
void enr_text_box(const char *text,int n,int x,int baseline,int16_t out[4]){
  out[0]=out[1]=out[2]=out[3]=0;
  Work w;memset(&w,0,sizeof w);Px px[SCRATCH+DIGITS];w.scratch_px=px;work=&w;
  const int k=enr_text_pixels(text,n,x,baseline,scratch);int x0=W,y0=H,x1=-1,y1=-1;
  for(int i=0;i<k;i++){const Px p=scratch[i];x0=p.x<x0?p.x:x0;y0=p.y<y0?p.y:y0;x1=p.x>x1?p.x:x1;y1=p.y>y1?p.y:y1;}
  if(x1>=x0){out[0]=(int16_t)x0;out[1]=(int16_t)y0;out[2]=(int16_t)(x1-x0+1);out[3]=(int16_t)(y1-y0+1);}
  work=NULL;
}
int enr_class(const EnrScene *scene,int x,int y){
  if(x<0||y<0||x>=W||y>=H)return -1;
  return run_class(row_runs_of(scene,y),x);
}
int enr_zone(const EnrScene *scene,int minute,int x,int y){
  if(!work_begin(scene,false))return -1;
  minute=minute<0?0:minute>59?59:minute;
  Ctx c={scene,&scene->minutes[minute],NULL,0,{0,0,0},0,true,{W,H,-1,-1},NULL};
  night_ready(scene,&work->night[0],c.m);c.n=&work->night[0];
  if(y>=SLIDE_TOP&&y<=SLIDE_BOTTOM)x=(x+slide_offset(scene,c.m))%W;
  const int z=zone_at(&c,x,y);work_end();return z;
}
