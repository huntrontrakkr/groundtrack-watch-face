// The hour chart on the watch. See chart.h. Each part names the JavaScript
// it mirrors; arithmetic follows it operation for operation (doubles where
// it uses numbers, floats where it stores Float32Array values), with sine
// and cosine from fmath.c. Build without fused multiply-adds.
#include "chart.h"
#include "fmath.h"
#include "departure_font.h"
#include "generated/chart_data.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define W CHART_W
#define H CHART_H
static const double RAD=M_PI/180;
enum {G_WATER,G_LAND,G_SPACE,G_TINT0,G_DEPTH0=8};
enum {L_PLAIN,L_CONTOUR,L_COAST,L_SHELF,L_WATERLINE,L_CLEARED,L_GRID,L_ROUTE,L_INK,L_MARK,L_SPACE_INK,L_SPACE,L_EARLY_CLEARED,L_EARLY_INK};
enum {M_SEA,M_LAND,M_COAST,M_WAVE};

// JavaScript's Math.round: the nearest integer, halves up.
static double js_round(double v){const double r=floor(v);return v-r>=0.5?r+1:r;}
// geometry.js wrap(): longitude into -180..180.
static double wrap(double lon){return fmod(fmod(lon+180,360)+360,360)-180;}

// ---------------------------------------------------------------- camera
// chartCamera(body, start, {span: SPAN}) for the Sun and Moon.
typedef struct {double lat0,k,scale,lonMid,x0,y0;} Cam;
static double sx(const Cam *c,double lon){return c->x0+(lon-c->lonMid)*c->k*c->scale;}
static double sy(const Cam *c,double lat){return c->y0-(lat-c->lat0)*c->scale;}
static double glat(const Cam *c,double y){return c->lat0+(c->y0-y)/c->scale;}
static double glon(const Cam *c,double x){return c->lonMid+(x-c->x0)/(c->k*c->scale);}
// project(): the copy of a longitude nearest the middle of the view.
static void project(const Cam *c,double lat,double lon,double *x,double *y){
  static const double turns[3]={-360,0,360};double best=0;bool have=false;
  for(int t=0;t<3;t++){const double q=sx(c,lon+turns[t]);if(!have||fabs(q-c->x0)<fabs(best-c->x0)){best=q;have=true;}}
  *x=best;*y=sy(c,lat);
}

typedef struct {SegmentFn fn;void *ctx;} Segs;
static bool body_position(const Segs *s,bool moon,int64_t t,double *lat,double *lon){
  const Segment *seg=s->fn(s->ctx,(int32_t)(t/86400));
  if(!seg)return false;
  seg_position(seg,moon,t,lat,lon);return true;
}

// ---------------------------------------------------------------- map rows
// The map rows a pixel row reads, kept while it needs them. Rows are asked
// for in order, so the cursor only moves forward.
#define ROW_SLOTS 6
typedef struct {
  MapCursor cursor;bool started;int last;       // last row decoded
  int row[ROW_SLOTS];uint8_t relief[ROW_SLOTS][MAP_WIDTH],land[ROW_SLOTS][MAP_WIDTH/8];
  const MapPack *pack;MapWork *work;
} Rows;
static int slot_of(Rows *r,int row){for(int i=0;i<ROW_SLOTS;i++)if(r->row[i]==row)return i;return -1;}
// Makes rows lo..hi (world rows, clamped) available, dropping older ones.
static bool need_rows(Rows *r,int lo,int hi){
  if(lo<0)lo=0;
  if(hi>719)hi=719;
  for(int i=0;i<ROW_SLOTS;i++)if(r->row[i]>=0&&r->row[i]<lo)r->row[i]=-1;
  for(int want=lo;want<=hi;want++){
    if(slot_of(r,want)>=0)continue;
    if(!r->started||want<=r->last){if(!map_cursor_start(&r->cursor,r->pack,r->work,want))return false;r->started=true;r->last=-1;}
    const uint8_t *relief,*land;int got;
    while((got=map_cursor_next(&r->cursor,&relief,&land))>=0){
      r->last=got;
      if(got==want){
        int s=-1;for(int i=0;i<ROW_SLOTS;i++)if(r->row[i]<0){s=i;break;}
        if(s<0)return false;
        r->row[s]=got;memcpy(r->relief[s],relief,MAP_WIDTH);memset(r->land[s],0,MAP_WIDTH/8);
        for(int x=0;x<MAP_WIDTH;x++)if(land[x])r->land[s][x>>3]|=(uint8_t)(1<<(x&7));
        break;
      }
    }
    if(got<0)return false;
  }
  return true;
}
static float meters(int code){float f;const uint32_t b=RELIEF_METERS_BITS[code];memcpy(&f,&b,4);return f;}
static int map_row(Rows *r,int y){y=y<0?0:y>719?719:y;return slot_of(r,y);}
// chart-render.js coverage(): bilinear land between cell centres.
static double coverage(Rows *r,double lat,double lon){
  const double u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=floor(u),j=floor(v),fu=u-i,fv=v-j;
  const int s0=map_row(r,(int)j),s1=map_row(r,(int)j+1);
  #define BIT(s,xx) ((s)<0?0:(r->land[s][(((int)(xx)%1440)+1440)%1440>>3]>>((((int)(xx)%1440)+1440)%1440&7))&1)
  return ((double)BIT(s0,i)*(1-fu)+(double)BIT(s0,i+1)*fu)*(1-fv)+((double)BIT(s1,i)*(1-fu)+(double)BIT(s1,i+1)*fu)*fv;
  #undef BIT
}
// relief.js reliefAt(): bilinear height in metres.
static double relief_at(Rows *r,double lat,double lon){
  const double u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=floor(u),j=floor(v),fu=u-i,fv=v-j;
  const int s0=map_row(r,(int)j),s1=map_row(r,(int)j+1);
  #define AT(s,xx) ((s)<0?0.0:(double)meters(r->relief[s][(((int)(xx)%1440)+1440)%1440]))
  return (AT(s0,i)*(1-fu)+AT(s0,i+1)*fu)*(1-fv)+(AT(s1,i)*(1-fu)+AT(s1,i+1)*fu)*fv;
  #undef AT
}
static int map_row_of(double lat){return (int)floor((90-lat)*4-.5);}

