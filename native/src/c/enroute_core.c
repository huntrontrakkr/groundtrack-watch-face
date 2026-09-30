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
// Layers over the ground, from the class plane's high nibble.
enum {L_PLAIN,L_CONTOUR,L_COAST,L_SHELF,L_WATERLINE,L_CLEARED,L_GRID,L_ROUTE,L_INK,L_MARK,L_SPACE_INK,L_SPACE,L_EARLY_CLEARED,L_EARLY_INK};
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
// Day, dusk or night as flat zones, dithered through civil twilight.
static int zone(const Ctx *c,int x,int y){
  if(!(c->s->flags&ENR_NIGHT_ZONES)||!has_dir(c,x,y))return 0;
  const enr_real a=sun_dot(c,x,y);
  if(a>=SUNRISE_SINE)return 0;
  if(a<CIVIL_TWILIGHT_SINE)return 2;
  const enr_real t=(SUNRISE_SINE-a)/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);
  return t*16>BAYER[(y&3)*4+(x&3)]+(enr_real)0.5?2:1;
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
static bool crosses(const Ctx *c,int x,int y,enr_real h,enr_real level){
  const int nx[4]={x-1,x+1,x,x},ny[4]={y,y,y-1,y+1};
  for(int k=0;k<4;k++){
    if(nx[k]<0||nx[k]>=W||ny[k]<0||ny[k]>=H||!has_dir(c,nx[k],ny[k]))continue;
    if((sun_dot(c,nx[k],ny[k])>=level)!=(h>=level))return true;
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
        const enr_real h=sun_dot(c,x,y);
        if(crosses(c,x,y,h,SUNRISE_SINE)&&((x+y)>>1)%3!=2)col=s->terminator;
        else if(crosses(c,x,y,h,CIVIL_TWILIGHT_SINE)&&(x+y)%3==0)col=s->terminator;
        else if((s->flags&ENR_NIGHT_DOTS)&&z==2&&x%4==0&&y%4==((x>>2)&1)*2)col=s->night_dots;
      }
      if(!zones&&has_dir(c,x,y)){
        enr_real t=(SUNRISE_SINE-sun_dot(c,x,y))/(SUNRISE_SINE-CIVIL_TWILIGHT_SINE);
        t=t<0?0:t>1?1:t;
        if(t>0&&BAYER[(y&3)*4+(x&3)]<t*4)col=s->screen;
      }
    }
    else if(layer==L_CLEARED||layer==L_EARLY_CLEARED)col=base_color(s,ground,z);
    else if(layer==L_GRID)col=s->zoned[ENR_GRID][z];
    else if(layer==L_ROUTE)col=s->zoned[ENR_ROUTE][z];
    else if(layer==L_INK||layer==L_EARLY_INK)col=s->zoned[ENR_INK][z];
    else if(layer==L_MARK)col=s->zoned[ENR_MARK][z];
    else if(layer==L_SPACE_INK)col=s->space_ink;
    else col=s->space;
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
  if(layer<=L_WATERLINE||layer==L_GRID||layer==L_EARLY_CLEARED||layer==L_EARLY_INK)plot(c,bx,by,c->s->zoned[ENR_ROUTE][zone_at(c,x,y)]);
}
static void draw_bold_route(Ctx *c,int minute){
  const EnrScene *s=c->s;const int32_t now=minute*60;
  for(int k=1;k<s->track_count;k++){
    const EnrPoint *a=&s->track[k-1],*b=&s->track[k];
    if(fabs(b->x-a->x)>W/2||!(a->hour&&b->hour)||b->seconds>now)continue;
    bool steep=fabs(b->y-a->y)>fabs(b->x-a->x);
    segment(c,js_round(a->x),js_round(a->y),js_round(b->x),js_round(b->y),bold_pixel,&steep);
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
static Px scratch[1024];
static const EnrGlyph *glyph(char ch){const char *p=strchr(ENR_FONT_CHARS,ch);return p&&ch?&ENR_FONT_GLYPHS[p-ENR_FONT_CHARS]:0;}
static int text_width(const char *text,int n){int w=0;for(int i=0;i<n;i++){const EnrGlyph *g=glyph(text[i]);if(g)w+=g->advance;}return w;}
static int text_pixels(const char *text,int n,int x,int baseline,Px *out){
  int count=0,cx=x;
  for(int i=0;i<n;i++){
    const EnrGlyph *g=glyph(text[i]);if(!g)continue;
    for(int r=0;r<g->count;r++){const EnrRun *run=&ENR_FONT_RUNS[g->first+r];for(int k=0;k<run->n;k++)out[count++]=(Px){cx+g->left+run->x+k,baseline-g->top+run->y};}
    cx+=g->advance;
  }
  return count;
}
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
    for(int x=0;x<fw+tip&&n<1024;x++)px[n++]=(Px){d>0?sx+1+x:sx-1-x,top+y};
  }
  letter(c,px,n,ENR_ROUTE,1);
  Px digits[128];const int k=text_pixels(m->minute,2,d>0?sx+4:sx-fw+2,top+10,digits);
  for(int i=0;i<k;i++)clear(c,digits[i].x,digits[i].y);
}

