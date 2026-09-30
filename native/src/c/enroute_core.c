// Groundtrack Enroute, native core. See enroute_core.h. Each step mirrors
// src/enroute-render.js closely enough to match it pixel for pixel.
#include "enroute_core.h"
#include "departure_font.h"
#include "fmath.h"
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
static int js_round(enr_real v){return (int)floor(v+(enr_real)0.5);}
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
} Ctx;

// Night's thresholds are decided in 2^30 fixed point first: the Sun's height
// at a pixel is within a few units of row_cos*P(x) + row_sin*u2, and only a
// pixel within MARGIN of a threshold takes the double sums, whose bits the
// browser's decide. The fast sums cost a few integer instructions; the
// doubles, in software on the watch, a few hundred.
#define Q30 1073741824.0
// ENR_EXACT (for tests) takes the double sums everywhere.
#ifdef ENR_EXACT
#define MARGIN ((int64_t)1<<40)
#else
#define MARGIN 64
#endif
static int32_t q30(enr_real v){return (int32_t)(v*(enr_real)Q30);}
static struct {const EnrScene *s;const EnrMinute *m;int32_t p[ENR_W],u2,sunrise,civil,zone[16],screen[16];} F;
static void fast_ready(const EnrScene *s,const EnrMinute *m){
  if(F.s==s&&F.m==m)return;
  F.s=s;F.m=m;
  for(int x=0;x<W;x++)F.p[x]=q30(s->col_cos[x]*m->sun[0]+s->col_sin[x]*m->sun[1]);
  F.u2=q30(m->sun[2]);
}
static int64_t fast_h(const EnrScene *s,int x,int y){return ((int64_t)s->row_q[y][0]*F.p[x]+(int64_t)s->row_q[y][1]*F.u2)>>30;}
static void touch(Ctx *c,int x,int y){
  if(x<c->box[0])c->box[0]=x;
  if(y<c->box[1])c->box[1]=y;
  if(x>c->box[2])c->box[2]=x;
  if(y>c->box[3])c->box[3]=y;
}