// ---------------------------------------------------------------- relief smoothing
// reliefLayer(): three passes of a three-tap box, across then down, each
// stored as float. Rows flow through three stages as they are sampled.
typedef void (*EmitFn)(void *ctx,int row,const float *values);
typedef struct {float t[3][W];int rows;EmitFn emit;void *ctx;} Smooth;
static void smooth_push(Smooth *s,const float *in){
  const int r=s->rows++;float *t=s->t[r%3];
  for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int xx=x+d;if(xx>=0&&xx<W){sum+=(double)in[xx];n++;}}t[x]=(float)(sum/n);}
  if(r>=1){
    float out[W];const int y=r-1;
    for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int yy=y+d;if(yy>=0&&yy<H&&yy<=r){sum+=(double)s->t[yy%3][x];n++;}}out[x]=(float)(sum/n);}
    s->emit(s->ctx,y,out);
  }
}
static void smooth_finish(Smooth *s){
  float out[W];const int y=s->rows-1;
  for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int yy=y+d;if(yy>=0&&yy<H&&yy<=y){sum+=(double)s->t[yy%3][x];n++;}}out[x]=(float)(sum/n);}
  s->emit(s->ctx,y,out);
}

// ---------------------------------------------------------------- the ground
#define LAND_RING 16
#define E3_RING 8
typedef struct {
  const Cam *cam;const Plate *pal;uint8_t *classes;
  Smooth s1,s2,s3;
  uint8_t land[LAND_RING][W];int land_rows;    // land bits of pixel rows computed
  float e3[E3_RING][W];int e3_rows;           // smoothed relief rows emitted
  int done;                                   // rows finalised
} Ground;
static void emit2(void *ctx,int row,const float *v){Ground *g=ctx;(void)row;smooth_push(&g->s3,v);}
static void emit1(void *ctx,int row,const float *v){Ground *g=ctx;(void)row;smooth_push(&g->s2,v);}
static void emit3(void *ctx,int row,const float *v){Ground *g=ctx;memcpy(g->e3[row%E3_RING],v,sizeof(float)*W);g->e3_rows=row+1;}
static bool is_land(const Ground *g,int x,int y){return g->land[y%LAND_RING][x];}
// seaDistance(): chessboard distance to the nearest land pixel, capped at 6.
static int sea_distance(const Ground *g,int x,int y){
  int best=6;
  for(int dy=-5;dy<=5;dy++){
    const int yy=y+dy,ady=dy<0?-dy:dy;if(yy<0||yy>=H||ady>=best)continue;
    for(int dx=0;dx<best&&dx<=5;dx++){
      if((x-dx>=0&&is_land(g,x-dx,yy))||(x+dx<W&&is_land(g,x+dx,yy))){const int d=ady>dx?ady:dx;if(d<best)best=d;break;}
    }
  }
  return best;
}
// The waterlines' distance: steps along rows and columns, capped at 6.
static int shore_distance(const Ground *g,int x,int y){
  int best=6;
  for(int dy=-5;dy<=5;dy++){
    const int yy=y+dy,ady=dy<0?-dy:dy;if(yy<0||yy>=H||ady>=best)continue;
    for(int dx=0;ady+dx<best;dx++){
      if((x-dx>=0&&is_land(g,x-dx,yy))||(x+dx<W&&is_land(g,x+dx,yy))){best=ady+dx;break;}
    }
  }
  return best;
}
static int material(const Ground *g,int x,int y){
  if(is_land(g,x,y))return M_LAND;
  const int d=sea_distance(g,x,y);
  return d<=1?M_COAST:d==4?M_WAVE:M_SEA;
}
static int level_of(double v){int k=0;for(int c=0;c<6;c++)if(v>=CHART_CONTOURS[c])k++;return k;}
// Neighbour j of pixel i = y*W+x, with the JavaScript's flat indexing: i-1 at
// x = 0 is the previous row's last pixel.
static bool neighbour(int x,int y,int which,int *nx,int *ny){
  int i=y*W+x,j=which==0?i-1:which==1?i+1:which==2?i-W:i+W;
  if(j<0||j>=W*H)return false;
  *nx=j%W;*ny=j/W;return true;
}
static void finalise_row(Ground *g,int y){
  const Plate *pal=g->pal;const bool sparse=false;
  for(int x=0;x<W;x++){
    const int i=y*W+x,m=material(g,x,y);const bool land=m==M_LAND;
    const double relief=(double)g->e3[y%E3_RING][x];
    int overlay=0;
    // contourLevel()
    int level=0;
    if(land){
      const int k=level_of(relief);
      if(k)for(int w=0;w<4;w++){int nx,ny;if(!neighbour(x,y,w,&nx,&ny))continue;if(material(g,nx,ny)==M_LAND&&level_of((double)g->e3[ny%E3_RING][nx])<k){level=CHART_CONTOURS[k-1];break;}}
    }
    if(level&&((level!=CHART_CONTOURS[0]&&!(pal->flags&PLATE_DOTS))||((x+y)&1)==0))overlay=L_CONTOUR;
    else if(m==M_COAST)overlay=L_COAST;
    else if(!sparse&&!land&&relief<CHART_SHELF&&((x+y)&1)==0&&({bool any=false;for(int w=0;w<4&&!any;w++){int nx,ny;if(neighbour(x,y,w,&nx,&ny)&&material(g,nx,ny)!=M_LAND&&(double)g->e3[ny%E3_RING][nx]>=CHART_SHELF)any=true;}any;}))overlay=L_SHELF;
    else if((pal->flags&PLATE_WATERLINE)&&!sparse&&!land&&({const int d=shore_distance(g,x,y);d>=2&&d<=5;})&&y%3==0)overlay=L_WATERLINE;
    // The ground class: tints by height on land, depths at sea.
    int ground=land?G_LAND:G_WATER;
    if(land&&pal->tint_count){int k=0;while(k<pal->tint_count-1&&!(relief<pal->tint_limits[k]))k++;ground=G_TINT0+k;}
    else if(!land&&pal->depth_count){int k=0;while(k<pal->depth_count-1&&!(relief>=pal->depth_limits[k]))k++;ground=G_DEPTH0+k;}
    g->classes[i]=(uint8_t)(overlay<<4|ground);
  }
}
static bool build_ground(Ground *gp,const Cam *cam,const Plate *pal,Rows *rows,uint8_t *classes){
  Ground *const g_=gp;memset(g_,0,sizeof *g_);
  #define g (*g_)
  g.cam=cam;g.pal=pal;g.classes=classes;
  g.s1.emit=emit1;g.s1.ctx=&g;g.s2.emit=emit2;g.s2.ctx=&g;g.s3.emit=emit3;g.s3.ctx=&g;
  static const double SAMPLES[4][2]={{.25,.25},{.75,.25},{.25,.75},{.75,.75}};
  for(int y=0;y<H;y++){
    // The map rows under this pixel row's samples.
    const int a=map_row_of(glat(cam,y+.25)),b=map_row_of(glat(cam,y+.75));
    if(!need_rows(rows,a,b+1))return false;
    float e0[W];uint8_t *land=g.land[y%LAND_RING];
    for(int x=0;x<W;x++){
      double c=0;for(int s=0;s<4;s++)c+=coverage(rows,glat(cam,y+SAMPLES[s][1]),glon(cam,x+SAMPLES[s][0]));
      land[x]=c>=2;
      const double lat=glat(cam,y+.5);
      e0[x]=(float)(fabs(lat)<=90?relief_at(rows,lat,glon(cam,x+.5)):0);
    }
    g.land_rows=y+1;
    smooth_push(&g.s1,e0);
    while(g.done<H&&g.done+6<g.land_rows&&(g.done+1<g.e3_rows||g.e3_rows==H))finalise_row(&g,g.done++);
  }
  smooth_finish(&g.s1);smooth_finish(&g.s2);smooth_finish(&g.s3);
  while(g.done<H)finalise_row(&g,g.done++);
  #undef g
  return true;
}