// What moves each minute: the body, the flag, Zulu time and the pass line
// (the bold route only grows, and is drawn over everything each time).
static void draw_moving(Ctx *c){
  const EnrScene *scene=c->s;
  draw_body(c);
  if(scene->flags&ENR_MINUTE_FLAG)draw_flag(c);
  Px *text=scratch;
  const int n=text_pixels(c->m->zulu,5,scene->zulu_x,scene->zulu_baseline,text);
  letter(c,text,n,ENR_INK,1);
  int len=0;while(len<(int)sizeof c->m->top&&c->m->top[len])len++;
  if(len)letter(c,text,text_pixels(c->m->top,len,6,11,text),ENR_INK,1);
}
static int render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride,const uint16_t *mask){
  minute=minute<0?0:minute>59?59:minute;
  Ctx c={scene,&scene->minutes[minute],frame,row_stride,{0,0,0},0,false,{0,0,0,0}};
  const int drawn=draw_base(&c,mask);
  draw_bold_route(&c,minute);
  draw_moving(&c);
  return drawn;
}
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride){render(scene,minute,frame,row_stride,NULL);}

static void night_blocks(const EnrScene *s,int m0,int m1,uint16_t *mask){
  enr_real lo[2][BLOCKS],hi[2][BLOCKS];
  block_bounds(s,m0,lo[0],hi[0]);block_bounds(s,m1,lo[1],hi[1]);
  for(int y=0;y<H;y++)for(int b=0;b<BLOCKS;b++){
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
  // What moved: where it was and where it is.
  for(int k=0;k<2;k++){
    Ctx c={scene,&scene->minutes[k?minute:from],frame,row_stride,{0,0,0},0,true,{W,H,-1,-1}};
    draw_moving(&c);box_blocks(c.box,mask);
  }
  return render(scene,minute,frame,row_stride,mask);
}

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
  if(memcmp(magic,"GTS2",4)||u16(&r)!=W||u16(&r)!=H)return false;
  s->flags=u8(&r);s->body=u8(&r);s->forward=(int8_t)u8(&r);u8(&r);s->hour_start=i32(&r);
  for(int k=0;k<ENR_ZONED;k++)for(int z=0;z<3;z++)s->zoned[k][z]=u8(&r);
  s->space=u8(&r);s->space_ink=u8(&r);s->screen=u8(&r);s->waterline=u8(&r);s->terminator=u8(&r);s->night_dots=u8(&r);
  for(int k=0;k<5;k++)s->tints[k]=u8(&r);
  for(int k=0;k<2;k++)s->depths[k]=u8(&r);
  for(int y=0;y<H;y++)s->row_cos[y]=f64(&r);
  for(int y=0;y<H;y++)s->row_sin[y]=f64(&r);
  for(int x=0;x<W;x++)s->col_cos[x]=f64(&r);
  for(int x=0;x<W;x++)s->col_sin[x]=f64(&r);
  s->c1x=f64(&r);s->normal_x=f64(&r);s->normal_y=f64(&r);s->zulu_x=i16(&r);s->zulu_baseline=i16(&r);
  for(int m=0;m<60;m++){
    EnrMinute *e=&s->minutes[m];
    for(int k=0;k<3;k++)e->sun[k]=f64(&r);
    e->mx=f64(&r);e->my=f64(&r);e->moon_fraction=f64(&r);e->waxing=u8(&r);take(&r,e->zulu,5);take(&r,e->minute,2);take(&r,e->top,24);
  }
  s->track_count=u16(&r);
  s->track=alloc(sizeof(EnrPoint)*(s->track_count?s->track_count:1));
  if(!s->track)return false;
  for(int k=0;k<s->track_count;k++){EnrPoint *p=&s->track[k];p->x=f64(&r);p->y=f64(&r);p->seconds=i32(&r);p->hour=u8(&r);}
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
  return true;
}
void enr_free(EnrScene *s,void (*release)(void *)){
  if(s->track)release(s->track);
  if(s->owns_runs)release((void *)s->runs);
  s->track=0;s->runs=0;s->owns_runs=false;
}