// A pixel's class: from the decoded rows when they hold it, otherwise by
// walking its row's runs.
static uint8_t class_at(const Ctx *c,int x,int y){
  if(c->rows[1]&&y>=c->row_y-1&&y<=c->row_y+1&&c->rows[y-c->row_y+1])return c->rows[y-c->row_y+1][x];
  const EnrScene *s=c->s;const uint8_t *p=s->runs+s->row_offset[y],*end=s->runs+s->row_offset[y+1];
  for(int at=0;p<end;p+=2){at+=p[0];if(x<at)return p[1];}
  return G_SPACE;
}
static void decode_row(const EnrScene *s,int y,uint8_t *out){
  const uint8_t *p=s->runs+s->row_offset[y],*end=s->runs+s->row_offset[y+1];
  for(int x=0;p<end&&x<W;p+=2)for(int k=0;k<p[0]&&x<W;k++)out[x++]=p[1];
}
static bool has_dir(const Ctx *c,int x,int y){return (class_at(c,x,y)&15)!=G_SPACE;}
static enr_real sun_dot(const Ctx *c,int x,int y){
  const EnrScene *s=c->s;const enr_real *u=c->m->sun;
  return s->row_cos[y]*s->col_cos[x]*u[0]+s->row_cos[y]*s->col_sin[x]*u[1]+s->row_sin[y]*u[2];
}
// Whether the Sun's height at a pixel is at least a threshold (level, and
// its fixed-point value q).
static bool above(const Ctx *c,int x,int y,enr_real level,int32_t q){
  const int64_t h=fast_h(c->s,x,y);
  if(h>=(int64_t)q+MARGIN)return true;
  if(h<(int64_t)q-MARGIN)return false;
  return sun_dot(c,x,y)>=level;
}
// Day, dusk or night as flat zones, dithered through civil twilight.
static int zone(const Ctx *c,int x,int y){
  if(!(c->s->flags&ENR_NIGHT_ZONES)||!has_dir(c,x,y))return 0;
  const EnrScene *s=c->s;const int64_t h=fast_h(s,x,y);const int b=BAYER[(y&3)*4+(x&3)];
  const int32_t *q=s->night_q;
  // Clear of every threshold that matters here: decided by the fast sum.
  if(h>=(int64_t)q[0]+MARGIN)return 0;
  if(h<(int64_t)q[1]-MARGIN)return 2;
  if(h<(int64_t)q[0]-MARGIN&&h>=(int64_t)q[1]+MARGIN&&(h<(int64_t)q[2+b]-MARGIN||h>=(int64_t)q[2+b]+MARGIN))return h<(int64_t)q[2+b]?2:1;
  const enr_real a=sun_dot(c,x,y);
  if(a>=SUNRISE_SINE)return 0;
  if(a<CIVIL_TWILIGHT_SINE)return 2;
  const enr_real t=(SUNRISE_SINE-a)/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);
  return t*16>b+(enr_real)0.5?2:1;
}
static int zone_at(const Ctx *c,int x,int y){
  x=x<0?0:x>W-1?W-1:x;y=y<0?0:y>H-1?H-1:y;
  return zone(c,x,y);
}
static uint8_t base_color(const EnrScene *s,int ground,int z){
  if(ground==G_WATER)return s->zoned[ENR_WATER][z];
  if(ground==G_LAND)return s->zoned[ENR_LAND][z];
  if(ground==G_SPACE)return s->space;
  if(ground<G_DEPTH0)return s->tints[ground-G_TINT0];
  return s->depths[ground-G_DEPTH0];
}
// Ink drawn after the body: the space ink over space, home's mark round
// home, the ink elsewhere.
static uint8_t late_ink(const EnrScene *s,int ground,int x,int y,int z){
  if(ground==G_SPACE)return s->space_ink;
  const int16_t *b=s->home_box;
  const bool home=(abs(x-s->home_x)<=6&&abs(y-s->home_y)<=6)||(x>=b[0]&&x<b[0]+b[2]&&y>=b[1]&&y<b[1]+b[3]);
  return s->zoned[home?ENR_MARK:ENR_INK][z];
}
static void plot(Ctx *c,int x,int y,uint8_t color){
  if(x<0||y<0||x>=W||y>=H)return;
  if(c->measure){touch(c,x,y);return;}
  c->frame[y*c->stride+x]=color;
}
// A knockout: plain ground, without night's screen.
static void clear(Ctx *c,int x,int y){
  if(x<0||y<0||x>=W||y>=H)return;
  if(c->measure){touch(c,x,y);return;}
  plot(c,x,y,base_color(c->s,class_at(c,x,y)&15,zone(c,x,y)));
}