// ---------------------------------------------------------------- drawing
// renderEnroute()'s plot and knockout, writing layers instead of colours.
typedef struct {uint8_t *c;bool early;} Canvas;
static void plot(Canvas *cv,double fx,double fy,int layer){
  const double x=js_round(fx),y=js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  const int i=(int)y*W+(int)x;
  if(layer==L_INK&&cv->early)layer=L_EARLY_INK;
  cv->c[i]=(uint8_t)((cv->c[i]&15)|layer<<4);
}
static void clear(Canvas *cv,double fx,double fy){
  const double x=js_round(fx),y=js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  const int i=(int)y*W+(int)x;
  cv->c[i]=(uint8_t)((cv->c[i]&15)|(cv->early?L_EARLY_CLEARED:L_CLEARED)<<4);
}
typedef struct {int16_t x,y;} Px;
// letter(): a halo of knockout round every pixel, then the ink; over space
// the ink is the space ink.
static void letter(Canvas *cv,const Px *px,int n,int layer,int halo){
  for(int i=0;i<n;i++)for(int dy=-halo;dy<=halo;dy++)for(int dx=-halo;dx<=halo;dx++)clear(cv,px[i].x+dx,px[i].y+dy);
  for(int i=0;i<n;i++){
    const int cx=px[i].x<0?0:px[i].x>W-1?W-1:px[i].x,cy=px[i].y<0?0:px[i].y>H-1?H-1:px[i].y;
    plot(cv,px[i].x,px[i].y,(cv->c[cy*W+cx]&15)==G_SPACE?L_SPACE_INK:layer);
  }
}
static const EnrGlyph *glyph(char ch){const char *p=strchr(ENR_FONT_CHARS,ch);return p&&ch?&ENR_FONT_GLYPHS[p-ENR_FONT_CHARS]:0;}
static int text_width(const char *t){int w=0;for(;*t;t++){const EnrGlyph *g=glyph(*t);if(g)w+=g->advance;}return w;}
static int text_pixels(const char *t,int x,int baseline,Px *out){
  int n=0,cx=x;
  for(;*t;t++){const EnrGlyph *g=glyph(*t);if(!g)continue;
    for(int r=0;r<g->count;r++){const EnrRun *run=&ENR_FONT_RUNS[g->first+r];for(int k=0;k<run->n;k++)out[n++]=(Px){(int16_t)(cx+g->left+run->x+k),(int16_t)(baseline-g->top+run->y)};}
    cx+=g->advance;}
  return n;
}
// segment(): Bresenham between rounded ends.
typedef void (*PixelFn)(Canvas *cv,int x,int y,void *arg);
static void segment(Canvas *cv,double ax,double ay,double bx,double by,PixelFn fn,void *arg){
  int x=(int)js_round(ax),y=(int)js_round(ay);const int xx=(int)js_round(bx),yy=(int)js_round(by);
  const int dx=abs(xx-x),sx_=x<xx?1:-1,dy=-abs(yy-y),sy_=y<yy?1:-1;int err=dx+dy;
  for(int n=0;n<4000;n++){fn(cv,x,y,arg);if(x==xx&&y==yy)break;const int e=2*err;if(e>=dy){err+=dy;x+=sx_;}if(e<=dx){err+=dx;y+=sy_;}}
}
static void casing_pixel(Canvas *cv,int x,int y,void *arg){for(int dy=-2;dy<=2;dy++)for(int dx=-1;dx<=1;dx++)clear(cv,x+dx,y+dy);}
static void route_pixel(Canvas *cv,int x,int y,void *arg){
  const bool hour=*(bool *)arg;
  if(!hour){if(((x+y)>>1)%2==0)plot(cv,x,y,L_ROUTE);return;}
  plot(cv,x,y,L_ROUTE);
}
// The figures: Jost digits, bottom-aligned on a shared baseline.
static const FigureGlyph *figure(int size,char c){for(int s=0;s<5;s++)if(FIGURE_SIZES[s]==size)return &FIGURE_GLYPHS[s*10+(c-'0')];return 0;}
static int gap_for(int size){return (int)js_round(size/16.0);}
static int run_width(const char *t,int size){int w=0,n=0;for(;*t;t++,n++)w+=figure(size,*t)->width;return w+gap_for(size)*(n-1);}
// A run of figures laid out as figurePixels() does: glyph i at (x[i], y[i]).
typedef struct {const FigureGlyph *g[3];int x[3],y[3],n,x0,y0,x1,y1;} FigureRun;
static void figure_run(const char *t,int size,int x,int y,FigureRun *r){
  int h=0;for(const char *p=t;*p;p++){const int gh=figure(size,*p)->height;if(gh>h)h=gh;}
  r->n=0;int cx=x;r->x0=x;r->y0=y;r->x1=x;r->y1=y;
  for(;*t&&r->n<3;t++){
    const FigureGlyph *g=figure(size,*t);r->g[r->n]=g;r->x[r->n]=cx;r->y[r->n]=y+h-g->height;
    if(cx+g->width>r->x1)r->x1=cx+g->width;
    if(y+h>r->y1)r->y1=y+h;
    r->n++;cx+=g->width+gap_for(size);
  }
}
static bool figure_solid(const FigureRun *r,int x,int y){
  for(int i=0;i<r->n;i++){
    const FigureGlyph *g=r->g[i];const int gx=x-r->x[i],gy=y-r->y[i];
    if(gx<0||gy<0||gx>=g->width||gy>=g->height)continue;
    if(FIGURE_BITS[g->first+gy*((g->width+7)/8)+(gx>>3)]&(128>>(gx&7)))return true;
  }
  return false;
}
// The pixels letter() takes: the solid figure, or its outline() of `ring`.
static bool figure_pixel(const FigureRun *r,int x,int y,int ring){
  if(!figure_solid(r,x,y))return false;
  if(!ring)return true;
  for(int k=1;k<=ring;k++)if(!figure_solid(r,x+k,y)||!figure_solid(r,x-k,y)||!figure_solid(r,x,y+k)||!figure_solid(r,x,y-k))return true;
  return false;
}
static void letter_figure(Canvas *cv,const FigureRun *r,int ring,int layer){
  for(int y=r->y0;y<r->y1;y++)for(int x=r->x0;x<r->x1;x++)if(figure_pixel(r,x,y,ring))for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)clear(cv,x+dx,y+dy);
  for(int y=r->y0;y<r->y1;y++)for(int x=r->x0;x<r->x1;x++)if(figure_pixel(r,x,y,ring)){
    const int cx=x<0?0:x>W-1?W-1:x,cy=y<0?0:y>H-1?H-1:y;
    plot(cv,x,y,(cv->c[cy*W+cx]&15)==G_SPACE?L_SPACE_INK:layer);
  }
}
typedef struct {int x,y,w,h;} Box;
static bool overlaps(const Box *taken,int n,Box b){for(int i=0;i<n;i++)if(taken[i].x<b.x+b.w&&b.x<taken[i].x+taken[i].w&&taken[i].y<b.y+b.h&&b.y<taken[i].y+taken[i].h)return true;return false;}

static const char *const HEXAGON[5]={"..###..",".#...#.","#.....#",".#...#.","..###.."};
static const char *const TRIANGLE[7]={"....#....","...#.#...","...#.#...","..#...#..","..#...#..",".#.....#.","#########"};
static const char *const AIRPORT[11]={".....#.....",".....#.....","....###....","...#...#...","..#.....#..","###.....###","..#.....#..","...#...#...","....###....",".....#.....",".....#....."};
static void symbol(Canvas *cv,const char *const *rows,int count,int cx,int cy){
  for(int dy=0;dy<count;dy++){
    const char *row=rows[dy];const int len=(int)strlen(row);
    int first=-1,last=-1;for(int k=0;k<len;k++)if(row[k]=='#'){if(first<0)first=k;last=k;}
    for(int dx=0;dx<len;dx++){
      const int x=cx-(len>>1)+dx,y=cy-(count>>1)+dy;
      if(row[dx]=='#')plot(cv,x,y,L_INK);
      else if(first<dx&&dx<last)clear(cv,x,y);
    }
  }
}

static const char *const MONTHS[12]={"JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"};
// Integer to decimal, zero-padded to `width`.
static char *put_int(char *p,int v,int width){char d[12];int n=0;do{d[n++]=(char)('0'+v%10);v/=10;}while(v);while(n<width)d[n++]='0';while(n)*p++=d[--n];*p=0;return p;}