// Where a minute can change the base: blocks of 16 pixels, row by row. A
// pixel's Sun height is row_cos*P(x) + row_sin*u2 with P(x) = col_cos*u0 +
// col_sin*u1, so over a block it lies between the row's values at the
// block's least and greatest P (row_cos is never negative). A block whose
// range is day (at or over sunrise) or night (under civil twilight) at both
// minutes, the same both times, can't change; the rest can. EPS covers the
// arithmetic's rounding.
#define BLOCKS ((W+15)/16)
#define EPS ((enr_real)1e-4)
// A block's night, from those bounds, at one minute: 0 all day, 1 all
// night, 2 in between.
static void block_bounds(const EnrScene *s,int m,enr_real lo[BLOCKS],enr_real hi[BLOCKS]){
  const enr_real *u=s->minutes[m].sun;
  for(int b=0;b<BLOCKS;b++){lo[b]=(enr_real)1e9;hi[b]=(enr_real)-1e9;}
  for(int x=0;x<W;x++){const enr_real p=s->col_cos[x]*u[0]+s->col_sin[x]*u[1];if(p<lo[x>>4])lo[x>>4]=p;if(p>hi[x>>4])hi[x>>4]=p;}
}
static int block_state(const EnrScene *s,int m,const enr_real *lo,const enr_real *hi,int y,int b){
  const enr_real u2=s->minutes[m].sun[2],a=s->row_cos[y]*lo[b]+s->row_sin[y]*u2,z=s->row_cos[y]*hi[b]+s->row_sin[y]*u2;
  return a>=SUNRISE_SINE+EPS?0:z<CIVIL_TWILIGHT_SINE-EPS?1:2;
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
// The base, everywhere or (with a mask) only in the 16-pixel blocks each
// row's mask marks. Returns the pixels drawn.
static int draw_base(Ctx *c,const uint16_t *mask){
  const EnrScene *s=c->s;
  const bool zones=s->flags&ENR_NIGHT_ZONES,terminator=s->flags&ENR_TERMINATOR;
  // Each block's night at this minute. Where a block is all day or all night
  // (and, for the drawn terminator, so is every block round it), a pixel's
  // own night is known without its Sun height: zone 0 or 2, no screen or
  // the full screen, no terminator. The rest take the per-pixel sums.
  const int minute=(int)(c->m-s->minutes);
  enr_real lo[BLOCKS],hi[BLOCKS];
  block_bounds(s,minute,lo,hi);
  // Rows y-1, y and y+1 decoded, and which rows they hold.
  static uint8_t window[3][W];int held[3]={-100,-100,-100},drawn=0;
  for(int y=0;y<H;y++){
    if(mask&&!mask[y])continue;
    uint8_t *row[3];
    for(int k=0;k<3;k++){
      const int want=y-1+k;row[k]=0;
      if(want<0||want>=H)continue;
      int slot=-1;for(int j=0;j<3;j++)if(held[j]==want)slot=j;
      if(slot<0){for(int j=0;j<3;j++)if(held[j]<y-1||held[j]>y+1){slot=j;break;}decode_row(s,want,window[slot]);held[slot]=want;}
      row[k]=window[slot];
    }
    c->rows[0]=row[0];c->rows[1]=row[1];c->rows[2]=row[2];c->row_y=y;
    const uint8_t *here=row[1];
    // This row's blocks' night; with the drawn terminator, uniform only if
    // the rows above and below agree, and the blocks either side.
    uint8_t known_row[BLOCKS];
    for(int b=0;b<BLOCKS;b++)known_row[b]=(uint8_t)block_state(s,minute,lo,hi,y,b);
    if(terminator){
      uint8_t near[3][BLOCKS];
      for(int k=0;k<3;k++)for(int b=0;b<BLOCKS;b++){const int yy=y-1+k;near[k][b]=yy<0||yy>=H?known_row[b]:k==1?known_row[b]:(uint8_t)block_state(s,minute,lo,hi,yy,b);}
      for(int b=0;b<BLOCKS;b++){
        int v=near[1][b];
        for(int k=0;k<3&&v!=2;k++)for(int db=-1;db<=1;db++){const int bb=b+db;if(bb<0||bb>=BLOCKS)continue;if(near[k][bb]!=v){v=2;break;}}
        known_row[b]=(uint8_t)v;
      }
    }
    for(int x=0;x<W;x++){
    if(mask&&!(mask[y]>>(x>>4)&1)){x|=15;continue;}
    drawn++;
    const uint8_t cls=here[x];
    const int ground=cls&15,layer=cls>>4,known=known_row[x>>4];
    // Known night: zone 0 or 2 (none without a direction, over space).
    const bool dir=ground!=G_SPACE;
    const int z=known==2?zone(c,x,y):!(s->flags&ENR_NIGHT_ZONES)||!dir?0:known==1?2:0;
    uint8_t col;
    if(layer<=L_WATERLINE&&known!=2){
      col=layer==L_CONTOUR?s->zoned[ENR_CONTOUR][z]:layer==L_COAST?s->zoned[ENR_COAST][z]:layer==L_SHELF?s->zoned[ENR_SHELF][z]:layer==L_WATERLINE?s->waterline:base_color(s,ground,z);
      if((s->flags&ENR_SCAN)&&z&&y%(z==2?2:4)==1)col=s->space;
      // No terminator here; at night, the dots of an outline plate.
      if(terminator&&dir&&(s->flags&ENR_NIGHT_DOTS)&&z==2&&x%4==0&&y%4==((x>>2)&1)*2)col=s->night_dots;
      // The dot screen: none by day, the full 25% by night.
      if(!zones&&dir&&known==1&&BAYER[(y&3)*4+(x&3)]<4)col=s->screen;
    }
    else if(layer<=L_WATERLINE){
      col=layer==L_CONTOUR?s->zoned[ENR_CONTOUR][z]:layer==L_COAST?s->zoned[ENR_COAST][z]:layer==L_SHELF?s->zoned[ENR_SHELF][z]:layer==L_WATERLINE?s->waterline:base_color(s,ground,z);
      if((s->flags&ENR_SCAN)&&z&&y%(z==2?2:4)==1)col=s->space;
      if((s->flags&ENR_TERMINATOR)&&has_dir(c,x,y)){
        if(((x+y)>>1)%3!=2&&crosses(c,x,y,SUNRISE_SINE,s->night_q[0]))col=s->terminator;
        else if((x+y)%3==0&&crosses(c,x,y,CIVIL_TWILIGHT_SINE,s->night_q[1]))col=s->terminator;
        else if((s->flags&ENR_NIGHT_DOTS)&&z==2&&x%4==0&&y%4==((x>>2)&1)*2)col=s->night_dots;
      }
      if(!zones&&has_dir(c,x,y)){
        // The screen's dot shows where t > 0 and t*4 > its Bayer value.
        const int b=BAYER[(y&3)*4+(x&3)];const int64_t h=fast_h(s,x,y),q=s->night_q[18+b];
        bool dot;
        if(h<q-MARGIN)dot=true;else if(h>=q+MARGIN)dot=false;
        else{enr_real t=(SUNRISE_SINE-sun_dot(c,x,y))/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);t=t<0?0:t>1?1:t;dot=t>0&&b<t*4;}
        if(dot)col=s->screen;
      }
    }
    else if(layer==L_CLEARED||layer==L_EARLY_CLEARED||layer==L_LATE_CLEARED)col=base_color(s,ground,z);
    else if(layer==L_GRID||layer==L_NET_GRID)col=s->zoned[ENR_GRID][z];
    else if(layer==L_ROUTE)col=s->zoned[ENR_ROUTE][z];
    else if(layer==L_INK||layer==L_EARLY_INK)col=s->zoned[ENR_INK][z];
    else if(layer==L_MARK)col=s->zoned[ENR_MARK][z];
    else if(layer==L_SPACE_INK)col=s->space_ink;
    else col=late_ink(s,ground,x,y,z);
    c->frame[y*c->stride+x]=col;
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
  const bool steep=*(bool *)arg;const int bx=steep?x+1:x,by=steep?y:y-1;
  if(bx<0||by<0||bx>=W||by>=H)return;
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
static void draw_body(Ctx *c){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  const int mx=js_round(m->mx),my=js_round(m->my);
  const uint8_t mk=s->zoned[ENR_MARK][zone_at(c,mx,my)];
  for(int dy=-7;dy<=7;dy++)for(int dx=-7;dx<=7;dx++)if(dx*dx+dy*dy<=6.6*6.6)clear(c,mx+dx,my+dy);
  if(s->body==ENR_SUN){
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++){const int d=dx*dx+dy*dy;if(d<=5.2*5.2&&d>3.6*3.6)plot(c,mx+dx,my+dy,mk);}
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++)if(dx*dx+dy*dy<=1.5*1.5)plot(c,mx+dx,my+dy,mk);
  }else if(s->body==ENR_MOON){
    const enr_real r=5.2,f=m->moon_fraction;
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++){
      if(dx*dx+dy*dy>r*r)continue;
      const enr_real rest=r*r-dy*dy,edge=(enr_real)f_sqrt(rest>0?rest:0),side=m->waxing?dx:-dx;
      if(side>=(1-2*f)*edge||dx*dx+dy*dy>(r-1.2)*(r-1.2))plot(c,mx+dx,my+dy,mk);
    }
  }else if(s->body==ENR_SATELLITE){
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

// Lettering in Departure Mono, and the chart's knockout under it.
typedef struct {int16_t x,y;} Px;
// One shared list of pixels for lettering and leaders, drawn one at a time.
// The longest list is a satellite's pass line: 24 characters of at most 24
// pixels each.
#define SCRATCH 640
static Px scratch[SCRATCH];
static const EnrGlyph *glyph(char ch){const char *p=strchr(ENR_FONT_CHARS,ch);return p&&ch?&ENR_FONT_GLYPHS[p-ENR_FONT_CHARS]:0;}
static int text_width(const char *text,int n){int w=0;for(int i=0;i<n;i++){const EnrGlyph *g=glyph(text[i]);if(g)w+=g->advance;}return w;}
static int text_pixels(const char *text,int n,int x,int baseline,Px *out){
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
// As the browser's letter(): clear a halo round every pixel, then ink.
static void letter(Ctx *c,const Px *px,int n,int ink_key,int halo){
  for(int i=0;i<n;i++)for(int dy=-halo;dy<=halo;dy++)for(int dx=-halo;dx<=halo;dx++)clear(c,px[i].x+dx,px[i].y+dy);
  for(int i=0;i<n;i++){
    const int cx=px[i].x<0?0:px[i].x>W-1?W-1:px[i].x,cy=px[i].y<0?0:px[i].y>H-1?H-1:px[i].y;
    const bool space=(class_at(c,cx,cy)&15)==G_SPACE;
    plot(c,px[i].x,px[i].y,space?c->s->space_ink:c->s->zoned[ink_key][zone_at(c,px[i].x,px[i].y)]);
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
static void draw_flag(Ctx *c){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  const int mx=js_round(m->mx),my=js_round(m->my);
  const enr_real nx=s->normal_x,ny=s->normal_y;
  const int tw=text_width(m->minute,2)-1,fh=11,fw=tw+6,point=6,ahead=s->forward>0?1:-1;
  const enr_real room=s->forward>0?s->c1x-mx:mx-s->c1x;
  const int sx=js_round(mx+nx*20),top=js_round(my+ny*20)-(ny<=0?4:0)-(ny>0?fh-4:0);
  const int d=fabs(nx)>0.5?sign(nx):room<fw+point+8?-ahead:ahead;
  Px *px=scratch;int n=circuit(mx,my,sx,ny<=0?top:top+fh-1,8,px);
  for(int y=0;y<fh;y++){
    const int tip=js_round(point*(1-fabs((enr_real)(2*y-(fh-1)))/(fh-1)));
    for(int x=0;x<fw+tip&&n<SCRATCH;x++)px[n++]=(Px){d>0?sx+1+x:sx-1-x,top+y};
  }
  letter(c,px,n,ENR_ROUTE,1);
  Px digits[128];const int k=text_pixels(m->minute,2,d>0?sx+4:sx-fw+2,top+10,digits);
  for(int i=0;i<k;i++)clear(c,digits[i].x,digits[i].y);
}

// The world band's tape: the route's ink filled along the baseline up to
// the index, and the index itself, over the tape's graduations.
static void draw_index(Ctx *c){
  const EnrScene *s=c->s;const int B=s->tape_baseline,ix=c->m->index;
  const uint8_t fill=s->zoned[ENR_ROUTE][0];
  for(int x=s->tape_x0;x<=s->tape_x1;x++)if((s->forward>0?x<=ix:x>=ix)&&(class_at(c,x,B+1)>>4)==L_PLAIN)plot(c,x,B+1,fill);
  for(int k=0;k<6;k++)for(int d=-k;d<=k;d++)plot(c,ix+d,B-7+k,s->space);
  for(int k=0;k<5;k++)for(int d=-k;d<=k;d++)plot(c,ix+d,B-6+k,s->space_ink);
}
// With the minute flag, the minutes stand over the index instead.
static void draw_readout(Ctx *c){
  const EnrScene *s=c->s;const int lw=text_width(c->m->minute,2),want=js_round(c->m->index-lw/(enr_real)2);
  const int lx=want>s->tape_hi?s->tape_hi:want,x=lx<s->tape_lo?s->tape_lo:lx;
  const int n=text_pixels(c->m->minute,2,x,s->tape_baseline-10,scratch);
  for(int i=0;i<n;i++)plot(c,scratch[i].x,scratch[i].y,s->space_ink);
}
// Of what was drawn after the body, what the browser draws after the minute
// flag too: home's mark and the margins.
static bool after_flag(const EnrScene *s,int x,int y){
  const int16_t *b=s->home_box;
  return y<14||y>=H-16||(abs(x-s->home_x)<=6&&abs(y-s->home_y)<=6)||(x>=b[0]&&x<b[0]+b[2]&&y>=b[1]&&y<b[1]+b[3]);
}
// What was drawn after the body in the hour's layer (with `flag`, only what
// was drawn after the flag), drawn again over it.
static void draw_late(Ctx *c,const int *box,bool flag){
  if(box[0]>box[2]||c->measure)return;
  const EnrScene *s=c->s;
  for(int y=box[1]<0?0:box[1];y<=box[3]&&y<H;y++)for(int x=box[0]<0?0:box[0];x<=box[2]&&x<W;x++){
    if(flag&&!after_flag(s,x,y))continue;
    const uint8_t cls=class_at(c,x,y);const int layer=cls>>4;
    if(layer==L_LATE_CLEARED)plot(c,x,y,base_color(s,cls&15,zone(c,x,y)));
    else if(layer==L_LATE_INK)plot(c,x,y,late_ink(s,cls&15,x,y,zone(c,x,y)));
  }
}
static void draw_text(Ctx *c,const char *text,int max,int x,int right,int baseline){
  int len=0;while(len<max&&text[len])len++;
  if(!len)return;
  if(right)x=right-text_width(text,len);
  letter(c,scratch,text_pixels(text,len,x,baseline,scratch),ENR_INK,1);
}
// The day's time callout (renderEnroute's callout() with `aside`, in the
// 'colon' figures): the hour in Jost, a colon and the minutes smaller on
// the same baseline, set in open map at the left, level with the body; its
// shoulder ruled under it and the leader run to the body like a circuit
// trace, breaking for lettering.
static const int FIGURE_PX[3]={20,28,40};
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
static int gap_for(int size){return js_round(FIGURE_PX[size]/(enr_real)16);}
// figurePixels(): a run of figures on a shared top, each glyph bottom-aligned.
static int figure_run(const EnrScene *s,const char *t,int n,int size,int x,int y,int group,Glyph *out){
  int h=0;for(int i=0;i<n;i++){const int gh=fig_height(s,size,t[i]);if(gh>h)h=gh;}
  for(int i=0;i<n;i++){out[i]=(Glyph){t[i]==':'?K_COLON:K_JOST,(uint8_t)size,(uint8_t)group,t[i],(int16_t)x,(int16_t)(y+h-fig_height(s,size,t[i]))};x+=fig_width(s,size,t[i])+gap_for(size);}
  return n;
}
static int run_width(const EnrScene *s,const char *t,int n,int size){int w=0;for(int i=0;i<n;i++)w+=fig_width(s,size,t[i]);return w+gap_for(size)*(n-1);}
// timeFigure(): the glyphs relative to the hour's top left, in the scene's
// style; returns the width.
static int time_figure(const EnrScene *s,const EnrMinute *m,int big,int small,Glyph *g,int *count,int *height){
  int hn=0;while(hn<3&&s->hour_text[hn])hn++;
  const int fh=fig_height(s,big,'0'),gap=gap_for(big),sh=fig_height(s,small,'0');
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
      if(!pass){for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)clear(c,x+dx,y+dy);continue;}
      const int cx=x<0?0:x>W-1?W-1:x,cy=y<0?0:y>H-1?H-1:y;
      plot(c,x,y,(class_at(c,cx,cy)&15)==G_SPACE?s->space_ink:s->zoned[ink?ENR_ROUTE:ENR_INK][zone_at(c,x,y)]);
    }
  }
}
// The time callout (renderEnroute's callout()): on the whole-day chart set
// aside in open map at the left, level with the body, with its shoulder
// under it; on the hour chart hung under the body on whichever side keeps
// it on the face and its leader clearest of lettering. Its leader runs to
// the body like a circuit trace and breaks for lettering.
static void draw_callout(Ctx *c){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;
  if(!s->fig_bits)return;
  const int bx=js_round(m->mx),by=js_round(m->my);
  Glyph g[8];int n,fh,fx,fy,shown;
  Px *line=scratch;
  if(s->view==ENR_VIEW_DAY){
    const bool big=time_figure(s,m,2,1,g,&n,&fh)<=s->callout_left-6;
    const int fw=time_figure(s,m,big?2:1,big?1:0,g,&n,&fh);
    fy=by-fh;if(fy>s->callout_bottom-fh-3)fy=s->callout_bottom-fh-3;
    if(fy<s->callout_top)fy=s->callout_top;
    fx=6;const int y=fy+fh+3,ex=fx+fw+1;
    // circuitPath() to the shoulder's near end, then the shoulder.
    int k=circuit(bx,by,ex,y,9,line);
    for(int x=fx-1;x<=ex&&k<SCRATCH;x++)line[k++]=(Px){(int16_t)x,(int16_t)y};
    shown=0;for(int i=0;i<k;i++)if(open_at(s,line[i]))line[shown++]=line[i];
  }else{
    const int fw=time_figure(s,m,1,0,g,&n,&fh),sy=by+26;
    int best=0,score[2];
    for(int k=0;k<2;k++){
      const int side=k?-1:1,sx=bx+side*10;int f=side>0?sx+2:sx-2-fw;f=f<W-4-fw?f:W-4-fw;f=f>4?f:4;
      int open;const int len=leader(s,bx,by,sx,sy,side>0?f+fw:f-1,line,&open);
      const bool fits=side>0?sx+2+fw<=W-4:sx-2-fw>=4;
      score[k]=(fits?0:1000)+(len-open)*10+(side==(bx<W/2?1:-1)?0:1);
    }
    if(score[1]<score[0])best=1;
    const int side=best?-1:1,sx=bx+side*10;int f=side>0?sx+2:sx-2-fw;f=f<W-4-fw?f:W-4-fw;fx=f>4?f:4;
    leader(s,bx,by,sx,sy,side>0?fx+fw:fx-1,line,&shown);fy=sy+3;
  }
  letter(c,line,shown,ENR_INK,1);
  set_time(c,g,n,fx,fy);
}

// What moves each minute, in the order the browser draws it: the body and
// its flag (or the tape's index and minutes), what was drawn over them, then
// the margins' Zulu time, pass line and height. PART_ALL draws them all; a
// single part is drawn alone, to measure where it goes.
enum {PART_ALL,PART_BODY,PART_INDEX,PART_READOUT,PART_CALLOUT,PART_ZULU,PART_TOP,PART_HEIGHT,PART_CIRCLE,PARTS};
static void draw_moving(Ctx *c,int part){
  const EnrScene *s=c->s;const EnrMinute *m=c->m;const bool world=s->view==ENR_VIEW_WORLD,flag=(s->flags&ENR_MINUTE_FLAG)&&s->view==ENR_VIEW_HOUR;
  if(part==PART_CIRCLE){draw_circle(c);return;}
  if(!part||part==PART_BODY){
    // The body, then what lies over it; the flag, then what lies over that.
    Ctx box=*c;box.measure=true;
    draw_body(c);
    if(!part){box.box[0]=W;box.box[1]=H;box.box[2]=-1;box.box[3]=-1;draw_body(&box);draw_late(c,box.box,false);}
    if(flag){
      draw_flag(c);
      if(!part){box.box[0]=W;box.box[1]=H;box.box[2]=-1;box.box[3]=-1;draw_flag(&box);draw_late(c,box.box,true);}
    }
  }
  if((s->view==ENR_VIEW_DAY||(s->view==ENR_VIEW_HOUR&&(s->flags&ENR_CALLOUT)))&&(!part||part==PART_CALLOUT)){
    draw_callout(c);
    if(!part){Ctx box=*c;box.measure=true;box.box[0]=W;box.box[1]=H;box.box[2]=-1;box.box[3]=-1;draw_callout(&box);draw_late(c,box.box,true);}
  }
  if(world&&(!part||part==PART_INDEX))draw_index(c);
  if(world&&(s->flags&ENR_MINUTE_FLAG)&&(!part||part==PART_READOUT))draw_readout(c);
  if(!part||part==PART_ZULU)draw_text(c,m->zulu,5,s->zulu_x,0,s->zulu_baseline);
  if(!part||part==PART_TOP)draw_text(c,m->top,sizeof m->top,s->top_x,0,s->top_baseline);
  if(world&&(!part||part==PART_HEIGHT))draw_text(c,m->height,sizeof m->height,0,s->height_right,s->height_baseline);
}
static int render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride,const uint16_t *mask){
  minute=minute<0?0:minute>59?59:minute;
  Ctx c={scene,&scene->minutes[minute],frame,row_stride,{0,0,0},0,false,{0,0,0,0}};
  fast_ready(scene,c.m);
  const int drawn=draw_base(&c,mask);
  draw_circle(&c);
  draw_bold_route(&c,minute);
  draw_moving(&c,PART_ALL);
  return drawn;
}
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride){render(scene,minute,frame,row_stride,NULL);}