#define SCRATCH 512
typedef struct {double lat,lon,x,y;int64_t t;bool hour;} TrackPoint;
struct ChartWork {Ground ground;Rows rows;Px scratch[SCRATCH];TrackPoint track[CHART_TRACK_MAX];};
unsigned chart_work_size(void){return sizeof(ChartWork);}

// ---------------------------------------------------------------- the hour
bool chart_build(const ChartInput *in,const MapPack *pack,MapWork *work,SegmentFn fn,void *ctx,ChartWork *wk,EnrScene *out,uint8_t *classes,EnrPoint *points){
  const Plate *pal=&PLATES[in->plate];const Segs segs={fn,ctx};const bool moon=in->body==1;
  Px *const scratch=wk->scratch;
  // chartCamera(): the hour and forty minutes either side, a minute apart.
  TrackPoint *const track=wk->track;
  int count=0;double turn=0,prev=0;
  for(int64_t t=in->start-2400;t<=in->start+6000;t+=60){
    double lat,lon;if(!body_position(&segs,moon,t,&lat,&lon))return false;
    if(count){const double d=lon-prev;if(d>180)turn-=360;else if(d<-180)turn+=360;}
    prev=lon;
    track[count].lat=lat;track[count].lon=lon+turn;track[count].t=t;track[count].hour=t>=in->start&&t<=in->start+3600;count++;
  }
  double maxlat=-INFINITY,minlat=INFINITY,maxlon=-INFINITY,minlon=INFINITY;int h0=-1,h1=-1;
  for(int i=0;i<count;i++)if(track[i].hour){
    if(h0<0)h0=i;
    h1=i;
    if(track[i].lat>maxlat)maxlat=track[i].lat;
    if(track[i].lat<minlat)minlat=track[i].lat;
    if(track[i].lon>maxlon)maxlon=track[i].lon;
    if(track[i].lon<minlon)minlon=track[i].lon;
  }
  Cam cam;
  cam.lat0=(maxlat+minlat)/2;cam.k=f_cos(cam.lat0*RAD);
  {const double spread=(maxlon-minlon)*cam.k;cam.scale=CHART_SPAN/(spread>1?spread:1);}
  cam.y0=CHART_TRACK_Y;cam.lonMid=(maxlon+minlon)/2;cam.x0=W/2;
  for(int i=0;i<count;i++){track[i].x=sx(&cam,track[i].lon);track[i].y=sy(&cam,track[i].lat);}
  const int top=0,bottom=H;

  // The ground.
  Rows *const rows=&wk->rows;memset(rows,0,sizeof *rows);rows->pack=pack;rows->work=work;for(int i=0;i<ROW_SLOTS;i++)rows->row[i]=-1;
  memset(out,0,sizeof *out);
  if(!build_ground(&wk->ground,&cam,pal,rows,classes))return false;
  Canvas cv={classes,true};

  // Graticule: crosses every 5 degrees, a degree tick along each edge.
  const int step=5,minor=1;
  {const double g0lat=glat(&cam,bottom),g0lon=glon(&cam,0),g1lat=glat(&cam,top),g1lon=glon(&cam,W);
  for(double lat=ceil(g0lat/step)*step;lat<=g1lat;lat+=step)for(double lon=ceil(g0lon/step)*step;lon<=g1lon;lon+=step){
    const double x=js_round(sx(&cam,lon)),y=js_round(sy(&cam,lat));if(!(y>=top&&y<=bottom))continue;
    for(int d=-2;d<=2;d++){plot(&cv,x+d,y,L_GRID);plot(&cv,x,y+d,L_GRID);}
  }
  for(double lon=ceil(g0lon/minor)*minor;lon<=g1lon;lon+=minor){
    const double x=js_round(sx(&cam,lon));const int len=fmod(lon,step)==0?4:2;
    for(int d=0;d<len;d++){plot(&cv,x,top+d,L_GRID);plot(&cv,x,bottom-d,L_GRID);}
  }
  for(double lat=ceil(g0lat/minor)*minor;lat<=g1lat;lat+=minor){
    const double y=js_round(sy(&cam,lat));const int len=fmod(lat,step)==0?4:2;if(!(y>=top&&y<=bottom))continue;
    for(int d=0;d<len;d++){plot(&cv,d,y,L_GRID);plot(&cv,W-1-d,y,L_GRID);}
  }}

  // Home, placed first so the network gives way; drawn last.
  Box taken[64];int taken_n=0;
  taken[taken_n++]=(Box){0,H-16,W,16};if(in->home)taken[taken_n++]=(Box){0,0,W,14};
  bool home_mark=false;int hx=0,hy=0;Px home_code[64];int home_code_n=0;
  if(in->home){
    double qx,qy;project(&cam,in->home_lat,in->home_lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
    const int w=text_width("HOM");const bool right=x+7+w<W-3;const Box box={right?x-5:x-8-w,y-6,w+13,13};
    if(x>=4&&x<=W-5&&y>=top+6&&y<=bottom-6&&!overlaps(taken,taken_n,box)){
      home_code_n=text_pixels("HOM",right?x+7:x-7-w,y+4,home_code);taken[taken_n++]=box;home_mark=true;hx=x;hy=y;
    }
  }
  // The tracking stations, circled, with their codes.
  for(unsigned s=0;s<sizeof STATIONS/sizeof STATIONS[0];s++){
    double qx,qy;project(&cam,STATIONS[s].lat,STATIONS[s].lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
    if(x<4||x>W-5||y<top+6||y>bottom-6)continue;
    const int w=text_width(STATIONS[s].code);const bool right=x+5+w<W-3;const Box box={right?x-3:x-6-w,y-5,w+9,11};
    if(overlaps(taken,taken_n,box))continue;
    if(taken_n<64)taken[taken_n++]=box;
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){const int r=dx*dx+dy*dy;if(r<=5&&r>=3)plot(&cv,x+dx,y+dy,L_INK);}
    plot(&cv,x,y,L_INK);
    const int n=text_pixels(STATIONS[s].code,right?x+5:x-5-w,y+4,scratch);letter(&cv,scratch,n,L_INK,1);
  }
  // The route: cased in white on a one-ink plate; dashed outside the hour.
  #define JUMP(a,b) (fabs(track[b].x-track[a].x)>W/2)
  if(pal->flags&PLATE_MONO)for(int i=1;i<count;i++){
    if(JUMP(i-1,i)||!(track[i-1].hour&&track[i].hour))continue;
    segment(&cv,track[i-1].x,track[i-1].y,track[i].x,track[i].y,casing_pixel,0);
  }
  cv.early=false;
  for(int i=1;i<count;i++){
    if(JUMP(i-1,i))continue;
    bool hour=track[i-1].hour&&track[i].hour;
    segment(&cv,track[i-1].x,track[i-1].y,track[i].x,track[i].y,route_pixel,&hour);
  }
  // The route as a scale: minute graduations, the quarters numbered.
  for(int i=1;i<count-1;i++){
    if(!track[i].hour)continue;
    const int64_t since=track[i].t-track[h0].t;const int m=(int)js_round(since/60.0);
    if(since%60||m<=0||m>=60)continue;
    const double len0=sqrt((track[i+1].x-track[i-1].x)*(track[i+1].x-track[i-1].x)+(track[i+1].y-track[i-1].y)*(track[i+1].y-track[i-1].y)),len=len0?len0:1;
    double nx=-(track[i+1].y-track[i-1].y)/len,ny=(track[i+1].x-track[i-1].x)/len;if(ny<0){nx=-nx;ny=-ny;}
    const int size=m%15==0?6:m%5==0?4:2;
    for(int s=1;s<=size;s++)plot(&cv,track[i].x+nx*s,track[i].y+ny*s,L_ROUTE);
    if(m%15==0){
      char label[4];label[0]=(char)('0'+m/10);label[1]=(char)('0'+m%10);label[2]=0;
      const int lw=text_width(label);
      const int n=text_pixels(label,(int)js_round(track[i].x+nx*8-lw/2.0)+1,(int)js_round(track[i].y+ny*8+9),scratch);
      letter(&cv,scratch,n,L_ROUTE,(pal->flags&PLATE_MONO)?1:0);
    }
  }
  // This hour's VOR rose and hexagon; the next hour's reporting point.
  const int c0x=(int)js_round(track[h0].x),c0y=(int)js_round(track[h0].y),c1x=(int)js_round(track[h1].x),c1y=(int)js_round(track[h1].y);
  {const int R=16;
  for(int a=0;a<720;a++){const double t=a*M_PI/360;plot(&cv,c0x+js_round(f_sin(t)*R),c0y-js_round(f_cos(t)*R),L_INK);}
  for(int a=0;a<360;a+=30){const int len=a%90==0?5:3;for(int r=R-len;r<R;r++){const double t=a*RAD;plot(&cv,c0x+js_round(f_sin(t)*r),c0y-js_round(f_cos(t)*r),L_INK);}}
  for(int k=0;k<3;k++)for(int d=-k;d<=k;d++){const int r=R+4-k;plot(&cv,c0x+js_round(f_sin(0)*r+f_cos(0)*d),c0y-js_round(f_cos(0)*r-f_sin(0)*d),L_INK);}}
  symbol(&cv,HEXAGON,5,c0x,c0y);plot(&cv,c0x,c0y,L_INK);symbol(&cv,TRIANGLE,7,c1x,c1y-1);
  // The hour figures: this hour solid over its rose, the next outlined.
  char hour[4],next[4];
  {const int hh=in->clock24?in->local_hour:(in->local_hour%12?in->local_hour%12:12),nh=in->clock24?(in->local_hour+1)%24:((in->local_hour+1)%12?(in->local_hour+1)%12:12);
  put_int(hour,hh,1);put_int(next,nh,1);}
  {const int size=strlen(hour)>1||strlen(next)>1?72:80,hw=run_width(hour,size),nw=run_width(next,size),fh=figure(size,'0')->height,gy=c0y-26-fh;
  #define PLACE(end,w) ({int v=(int)js_round((end)-(w)/2.0);v=v<W-4-(w)?v:W-4-(w);v>4?v:4;})
  FigureRun run;figure_run(hour,size,PLACE(c0x,hw),gy,&run);letter_figure(&cv,&run,0,L_INK);
  figure_run(next,size,PLACE(c1x,nw),gy,&run);letter_figure(&cv,&run,2,L_INK);
  #undef PLACE
  }
  // Home, over the route and figures, on its own knockout.
  if(home_mark){
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++)if(dx*dx+dy*dy<=36)clear(&cv,hx+dx,hy+dy);
    for(int dy=0;dy<11;dy++)for(int dx=0;dx<11;dx++)if(AIRPORT[dy][dx]=='#')plot(&cv,hx+dx-5,hy+dy-5,L_MARK);
    letter(&cv,home_code,home_code_n,L_MARK,1);
  }
  // Margins: the local date and day of the year, Zulu time between them;
  // over the chart, home's rise and set.
  char left[24],right_[24];
  {char *p=put_int(left,in->day,2);*p++=' ';memcpy(p,MONTHS[in->month-1],3);p+=3;*p++=' ';put_int(p,in->year,1);
  memcpy(right_,"DAY ",4);put_int(right_+4,in->day_of_year,3);}
  {const int y=H-5,lw=text_width(left),rw=text_width(right_);
  int n=text_pixels(left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
  n=text_pixels(right_,W-6-rw,y,scratch);letter(&cv,scratch,n,L_INK,1);
  const int l=6+lw,r=W-6-rw;out->zulu_x=(int16_t)js_round((l+r-text_width("0000Z"))/2.0);out->zulu_baseline=(int16_t)y;}
  if(in->home&&in->rise_left[0]){
    const int y=11,rw=text_width(in->rise_right);
    int n=text_pixels(in->rise_left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
    n=text_pixels(in->rise_right,W-6-rw,y,scratch);letter(&cv,scratch,n,L_INK,1);
  }

  // The scene: the plate, the night's tables, the minutes and the track.
  out->flags=(uint8_t)((pal->flags&PLATE_ZONES?1:0)|(pal->flags&PLATE_SCAN?2:0)|(pal->flags&PLATE_TERMINATOR?4:0)|(pal->flags&PLATE_NIGHT_DOTS?8:0)|(in->flag?16:0));
  out->body=(uint8_t)in->body;out->forward=(int8_t)(track[h1].x>track[h0].x?1:-1);out->hour_start=(int32_t)in->start;
  memcpy(out->zoned,pal->zoned,sizeof out->zoned);
  out->space=pal->space;out->space_ink=pal->space_ink;out->screen=pal->screen;out->waterline=pal->waterline;out->terminator=pal->terminator;out->night_dots=pal->night_dots;
  for(int k=0;k<5;k++)out->tints[k]=k<pal->tint_count?pal->tints[k]:0;
  for(int k=0;k<2;k++)out->depths[k]=k<pal->depth_count?pal->depths[k]:0;
  for(int y=0;y<H;y++){const double lat=glat(&cam,y+.5)*RAD;out->row_cos[y]=(enr_real)f_cos(lat);out->row_sin[y]=(enr_real)f_sin(lat);}
  for(int x=0;x<W;x++){const double lon=glon(&cam,x+.5)*RAD;out->col_cos[x]=(enr_real)f_cos(lon);out->col_sin[x]=(enr_real)f_sin(lon);}
  out->c1x=(enr_real)track[h1].x;out->normal_x=0;out->normal_y=-1;
  for(int m=0;m<60;m++){
    const int64_t t=in->start+m*60;EnrMinute *e=&out->minutes[m];
    double lat,lon;if(!body_position(&segs,false,t,&lat,&lon))return false;
    e->sun[0]=(enr_real)(f_cos(lat*RAD)*f_cos(lon*RAD));e->sun[1]=(enr_real)(f_cos(lat*RAD)*f_sin(lon*RAD));e->sun[2]=(enr_real)f_sin(lat*RAD);
    if(!body_position(&segs,moon,t,&lat,&lon))return false;
    double mx,my;project(&cam,lat,lon,&mx,&my);e->mx=(enr_real)mx;e->my=(enr_real)my;
    const Segment *seg=fn(ctx,(int32_t)(t/86400));bool waxing;double fraction;seg_moon_light(seg,t,&fraction,&waxing);e->moon_fraction=(enr_real)fraction;e->waxing=waxing;
    const int64_t day=t%86400;const int hh=(int)(day/3600),mm=(int)(day%3600/60);
    e->zulu[0]=(char)('0'+hh/10);e->zulu[1]=(char)('0'+hh%10);e->zulu[2]=(char)('0'+mm/10);e->zulu[3]=(char)('0'+mm%10);e->zulu[4]='Z';
    e->minute[0]=(char)('0'+mm/10);e->minute[1]=(char)('0'+mm%10);memset(e->top,0,sizeof e->top);
  }
  out->track_count=(uint16_t)count;out->track=points;
  for(int i=0;i<count;i++){points[i].x=(enr_real)track[i].x;points[i].y=(enr_real)track[i].y;points[i].seconds=(int32_t)(track[i].t-in->start);points[i].hour=track[i].hour;}
  return true;
}

bool chart_runs(const uint8_t *classes,EnrScene *s,void *(*alloc)(size_t)){
  unsigned n=0;
  for(int y=0;y<H;y++)for(int x=0;x<W;){int k=1;while(x+k<W&&k<255&&classes[y*W+x+k]==classes[y*W+x])k++;n+=2;x+=k;}
  uint8_t *runs=alloc(n?n:1);if(!runs)return false;
  n=0;s->row_offset[0]=0;
  for(int y=0;y<H;y++){for(int x=0;x<W;){int k=1;while(x+k<W&&k<255&&classes[y*W+x+k]==classes[y*W+x])k++;runs[n++]=(uint8_t)k;runs[n++]=classes[y*W+x];x+=k;}s->row_offset[y+1]=(uint16_t)n;}
  s->runs=runs;s->owns_runs=true;return true;
}