void enr_ready(EnrScene *s){
  for(int y=0;y<H;y++){s->row_q[y][0]=q30(s->row_cos[y]);s->row_q[y][1]=q30(s->row_sin[y]);}
  // Night's thresholds: sunrise, civil twilight, the zones' dither for each
  // Bayer value (t*16 > b + 0.5) and the paper screen's (t*4 > b, and t > 0).
  const enr_real S=SUNRISE_SINE,C=CIVIL_TWILIGHT_SINE;
  s->night_q[0]=q30(S);s->night_q[1]=q30(C);
  for(int b=0;b<16;b++){s->night_q[2+b]=q30(S-(b+(enr_real)0.5)/16*(S-C));s->night_q[18+b]=b>=4?INT32_MIN/2:q30(b?S-b/(enr_real)4*(S-C):S);}
  F.s=NULL;
  memset(s->ground_rows,0,sizeof s->ground_rows);
  for(int y=0;y<H;y++)for(unsigned k=s->row_offset[y];k<s->row_offset[y+1];k+=2)if((s->runs[k+1]&15)!=G_SPACE){s->ground_rows[y>>3]|=(uint8_t)(1<<(y&7));break;}
}
static void night_blocks(const EnrScene *s,int m0,int m1,uint16_t *mask){
  enr_real lo[2][BLOCKS],hi[2][BLOCKS];
  block_bounds(s,m0,lo[0],hi[0]);block_bounds(s,m1,lo[1],hi[1]);
  // Night never shows over space.
  for(int y=0;y<H;y++)if(s->ground_rows[y>>3]>>(y&7)&1)for(int b=0;b<BLOCKS;b++){
    const int s0=block_state(s,m0,lo[0],hi[0],y,b),s1=block_state(s,m1,lo[1],hi[1],y,b);
    if(s0==2||s1==2||s0!=s1)mask[y]|=(uint16_t)(1<<b);
  }
  // The drawn terminator reads each pixel's neighbours: widen by a pixel.
  if(s->flags&ENR_TERMINATOR){
    uint16_t grown[H];
    for(int y=0;y<H;y++){
      uint16_t m=mask[y]|(y?mask[y-1]:0)|(y+1<H?mask[y+1]:0);
      grown[y]=(uint16_t)(m|m<<1|m>>1);
    }
    memcpy(mask,grown,sizeof grown);
  }
}
static void box_blocks(const int *box,uint16_t *mask){
  if(box[0]>box[2])return;
  const int x0=box[0]<0?0:box[0],x1=box[2]>W-1?W-1:box[2],y0=box[1]<0?0:box[1],y1=box[3]>H-1?H-1:box[3];
  uint16_t bits=0;for(int b=x0>>4;b<=x1>>4;b++)bits|=(uint16_t)(1<<b);
  for(int y=y0;y<=y1;y++)mask[y]|=bits;
}
int enr_render_update(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride){
  minute=minute<0?0:minute>59?59:minute;
  if(from<0||from>59)return render(scene,minute,frame,row_stride,NULL);
  static uint16_t mask[H];memset(mask,0,sizeof mask);
  night_blocks(scene,from,minute,mask);
  // What moved: where it was and where it is, each part on its own. Home's
  // acquisition circle moves only when the satellite's height moves it.
  const bool circle=scene->minutes[from].circle!=scene->minutes[minute].circle;
  for(int k=0;k<2;k++)for(int part=PART_BODY;part<PARTS;part++){
    if(part==PART_CIRCLE&&!circle)continue;
    Ctx c={scene,&scene->minutes[k?minute:from],frame,row_stride,{0,0,0},0,true,{W,H,-1,-1}};
    fast_ready(scene,c.m);draw_moving(&c,part);box_blocks(c.box,mask);
  }
  return render(scene,minute,frame,row_stride,mask);
}

void enr_free(EnrScene *s,void (*release)(void *)){
  if(s->track)release(s->track);
  for(int k=0;k<s->circle_count;k++)release(s->circle_px[k]);
  s->circle_count=0;
  if(s->fig_bits)release(s->fig_bits);
  s->fig_bits=0;
  if(s->owns_runs)release((void *)s->runs);
  s->track=0;s->runs=0;s->owns_runs=false;
}
