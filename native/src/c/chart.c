// The hour chart on the watch. See chart.h. Each part names the JavaScript
// it mirrors; arithmetic follows it operation for operation (doubles where
// it uses numbers, floats where it stores Float32Array values), with sine
// and cosine from fmath.c. Build without fused multiply-adds.
#include "chart.h"
#include "fmath.h"
#include "face.h"
#include "departure_font.h"
#include "generated/chart_data.h"
#include "fuller.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define W CHART_W
#define H CHART_H
// Math.PI: this literal rounds to the same double.
#define PI 3.14159265358979323846
static const double RAD=PI/180;
enum {G_WATER,G_LAND,G_SPACE,G_TINT0,G_DEPTH0=8};
enum {L_PLAIN,L_CONTOUR,L_COAST,L_SHELF,L_WATERLINE,L_CLEARED,L_GRID,L_ROUTE,L_INK,L_MARK,L_SPACE_INK,L_NET_GRID,L_EARLY_CLEARED,L_EARLY_INK,L_LATE_CLEARED,L_LATE_INK};
enum {M_SEA,M_LAND,M_COAST,M_WAVE};

// JavaScript's Math.round: the nearest integer, halves up.
static double js_round(double v){const double r=floor(v);return v-r>=0.5?r+1:r;}
// geometry.js wrap(): longitude into -180..180.
static double wrap(double lon){return f_fmod(f_fmod(lon+180,360)+360,360)-180;}

// Where the last build failed (a line of this file), for the log.
static int s_failure_line;
#define FAIL do{s_failure_line=__LINE__;goto fail;}while(0)
const char *chart_failure(void){static char text[24];char *p=text;memcpy(p,"chart.c:",8);p+=8;int v=s_failure_line,n=0;char d[8];do{d[n++]=(char)('0'+v%10);v/=10;}while(v);while(n)*p++=d[--n];*p=0;return text;}
// ---------------------------------------------------------------- camera
// chartCamera(body, start, {span: SPAN}): the hour chart, or for a fast
// satellite the world band, between WORLD_NORTH and WORLD_SOUTH.
#define WORLD_NORTH 72
#define WORLD_SOUTH (-60)
// wide: a whole-orbit or whole-day view (fewer contours, a one-ink plate's
// waterlines left out); on a rolling Fuller sheet every satellite's.
typedef struct {double lat0,k,scale,lonMid,x0,y0;bool slow,world,day,wide;double nx,ny;int top,bottom;} Cam;
// The rolling Fuller sheet being built, if it is one: projection goes
// through it (roll.js project()).
static const FullerCam *s_roll;
static double sx(const Cam *c,double lon){return c->x0+(lon-c->lonMid)*c->k*c->scale;}
static double sy(const Cam *c,double lat){return c->y0-(lat-c->lat0)*c->scale;}
static double glat(const Cam *c,double y){return c->lat0+(c->y0-y)/c->scale;}
static double glon(const Cam *c,double x){return c->lonMid+(x-c->x0)/(c->k*c->scale);}
// project(): the copy of a longitude nearest the middle of the view.
static void project(const Cam *c,double lat,double lon,double *x,double *y){
  if(FACE_ROLL&&(!FACE_CHART||s_roll)){fuller_project(s_roll,lat,lon,x,y);return;}
  static const double turns[3]={-360,0,360};double best=0;bool have=false;
  for(int t=0;t<3;t++){const double q=sx(c,lon+turns[t]);if(!have||fabs(q-c->x0)<fabs(best-c->x0)){best=q;have=true;}}
  *x=best;*y=sy(c,lat);
}
static bool in_band(const Cam *c,double y){return y>=c->top&&y<=c->bottom;}

// enroute-render.js destination(): the point at an angular distance and
// bearing, with sines and cosines of the start and bearing given.
static void destination(double lat,double lon,double sp,double cp,double sd,double cd,double sb,double cb,double *qlat,double *qlon){
  const double q=f_asin(sp*cd+cp*sd*cb);
  *qlat=q/RAD;*qlon=lon+f_atan2(sb*sd*cp,cd-sp*f_sin(q))/RAD;
}
// home.js reach(): the ground range, in degrees, within which a satellite
// at altitude stands 10 degrees above the horizon; and a network station's
// acquisition circle (ACQUISITION: 5 degrees, a 410 km orbit).
#define EARTH 6371
static double reach(double altitude,double mask){const double m=mask*RAD;return (f_acos(EARTH*f_cos(m)/(EARTH+altitude))-m)/RAD;}
// The pixels of a circle of `distance` degrees round (lat, lon), every
// `step` degrees of bearing, on the copy nearest the centre's own x, within
// the band and the frame; returns how many, as x, y bytes.
// Bearings' sines and cosines, every `step` degrees.
static void bearings(int step,double *sb,double *cb){for(int k=0,bearing=0;bearing<360;bearing+=step,k++){const double b=bearing*RAD;sb[k]=f_sin(b);cb[k]=f_cos(b);}}
static int circle_pixels_on(const Cam *cam,double lat,double lon,double distance,int step,const double *sb,const double *cb,uint8_t *out,bool net);
static int circle_pixels(const Cam *cam,double lat,double lon,double distance,int step,const double *sb,const double *cb,uint8_t *out){
  return circle_pixels_on(cam,lat,lon,distance,step,sb,cb,out,false);
}
// The same, leaving out points off a Fuller sheet's net (homeCircle()).
static int circle_pixels_on(const Cam *cam,double lat,double lon,double distance,int step,const double *sb,const double *cb,uint8_t *out,bool net){
  double qx,qy;project(cam,lat,lon,&qx,&qy);const double x=js_round(qx);
  const double p=lat*RAD,d=distance*RAD,sp=f_sin(p),cp=f_cos(p),sd=f_sin(d),cd=f_cos(d);int n=0;
  for(int k=0,bearing=0;bearing<360;bearing+=step,k++){
    double glat_,glon_,cx,cy;
    const double sbk=sb?sb[k]:f_sin(bearing*RAD),cbk=cb?cb[k]:f_cos(bearing*RAD);
    destination(lat,lon,sp,cp,sd,cd,sbk,cbk,&glat_,&glon_);project(cam,glat_,glon_,&cx,&cy);
    if(!(fabs(cx-x)<W/2&&in_band(cam,cy)))continue;
    if(FACE_ROLL&&net&&s_roll&&fuller_locate(s_roll,cx,cy,NULL)<0)continue;
    const double px=js_round(cx),py=js_round(cy);
    if(px>=0&&py>=0&&px<W&&py<H){out[2*n]=(uint8_t)px;out[2*n+1]=(uint8_t)py;n++;}
  }
  return n;
}

// ephemeris.js position(): the Sun or Moon from their segment, a satellite
// from its own.
static bool body_place(const ChartSources *src,int body,int64_t t,double *lat,double *lon,double *altitude);
static bool body_position(const ChartSources *src,int body,int64_t t,double *lat,double *lon){
  double altitude;return body_place(src,body,t,lat,lon,&altitude);
}
static bool body_place(const ChartSources *src,int body,int64_t t,double *lat,double *lon,double *altitude){
  if(body>=2){
    const SatSegment *seg=src->satellite?src->satellite(src->satellite_context,t):NULL;
    if(!seg)return false;
    sat_segment_position(seg,t,lat,lon,altitude);return true;
  }
  *altitude=0;
  const Segment *seg=src->segment(src->segment_context,(int32_t)(t/86400));
  if(!seg)return false;
  seg_position(seg,body==1,t,lat,lon);return true;
}

// ---------------------------------------------------------------- map rows
// The map rows a pixel row reads, kept while it needs them. Rows are asked
// for in order, so the cursor only moves forward.
#define ROW_SLOTS 6
typedef struct {
  MapCursor cursor;bool started;int last;       // last row decoded
  int row[ROW_SLOTS];uint8_t land[ROW_SLOTS][MAP_WIDTH/8];
  uint8_t *relief;int c0,n;                     // the columns under the chart: ROW_SLOTS rows of n from c0
  float meters[256];                            // relief codes to metres (from tables.bin)
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
        r->row[s]=got;memcpy(r->land[s],land,MAP_WIDTH/8);
        for(int k=0;k<r->n;k++)r->relief[s*r->n+k]=relief[(r->c0+k)%MAP_WIDTH];
        break;
      }
    }
    if(got<0)return false;
  }
  return true;
}
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
  #define AT(s,xx) ((s)<0?0.0:(double)(r->meters)[r->relief[(s)*r->n+((((int)(xx)%1440)+1440)%1440-r->c0+1440)%1440]])
  return (AT(s0,i)*(1-fu)+AT(s0,i+1)*fu)*(1-fv)+(AT(s1,i)*(1-fu)+AT(s1,i+1)*fu)*fv;
  #undef AT
}
static int map_row_of(double lat){return (int)floor((90-lat)*4-.5);}

// ---------------------------------------------------------------- relief smoothing
// reliefLayer(): three passes of a three-tap box, across then down, each
// stored as float. Rows flow through three stages as they are sampled.
typedef void (*EmitFn)(void *ctx,int row,const float *values);
// Every stage writes its output into one shared row (the stages run one
// inside another, each taking its input before writing): nothing large is
// kept on the stack.
typedef struct {float t[3][W];int rows;EmitFn emit;void *ctx;float *out;} Smooth;
static void smooth_push(Smooth *s,const float *in){
  const int r=s->rows++;float *t=s->t[r%3];
  for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int xx=x+d;if(xx>=0&&xx<W){sum+=(double)in[xx];n++;}}t[x]=(float)(sum/n);}
  if(r>=1){
    float *out=s->out;const int y=r-1;
    for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int yy=y+d;if(yy>=0&&yy<H&&yy<=r){sum+=(double)s->t[yy%3][x];n++;}}out[x]=(float)(sum/n);}
    s->emit(s->ctx,y,out);
  }
}
static void smooth_finish(Smooth *s){
  float *out=s->out;const int y=s->rows-1;
  for(int x=0;x<W;x++){double sum=0;int n=0;for(int d=-1;d<=1;d++){const int yy=y+d;if(yy>=0&&yy<H&&yy<=y){sum+=(double)s->t[yy%3][x];n++;}}out[x]=(float)(sum/n);}
  s->emit(s->ctx,y,out);
}

// ---------------------------------------------------------------- the ground
#define LAND_RING 16
#define E3_RING 8
// The ground's classes leave row by row as row runs: the class plane itself
// is made only once the map's decoder is done with. The runs go to an arena
// taken first, so the decoder's memory, freed, leaves one free stretch for
// the plane; any more go to chunks.
#define RUN_ARENA 16384
#define RUN_CHUNK 2048
typedef struct RunChunk {struct RunChunk *next;uint16_t used;uint8_t data[RUN_CHUNK];} RunChunk;
// cap: the arena's room for runs (a Fuller build keeps its track at the end).
typedef struct {uint8_t *arena;RunChunk *head,*tail;void *(*alloc)(size_t);uint16_t row_offset[H+1];unsigned n,cap;bool failed;} RunSink;
static int row_runs(const uint8_t *row,uint8_t *out);
static void sink_row(RunSink *k,int y,const uint8_t *row){
  uint8_t runs[2*W];const int n=row_runs(row,runs);
  int at=0;
  const unsigned cap=k->cap;
  if(k->arena&&k->n<cap){at=n<(int)(cap-k->n)?n:(int)(cap-k->n);memcpy(k->arena+k->n,runs,at);}
  for(;at<n&&!k->failed;){
    if(!k->tail||k->tail->used==RUN_CHUNK){
      RunChunk *c=k->alloc(sizeof(RunChunk));if(!c){k->failed=true;return;}
      c->next=NULL;c->used=0;if(k->tail)k->tail->next=c;else k->head=c;k->tail=c;
    }
    const int take=n-at<RUN_CHUNK-k->tail->used?n-at:RUN_CHUNK-k->tail->used;
    memcpy(k->tail->data+k->tail->used,runs+at,take);k->tail->used=(uint16_t)(k->tail->used+take);at+=take;
  }
  k->n+=(unsigned)n;k->row_offset[y+1]=(uint16_t)k->n;
}
typedef struct {
  const Cam *cam;const Plate *pal;RunSink *sink;uint8_t crow[W];
  Smooth s1,s2,s3;
  uint8_t land[LAND_RING][W/8+1];int land_rows; // land bits of pixel rows computed
  uint8_t space[LAND_RING][W/8+1];            // a Fuller sheet's pixels off its net
  float e3[E3_RING][W];int e3_rows;           // smoothed relief rows emitted
  float row[W];                               // the sampled row, then each stage's output
  int done;                                   // rows finalised
} Ground;
static void emit2(void *ctx,int row,const float *v){Ground *g=ctx;(void)row;smooth_push(&g->s3,v);}
static void emit1(void *ctx,int row,const float *v){Ground *g=ctx;(void)row;smooth_push(&g->s2,v);}
static void emit3(void *ctx,int row,const float *v){Ground *g=ctx;memcpy(g->e3[row%E3_RING],v,sizeof(float)*W);g->e3_rows=row+1;}
static bool is_land(const Ground *g,int x,int y){return (g->land[y%LAND_RING][x>>3]>>(x&7))&1;}
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
// The contours: every level; on the whole-day chart 2,000 and 4,000 m only.
static const int WIDE_CONTOURS[2]={2000,4000};
static int level_of_in(double v,const int *levels,int n){int k=0;for(int c=0;c<n;c++)if(v>=levels[c])k++;return k;}
// Neighbour j of pixel i = y*W+x, with the JavaScript's flat indexing: i-1 at
// x = 0 is the previous row's last pixel.
static bool neighbour(int x,int y,int which,int *nx,int *ny){
  int i=y*W+x,j=which==0?i-1:which==1?i+1:which==2?i-W:i+W;
  if(j<0||j>=W*H)return false;
  *nx=j%W;*ny=j/W;return true;
}
static void finalise_row(Ground *g,int y){
  const Plate *pal=g->pal;
  // At world scale coasts crowd together: a one-ink plate keeps its
  // waterlines and shelf edge for the zoomed charts.
  const bool sparse=(pal->flags&PLATE_MONO)&&(g->cam->world||g->cam->wide);
  const int *const levels=g->cam->wide?WIDE_CONTOURS:CHART_CONTOURS,nlevels=g->cam->wide?2:6;
  #define level_of(v) level_of_in(v,levels,nlevels)
  if(y<g->cam->top||y>g->cam->bottom){memset(g->crow,G_SPACE,W);sink_row(g->sink,y,g->crow);return;}
  for(int x=0;x<W;x++){
    if((g->space[y%LAND_RING][x>>3]>>(x&7))&1){g->crow[x]=G_SPACE;continue;}
    const int i=y*W+x,m=material(g,x,y);const bool land=m==M_LAND;
    const double relief=(double)g->e3[y%E3_RING][x];
    int overlay=0;
    // contourLevel()
    int level=0;
    if(land){
      const int k=level_of(relief);
      if(k)for(int w=0;w<4;w++){int nx,ny;if(!neighbour(x,y,w,&nx,&ny))continue;if(material(g,nx,ny)==M_LAND&&level_of((double)g->e3[ny%E3_RING][nx])<k){level=levels[k-1];break;}}
    }
    if(level&&((level!=CHART_CONTOURS[0]&&!(pal->flags&PLATE_DOTS))||((x+y)&1)==0))overlay=L_CONTOUR;
    else if(m==M_COAST)overlay=L_COAST;
    else if(!sparse&&!land&&relief<CHART_SHELF&&((x+y)&1)==0&&({bool any=false;for(int w=0;w<4&&!any;w++){int nx,ny;if(neighbour(x,y,w,&nx,&ny)&&material(g,nx,ny)!=M_LAND&&(double)g->e3[ny%E3_RING][nx]>=CHART_SHELF)any=true;}any;}))overlay=L_SHELF;
    else if((pal->flags&PLATE_WATERLINE)&&!sparse&&!land&&({const int d=shore_distance(g,x,y);d>=2&&d<=5;})&&y%3==0)overlay=L_WATERLINE;
    // The ground class: tints by height on land, depths at sea.
    int ground=land?G_LAND:G_WATER;
    if(land&&pal->tint_count){int k=0;while(k<pal->tint_count-1&&!(relief<pal->tint_limits[k]))k++;ground=G_TINT0+k;}
    else if(!land&&pal->depth_count){int k=0;while(k<pal->depth_count-1&&!(relief>=pal->depth_limits[k]))k++;ground=G_DEPTH0+k;}
    g->crow[x]=(uint8_t)(overlay<<4|ground);(void)i;
  }
  sink_row(g->sink,y,g->crow);
  #undef level_of
}
static void ground_begin(Ground *g,const Cam *cam,const Plate *pal,RunSink *sink){
  memset(g,0,sizeof *g);
  g->cam=cam;g->pal=pal;g->sink=sink;
  g->s1.emit=emit1;g->s1.ctx=g;g->s2.emit=emit2;g->s2.ctx=g;g->s3.emit=emit3;g->s3.ctx=g;
  g->s1.out=g->s2.out=g->s3.out=g->row;
}
static bool ground_row_done(Ground *g);
static int ground_rows_end(Ground *g);
// Up to `budget` pixel rows of the ground: 1 while rows remain, 0 when the
// ground is done, -1 if the map fails.
static int ground_step(Ground *g,Rows *rows,int budget){
  static const double SAMPLES[4][2]={{.25,.25},{.75,.25},{.25,.75},{.75,.75}};
  const Cam *cam=g->cam;
  for(;budget>0&&g->land_rows<H;budget--){
    const int y=g->land_rows;
    // The map rows under this pixel row's samples. Space (off the world
    // band) has no land; its relief, sampled all the same, is smoothed into
    // the band's edge, and beyond the pack's rows (79N-66S) is too far from
    // it to reach it.
    const bool band=y>=cam->top&&y<=cam->bottom;const double lat=glat(cam,y+.5);
    const int a=map_row_of(band?glat(cam,y+.25):lat),b=map_row_of(band?glat(cam,y+.75):lat);
    const bool mapped=fabs(lat)<=90&&a>=rows->pack->first&&b+1<rows->pack->first+rows->pack->rows;
    if(band&&!mapped)return -1;
    if(mapped&&!need_rows(rows,a,b+1))return -1;
    float *e0=g->row;uint8_t *land=g->land[y%LAND_RING];memset(land,0,W/8+1);memset(g->space[y%LAND_RING],0,W/8+1);
    for(int x=0;x<W;x++){
      if(band){
        double c=0;for(int s=0;s<4;s++)c+=coverage(rows,glat(cam,y+SAMPLES[s][1]),glon(cam,x+SAMPLES[s][0]));
        if(c>=2)land[x>>3]|=(uint8_t)(1<<(x&7));
      }
      e0[x]=(float)(mapped?relief_at(rows,lat,glon(cam,x+.5)):0);
    }
    if(!ground_row_done(g))return -1;
  }
  return ground_rows_end(g);
}
// A pixel row sampled (its land bits and space bits in the rings, its relief
// in g->row): smoothed, and the rows now ready finalised.
static bool ground_row_done(Ground *g){
  g->land_rows++;
  smooth_push(&g->s1,g->row);
  while(g->done<H&&g->done+6<g->land_rows&&(g->done+1<g->e3_rows||g->e3_rows==H))finalise_row(g,g->done++);
  return !g->sink->failed;
}
static int ground_rows_end(Ground *g){
  if(g->land_rows<H)return 1;
  smooth_finish(&g->s1);smooth_finish(&g->s2);smooth_finish(&g->s3);
  while(g->done<H)finalise_row(g,g->done++);
  return g->sink->failed?-1:0;
}

// ---------------------------------------------------------------- drawing
// renderEnroute()'s plot and knockout, writing layers instead of colours,
// with the stage of the drawing (native-scene.js): 0 the graticule, 1 the
// network, 2 the route onward, 3 what is drawn after the body.
// The class plane in four bands of rows, each its own allocation, so that
// it can be let go of a band at a time.
#define PLANE_BANDS 4
#define BAND_ROWS (H/PLANE_BANDS)
typedef struct {uint8_t *band[PLANE_BANDS];} Plane;
#define PLANE_ROW(p,y) ((p)->band[(y)/BAND_ROWS]+((y)%BAND_ROWS)*W)
#define PLANE_AT(p,i) (PLANE_ROW(p,(i)/W)[(i)%W])
typedef struct {const Plane *c;bool early;int stage;} Canvas;
static void plot(Canvas *cv,double fx,double fy,int layer){
  const double x=js_round(fx),y=js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  const int i=(int)y*W+(int)x;
  if(layer==L_INK&&cv->early)layer=L_EARLY_INK;
  if(layer==L_GRID&&cv->stage>=1)layer=L_NET_GRID;
  if(cv->stage==3&&(layer==L_INK||layer==L_MARK||layer==L_SPACE_INK))layer=L_LATE_INK;
  PLANE_AT(cv->c,i)=(uint8_t)((PLANE_AT(cv->c,i)&15)|layer<<4);
}
static void clear(Canvas *cv,double fx,double fy){
  const double x=js_round(fx),y=js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  const int i=(int)y*W+(int)x;
  PLANE_AT(cv->c,i)=(uint8_t)((PLANE_AT(cv->c,i)&15)|(cv->early?L_EARLY_CLEARED:cv->stage==3?L_LATE_CLEARED:L_CLEARED)<<4);
}
typedef struct {int16_t x,y;} Px;
typedef struct {int x,y,w,h;} Box;
// letter(): a halo of knockout round every pixel, then the ink; over space
// the ink is the space ink.
static void letter(Canvas *cv,const Px *px,int n,int layer,int halo){
  for(int i=0;i<n;i++)for(int dy=-halo;dy<=halo;dy++)for(int dx=-halo;dx<=halo;dx++)clear(cv,px[i].x+dx,px[i].y+dy);
  for(int i=0;i<n;i++){
    const int cx=px[i].x<0?0:px[i].x>W-1?W-1:px[i].x,cy=px[i].y<0?0:px[i].y>H-1?H-1:px[i].y;
    plot(cv,px[i].x,px[i].y,(PLANE_AT(cv->c,cy*W+cx)&15)==G_SPACE?L_SPACE_INK:layer);
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
static void casing_pixel(Canvas *cv,int x,int y,void *arg){const int c=*(bool *)arg?2:1;for(int dy=-c-1;dy<=c+1;dy++)for(int dx=-c;dx<=c;dx++)clear(cv,x+dx,y+dy);}
// arg: 1 within the hour, 2 heavy, 4 steep.
static void route_pixel(Canvas *cv,int x,int y,void *arg){
  const uint8_t how=*(uint8_t *)arg;
  if(!(how&1)){if(((x+y)>>1)%2==0)plot(cv,x,y,L_ROUTE);return;}
  plot(cv,x,y,L_ROUTE);
  if(how&2)plot(cv,how&4?x+1:x,how&4?y:y-1,L_ROUTE);
}
// The figures: Jost digits, bottom-aligned on a shared baseline.
static const FigureGlyph *figure(int size,char c){for(int s=0;s<5;s++)if(FIGURE_SIZES[s]==size)return &FIGURE_GLYPHS[s*10+(c-'0')];return 0;}
static int gap_for(int size){return (int)js_round(size/16.0);}
static int run_width(const char *t,int size){int w=0,n=0;for(;*t;t++,n++)w+=figure(size,*t)->width;return w+gap_for(size)*(n-1);}
// A run of figures laid out as figurePixels() does: glyph i at (x[i], y[i]).
typedef struct {const FigureGlyph *g[3];int x[3],y[3],n,x0,y0,x1,y1;const uint8_t *bits;int base;} FigureRun;
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
    if(r->bits[g->first-r->base+gy*((g->width+7)/8)+(gx>>3)]&(128>>(gx&7)))return true;
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
    plot(cv,x,y,(PLANE_AT(cv->c,cy*W+cx)&15)==G_SPACE?L_SPACE_INK:layer);
  }
}
// The figure plotted without a knockout (the world band's tape).
static void plot_figure(Canvas *cv,const FigureRun *r,int ring,int layer){
  for(int y=r->y0;y<r->y1;y++)for(int x=r->x0;x<r->x1;x++)if(figure_pixel(r,x,y,ring))plot(cv,x,y,layer);
}
static Box bounds_of(const Px *p,int n){
  if(!n)return (Box){0,0,0,0};
  int x0=p[0].x,y0=p[0].y,x1=x0,y1=y0;
  for(int i=1;i<n;i++){if(p[i].x<x0)x0=p[i].x;if(p[i].x>x1)x1=p[i].x;if(p[i].y<y0)y0=p[i].y;if(p[i].y>y1)y1=p[i].y;}
  return (Box){x0,y0,x1-x0+1,y1-y0+1};
}
// The bounds of a run of figures' pixels (solid).
static Box figure_bounds(const FigureRun *r){
  int x0=W*4,y0=H*4,x1=-W*4,y1=-H*4;
  for(int y=r->y0;y<r->y1;y++)for(int x=r->x0;x<r->x1;x++)if(figure_solid(r,x,y)){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  return x1<x0?(Box){0,0,0,0}:(Box){x0,y0,x1-x0+1,y1-y0+1};
}
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
// The drawing's pixel lists and placements.
// Groundtrack Fuller's is smaller: fewer placements, and its stations'
// bearings worked out as they are drawn.
#define TAKEN (FACE_CHART?64:32)
#define BEARINGS (FACE_CHART?72:1)
typedef struct {Px scratch[SCRATCH];Box taken[TAKEN];Px home_code[64];double sb[BEARINGS],cb[BEARINGS];} Draw;
// A Fuller build's arena: its runs are few, and its drawing holds the track,
// its lists and the hour's figures (80 px: 3003 bytes of bitmaps).
#define FULLER_ARENA ((unsigned)((sizeof(double)*2*FULLER_TRACK_MAX+sizeof(Draw)+3003+16+7)&~(size_t)7))
// The track: latitude and unwrapped longitude, then its screen position.
// Point i is at t0 + i*step seconds from the hour (see make_track).
typedef struct {double a,b;} TrackPoint;
// The figures of one size, loaded while they are drawn.
// A plate from tables.bin (see tools/generate-native-data.mjs).
static bool read_plate(const ChartSources *src,int k,Plate *p){
  uint8_t t[100];if(src->tables(src->table_source,TABLE_PLATE_AT(k),t,100)!=100)return false;
  memset(p,0,sizeof *p);
  p->flags=(uint16_t)(t[0]|t[1]<<8);memcpy(p->zoned,t+2,27);
  p->space=t[29];p->space_ink=t[30];p->screen=t[31];p->waterline=t[32];p->terminator=t[33];p->night_dots=t[34];
  p->tint_count=t[35];memcpy(p->tints,t+36,5);memcpy(p->tint_limits,t+41,40);
  p->depth_count=t[81];memcpy(p->depths,t+82,2);memcpy(p->depth_limits,t+84,16);
  return true;
}
// Into `room` (the build's arena, past what it holds), of `space` bytes.
static uint8_t *load_figures(const ChartSources *src,int size,int *base,uint8_t *room,size_t space){
  int s=0;while(s<5&&FIGURE_SIZES[s]!=size)s++;
  if(s==5)return NULL;
  const int from=FIGURE_GLYPHS[s*10].first,to=s<4?FIGURE_GLYPHS[(s+1)*10].first:FIGURE_BYTES;
  if((size_t)(to-from)>space||src->figures(src->figure_source,from,room,to-from)!=(size_t)(to-from))return NULL;
  *base=from;return room;
}

// ---------------------------------------------------------------- Fuller ground
// fuller-ground.js on the watch: a rolling Fuller sheet's pixels read from
// its faces' grids (fuller.bin), through a small cache of the grid's rows.
#define GRID_N ENR_FULLER_N
#define GRID_POINTS ENR_GRID_POINTS
#define GRID_INDEX(a,b) ((a)*(GRID_N+1)-(a)*((a)-1)/2+(b))
#define GRID_SLOTS 64
#define LAND_SLOTS 16
#define TILE_RUNS 6144
typedef struct {int16_t face,a;uint32_t used;uint8_t cover[GRID_N+1],code[GRID_N+1];} GridRow;
typedef struct {
  MapReadFn read;void *source;uint32_t tick;
  GridRow rows[GRID_SLOTS];
  // Zoomed in: land.bin's rows, and the grid's directions (i16 x 3 each).
  MapReadFn land;void *land_source;int16_t land_row[LAND_SLOTS];uint32_t land_used[LAND_SLOTS];uint8_t land_bits[LAND_SLOTS][180];
} GridCache;
static const GridRow *grid_row(GridCache *c,int face,int a){
  c->tick++;int slot=0;
  for(int i=0;i<GRID_SLOTS;i++){if(c->rows[i].face==face&&c->rows[i].a==a){c->rows[i].used=c->tick;return &c->rows[i];}if(c->rows[i].used<c->rows[slot].used)slot=i;}
  GridRow *r=&c->rows[slot];const uint32_t n=(uint32_t)(GRID_N+1-a),at=(uint32_t)(FULLER_HEADER+GRID_POINTS*6+face*GRID_POINTS+GRID_INDEX(a,0));
  if(c->read(c->source,at,r->cover,n)!=n||c->read(c->source,at+20*GRID_POINTS,r->code,n)!=n)return NULL;
  r->face=(int16_t)face;r->a=(int16_t)a;r->used=c->tick;return r;
}
static int land_bit(GridCache *c,int x,int y){
  x=((x%1440)+1440)%1440;y=y<0?0:y>719?719:y;
  c->tick++;int slot=0;
  for(int i=0;i<LAND_SLOTS;i++){if(c->land_row[i]==y){c->land_used[i]=c->tick;return (c->land_bits[i][x>>3]>>(x&7))&1;}if(c->land_used[i]<c->land_used[slot])slot=i;}
  if(c->land(c->land_source,(uint32_t)y*180,c->land_bits[slot],180)!=180)return -1;
  c->land_row[slot]=(int16_t)y;c->land_used[slot]=c->tick;return (c->land_bits[slot][x>>3]>>(x&7))&1;
}
// gridCell(): the three grid points round a fixed-point place, as (a, b)
// and weights out of 256.
typedef struct {int a[3],b[3],w[3];} GridCell;
static int64_t floor_div256(int64_t v){return v>=0?v/256:-((-v+255)/256);}
static void grid_cell(const int32_t *q,int64_t qx,int64_t qy,GridCell *c){
  int64_t a=floor_div256(q[0]+q[1]*qx+q[2]*qy),b=floor_div256(q[3]+q[4]*qx+q[5]*qy);
  a=a<0?0:a>GRID_N*256?GRID_N*256:a;b=b<0?0:b>GRID_N*256-a?GRID_N*256-a:b;
  const int ia=(int)(a/256),ib=(int)(b/256),fa=(int)(a-ia*256),fb=(int)(b-ib*256);
  if(ia+ib>=GRID_N){*c=(GridCell){{ia,0,0},{ib,0,0},{256,0,0}};return;}
  if(fa+fb<=256){*c=(GridCell){{ia,ia+1,ia},{ib,ib,ib+1},{256-fa-fb,fa,fb}};return;}
  *c=(GridCell){{ia+1,ia,ia+1},{ib+1,ib+1,ib},{fa+fb-256,256-fa,256-fb}};
}

// ---------------------------------------------------------------- the hour
// A build in progress: the track and camera, then the ground a slice of
// rows at a time, then the drawing and the scene.
struct ChartBuild {
  ChartInput in;ChartSources src;
  TrackPoint *track;int count,h0,h1,t0,step;Cam cam;Plate plate;
  Plane plane;MapPack pack;MapWork *map_work;Ground *ground;Rows *rows;RunSink sink;
  // Then the scene, its minutes made a few at a time, with home's circle's
  // bearings.
  EnrScene *out;bool forward;int minute;double *sb,*cb;
  // A rolling Fuller sheet: the pack's constants, the camera, the track on
  // the screen (kept from the camera to the drawing), each tile's grid
  // place, the grids' cache, the tiles' row runs as the ground finds them,
  // and (zoomed in, or for the scene) the grid's directions.
  FullerConst *fg;FullerCam *fc;int32_t (*tgrid)[6];bool fine;
  GridCache *gc;int16_t *dirs;
  // The network stations that hear the satellite this hour (bit per
  // station), and the tiles' row runs, found a slice of rows at a time.
  uint32_t heard;int tile_row;unsigned tile_cap,tile_n;
};
static void sink_free(ChartBuild *b){
  for(RunChunk *c=b->sink.head;c;){RunChunk *next=c->next;b->src.release(c);c=next;}
  b->sink.head=b->sink.tail=NULL;b->src.release(b->sink.arena);b->sink.arena=NULL;
}
// chartCamera()'s track: the hour and forty minutes either side a minute
// apart, or for the world band twenty minutes either side every fifteen
// seconds; latitude and unwrapped longitude. Returns the count, or -1.
#define T_OF(b,i) ((b)->t0+(i)*(b)->step)
#define HOUR_OF(b,i) ((b)->in.view==2||(T_OF(b,i)>=0&&T_OF(b,i)<=3600))
// The track's first time (seconds from the hour) and its step: on the
// whole-day chart the local day, five minutes apart.
static int track_step(const ChartInput *in){return in->view==2?300:in->view?15:60;}
static int64_t track_from(const ChartInput *in){return in->view==2?in->day_start:in->start-(in->view?1200:2400);}
static int64_t track_to(const ChartInput *in){return in->view==2?in->day_end:in->start+3600+(in->view?1200:2400);}
static int make_track(const ChartInput *in,const ChartSources *src,TrackPoint *track){
  const int step=track_step(in);
  int count=0;double turn=0,prev=0;
  for(int64_t t=track_from(in);t<=track_to(in);t+=step){
    double lat,lon;if(!body_position(src,in->body,t,&lat,&lon))return -1;
    if(count){const double d=lon-prev;if(d>180)turn-=360;else if(d<-180)turn+=360;}
    prev=lon;
    track[count].a=lat;track[count].b=lon+turn;count++;
  }
  return count;
}
static void ground_free(ChartBuild *b){
  const ChartSources *src=&b->src;
  if(b->rows)src->release(b->rows->relief);
  src->release(b->rows);b->rows=NULL;src->release(b->ground);b->ground=NULL;src->release(b->map_work);b->map_work=NULL;
  if(b->pack.cum)map_pack_close(&b->pack,src->release);
}
static void plane_free(ChartBuild *b){for(int k=0;k<PLANE_BANDS;k++){b->src.release(b->plane.band[k]);b->plane.band[k]=NULL;}}
static void fuller_free(ChartBuild *b){
  const ChartSources *src=&b->src;
  src->release(b->fg);b->fg=NULL;src->release(b->fc);b->fc=NULL;src->release(b->tgrid);b->tgrid=NULL;
  src->release(b->gc);b->gc=NULL;src->release(b->dirs);b->dirs=NULL;
  s_roll=NULL;
}
void chart_abort(ChartBuild *b){
  if(!b)return;
  fuller_free(b);
  if(b->out){enr_free(b->out,b->src.release);b->src.release(b->out);b->out=NULL;}
  b->src.release(b->sb);b->sb=NULL;
  ground_free(b);sink_free(b);plane_free(b);b->src.release(b->track);b->src.release(b);
}
// rollCamera() and the Fuller ground's setup. A satellite's hour sheet
// samples its track every 15 seconds from ten minutes before the hour to ten
// after; a day sheet, the local day every five minutes.
static bool fuller_begin(ChartBuild *b){
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;
  void *(*const alloc)(size_t)=src->alloc;void (*const release)(void *)=src->release;
  const bool day=in->view==2,sat=in->body>=2;
  const int step=day?300:sat?15:60,lead=(sat?10:40)*60;
  const int64_t from=day?in->day_start:in->start-lead,to=day?in->day_end:in->start+3600+lead;
  const int count=(int)((to-from)/step)+1;
  if(count<2||count>FULLER_TRACK_MAX||(in->start-from)%step||(in->start+3600-from)%step)return false;
  const int i0=(int)((in->start-from)/step),i1=(int)((in->start+3600-from)/step);if(i1>=count)return false;
  // The track on the screen waits at the end of the runs' arena, where the
  // drawing finds it.
  b->fg=alloc(sizeof(FullerConst));b->fc=alloc(sizeof(FullerCam));
  double (*dirs)[3]=alloc(sizeof(double)*3*count);FullerCell *cells=alloc(FULLER_SCRATCH);double *xs=alloc(sizeof(double)*2*count),*ys=xs?xs+count:NULL;
  bool rolled=b->fg&&b->fc&&dirs&&cells&&xs&&src->grids&&fuller_const_read(src->grids,src->grid_source,b->fg);
  for(int i=0;rolled&&i<count;i++){double lat,lon;if(!body_position(src,in->body,from+(int64_t)i*step,&lat,&lon))rolled=false;else fuller_direction(lat,lon,dirs[i]);}
  rolled=rolled&&fuller_roll(b->fc,cells,b->fg,(const double (*)[3])dirs,count,i0,i1,day,day?192:180,xs,ys);
  // Which network stations hear the satellite this hour: some point of the
  // hour within their acquisition circle.
  if(rolled&&sat&&!day){
    const double at=f_cos(reach(410,5)*RAD);
    for(unsigned k=0;k<TABLE_STATIONS&&rolled;k++){
      uint8_t t[20];if(src->tables(src->table_source,TABLE_STATION_AT(k),t,20)!=20){rolled=false;break;}
      double lat,lon,sd[3];memcpy(&lat,t+4,8);memcpy(&lon,t+12,8);fuller_direction(lat,lon,sd);
      for(int i=i0;i<=i1;i++)if(dirs[i][0]*sd[0]+dirs[i][1]*sd[1]+dirs[i][2]*sd[2]>=at){b->heard|=1u<<k;break;}
    }
  }
  release(xs);release(cells);release(dirs);if(!rolled)return false;
  s_roll=b->fc;
  b->count=count;b->h0=i0;b->h1=i1;b->step=step;b->t0=(int)(from-in->start);
  Cam cam;memset(&cam,0,sizeof cam);cam.top=0;cam.bottom=H;cam.day=day;cam.wide=sat||day;b->cam=cam;
  b->tgrid=alloc(sizeof(int32_t)*6*FULLER_TILES);if(!b->tgrid)return false;
  for(int t=0;t<b->fc->tile_count;t++)fuller_tile_grid(b->fc,t,GRID_N,b->tgrid[t]);
  // The ground: its caches and rings.
  b->fine=b->fc->scale>150;
  b->gc=alloc(sizeof(GridCache));b->ground=alloc(sizeof(Ground));b->sink.alloc=alloc;
  if(!b->gc||!b->ground)return false;
  memset(b->gc,0,sizeof *b->gc);b->gc->read=src->grids;b->gc->source=src->grid_source;
  for(int i=0;i<GRID_SLOTS;i++){b->gc->rows[i].face=-1;b->gc->rows[i].a=-1;}
  if(b->fine){
    if(!src->land)return false;
    b->gc->land=src->land;b->gc->land_source=src->land_source;for(int i=0;i<LAND_SLOTS;i++)b->gc->land_row[i]=-1;
    b->dirs=alloc(sizeof(int16_t)*3*GRID_POINTS);if(!b->dirs)return false;
    uint8_t *d=(uint8_t *)b->dirs;if(src->grids(src->grid_source,FULLER_HEADER,d,6*GRID_POINTS)!=6*GRID_POINTS)return false;
    for(int k=0;k<3*GRID_POINTS;k++)b->dirs[k]=(int16_t)(d[2*k]|d[2*k+1]<<8);
  }
  b->rows=alloc(sizeof(Rows));if(!b->rows)return false;memset(b->rows,0,sizeof *b->rows);
  if(src->tables(src->table_source,TABLE_METERS_AT,(uint8_t *)b->rows->meters,1024)!=1024)return false;
  ground_begin(b->ground,&b->cam,&b->plate,&b->sink);

  return true;
}
// A grid direction at a quarter-pixel place on a tile, in the face's frame.
static void grid_direction(const ChartBuild *b,int t,int64_t qx,int64_t qy,int32_t out[3]){
  GridCell c;grid_cell(b->tgrid[t],qx,qy,&c);
  for(int k=0;k<3;k++){
    int32_t s=0;for(int j=0;j<3;j++)s+=b->dirs[GRID_INDEX(c.a[j],c.b[j])*3+k]*c.w[j];
    out[k]=s>>8;
  }
}
// fuller-ground.js coverage().
static double land_coverage(GridCache *gc,double lat,double lon,bool *ok){
  const double u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=floor(u),j=floor(v),fu=u-i,fv=v-j;
  const int b00=land_bit(gc,(int)i,(int)j),b10=land_bit(gc,(int)i+1,(int)j),b01=land_bit(gc,(int)i,(int)j+1),b11=land_bit(gc,(int)i+1,(int)j+1);
  if(b00<0||b10<0||b01<0||b11<0)*ok=false;
  return ((double)b00*(1-fu)+(double)b10*fu)*(1-fv)+((double)b01*(1-fu)+(double)b11*fu)*fv;
}
// Up to `budget` rows of a Fuller sheet's ground (as ground_step).
static int fuller_ground_step(ChartBuild *b,int budget){
  Ground *g=b->ground;GridCache *gc=b->gc;const FullerCam *fc=b->fc;const float *meters=b->rows->meters;
  static const int SUB[4][2]={{1,1},{3,1},{1,3},{3,3}};
  for(;budget>0&&g->land_rows<H;budget--){
    const int y=g->land_rows;
    float *e0=g->row;uint8_t *land=g->land[y%LAND_RING],*space=g->space[y%LAND_RING];memset(land,0,W/8+1);memset(space,0,W/8+1);
    for(int x=0;x<W;x++){
      const int t=fuller_locate(fc,x+.5,y+.5,NULL);
      if(t<0){space[x>>3]|=(uint8_t)(1<<(x&7));e0[x]=0;continue;}
      const int face=fc->tiles[t].face;
      GridCell c;grid_cell(b->tgrid[t],4*x+2,4*y+2,&c);
      int cover=0;double relief=0;
      for(int j=0;j<3;j++){
        const GridRow *r=grid_row(gc,face,c.a[j]);if(!r)return -1;
        cover+=r->cover[c.b[j]]*c.w[j];relief+=(double)meters[r->code[c.b[j]]]*c.w[j];
      }
      e0[x]=(float)(relief/256);
      bool is_land;
      if(b->fine){
        // land.bin at four points in the pixel.
        double sum=0;bool ok=true;
        for(int k=0;k<4;k++){
          const int u=fuller_locate(fc,x+SUB[k][0]/4.0,y+SUB[k][1]/4.0,NULL);if(u<0)continue;
          int32_t d[3];grid_direction(b,u,4*x+SUB[k][0],4*y+SUB[k][1],d);
          const double *bs=b->fg->bases[fc->tiles[u].face];
          const double g0=d[0]*bs[0]+d[1]*bs[3]+d[2]*bs[6],g1=d[0]*bs[1]+d[1]*bs[4]+d[2]*bs[7],g2=d[0]*bs[2]+d[1]*bs[5]+d[2]*bs[8],len=f_sqrt(g0*g0+g1*g1+g2*g2);
          sum+=land_coverage(gc,f_asin(g2/len)/RAD,f_atan2(g1,g0)/RAD,&ok);
        }
        if(!ok)return -1;
        is_land=sum>=2;
      }else is_land=cover>=32640;
      if(is_land)land[x>>3]|=(uint8_t)(1<<(x&7));
    }
    if(!ground_row_done(g))return -1;
  }
  return ground_rows_end(g);
}
ChartBuild *chart_begin(const ChartInput *in_,const ChartSources *src_){
  ChartBuild *b=src_->alloc(sizeof(ChartBuild));if(!b)return NULL;
  memset(b,0,sizeof *b);b->in=*in_;b->src=*src_;
  const unsigned arena=FACE_ROLL&&(!FACE_CHART||in_->fuller)?FULLER_ARENA:RUN_ARENA;
  b->sink.arena=src_->alloc(arena);if(!b->sink.arena){src_->release(b);return NULL;}
  b->sink.cap=arena;
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;
  void *(*const alloc)(size_t)=src->alloc;void (*const release)(void *)=src->release;
  if(in->plate<0||in->plate>=TABLE_PLATES||!read_plate(src,in->plate,&b->plate))FAIL;
  const Plate *pal=&b->plate;
  if(FACE_ROLL&&(!FACE_CHART||in->fuller)){if(!fuller_begin(b))FAIL;return b;}
  // chartCamera(). The track is kept only while the camera is set, and made
  // again for the drawing: the ground needs the memory.
  TrackPoint *const track=b->track=alloc(sizeof(TrackPoint)*((track_to(in)-track_from(in))/track_step(in)+1));if(!track)FAIL;
  const int count=make_track(in,src,track);if(count<0||count>401)FAIL;
  b->step=track_step(in);b->t0=(int)(track_from(in)-in->start);
  double maxlat=-INFINITY,minlat=INFINITY,maxlon=-INFINITY,minlon=INFINITY;int h0=-1,h1=-1;
  for(int i=0;i<count;i++)if(HOUR_OF(b,i)){
    if(h0<0)h0=i;
    h1=i;
    if(track[i].a>maxlat)maxlat=track[i].a;
    if(track[i].a<minlat)minlat=track[i].a;
    if(track[i].b>maxlon)maxlon=track[i].b;
    if(track[i].b<minlon)minlon=track[i].b;
  }
  Cam cam;memset(&cam,0,sizeof cam);cam.top=0;cam.bottom=H;
  if(VIEW_IS_DAY(in->view)){
    // The whole local day, north up, its shape fitted and set to the right.
    double alo=INFINITY,ahi=-INFINITY,blo=INFINITY,bhi=-INFINITY;
    for(int i=0;i<count;i++){if(track[i].a<alo)alo=track[i].a;if(track[i].a>ahi)ahi=track[i].a;if(track[i].b<blo)blo=track[i].b;if(track[i].b>bhi)bhi=track[i].b;}
    cam.day=cam.wide=true;cam.lat0=(ahi+alo)/2;cam.k=f_cos(cam.lat0*RAD);cam.lonMid=(bhi+blo)/2;
    {const double w=(bhi-blo)*cam.k,sa=(W*.5)/(w>1?w:1),h=ahi-alo,sb=(H-70)/(h>1?h:1);cam.scale=sa<sb?sa:sb;}
    cam.y0=(14+H-16)/2;cam.x0=W-16-(bhi-blo)*cam.k*cam.scale/2;
    h0=0;h1=count-1;
  }
  else if(VIEW_IS_WORLD(in->view)){
    // The whole world in a band, fitted to the hour's longitudes, in true
    // proportion.
    cam.world=true;cam.scale=(W-16)/(maxlon-minlon>180?maxlon-minlon:180);cam.k=1;cam.lat0=WORLD_SOUTH;cam.y0=H-10;
    cam.lonMid=(maxlon+minlon)/2;cam.x0=W/2;
    // With the world sliding, centred on the body at the minute.
    if(in->tape==2){const int i=(in->minute*60+1200)/15;if(i<0||i>=count)FAIL;cam.lonMid=track[i].b;}
    cam.top=(int)ceil(sy(&cam,WORLD_NORTH));cam.bottom=(int)floor(sy(&cam,WORLD_SOUTH));
  }
  else if(!VIEW_IS_HOUR(in->view))FAIL;
  else if(in->body<2){
    cam.lat0=(maxlat+minlat)/2;cam.k=f_cos(cam.lat0*RAD);
    {const double spread=(maxlon-minlon)*cam.k;cam.scale=CHART_SPAN/(spread>1?spread:1);}
    cam.y0=CHART_TRACK_Y;cam.lonMid=(maxlon+minlon)/2;cam.x0=W/2;
  }else{
    // A slow orbit's hour runs any way: its two stations SPAN pixels apart
    // along the route, north up, the route set off-centre away from the
    // side its figures take (above, or beside a route that runs north-south).
    const TrackPoint *a=&track[h0],*b=&track[h1];
    cam.lat0=(a->a+b->a)/2;cam.k=f_cos(cam.lat0*RAD);cam.lonMid=(a->b+b->b)/2;
    const double sx_=(b->b-a->b)*cam.k,sy_=-(b->a-a->a),l0=f_sqrt(sx_*sx_+sy_*sy_),len=l0?l0:1;cam.scale=CHART_SPAN/len;
    double nx=sy_/len,ny=-sx_/len;
    if(ny>0){nx=-nx;ny=-ny;}
    if(fabs(ny)<.3&&nx>0){nx=-nx;ny=-ny;}
    cam.slow=true;cam.nx=nx;cam.ny=ny;
    cam.x0=W/2-nx*30;cam.y0=(14+H-16)/2+8-ny*30;
  }
  b->count=count;b->h0=h0;b->h1=h1;b->cam=cam;
  release(b->track);b->track=NULL;

  // The ground, with the map's decoder and the relief's rings, freed after.
  b->map_work=alloc(sizeof(MapWork));b->ground=alloc(sizeof(Ground));b->rows=alloc(sizeof(Rows));b->sink.alloc=alloc;
  if(!b->map_work||!b->ground||!b->rows||!map_pack_open(&b->pack,src->map,src->map_source,alloc))FAIL;
  {Rows *const rows=b->rows;memset(rows,0,sizeof *rows);rows->pack=&b->pack;rows->work=b->map_work;for(int i=0;i<ROW_SLOTS;i++)rows->row[i]=-1;
  {uint8_t m[1024];if(src->tables(src->table_source,TABLE_METERS_AT,m,1024)!=1024)FAIL;memcpy(rows->meters,m,1024);}
  // Only the map's columns under the chart are kept.
  const double lonL=glon(&b->cam,0),lonR=glon(&b->cam,W),span=(lonR-lonL)*4+4;
  if(span>=MAP_WIDTH){rows->c0=0;rows->n=MAP_WIDTH;}
  else{rows->c0=((int)floor((wrap(lonL)+180)*4-.5)-1+2*MAP_WIDTH)%MAP_WIDTH;rows->n=(int)ceil(span)+2;}
  rows->relief=alloc(ROW_SLOTS*rows->n);if(!rows->relief)FAIL;}
  ground_begin(b->ground,&b->cam,pal,&b->sink);
  return b;
fail:
  chart_abort(b);
  return NULL;
}
static bool finish_draw(ChartBuild *b);
static bool finish_minutes(ChartBuild *b,int m0,int m1);
// Which tile each pixel of rows up to `to` lies on, found again (the ground
// had no room to keep it), as the scene's row runs. False without memory.
static bool fuller_tile_rows(ChartBuild *b,int to){
  EnrFuller *f=b->out->fuller;const FullerCam *fc=b->fc;
  for(;b->tile_row<to&&b->tile_row<H;b->tile_row++){
    const int y=b->tile_row;int run=-2;uint8_t *r=f->tile_runs;
    for(int x=0;x<W;x++){
      const int t=fuller_locate(fc,x+.5,y+.5,NULL);
      if(t!=run||r[b->tile_n-2]==255){
        if(b->tile_n+2>b->tile_cap){uint8_t *more=b->src.resize?b->src.resize(r,b->tile_cap*2):NULL;if(!more)return false;r=f->tile_runs=more;b->tile_cap*=2;}
        r[b->tile_n]=0;r[b->tile_n+1]=(uint8_t)(t+1);b->tile_n+=2;run=t;
      }
      r[b->tile_n-2]++;
    }
    f->tile_offset[y+1]=(uint16_t)b->tile_n;
  }
  if(b->tile_row==H&&b->src.resize){uint8_t *fit=b->src.resize(f->tile_runs,b->tile_n?b->tile_n:1);if(fit)f->tile_runs=fit;}
  return true;
}
// A Fuller sheet's rows cost more than the map's.
#define FULLER_STEP_ROWS 3
#define TILE_STEP_ROWS 12
// The ground a slice of rows at a time, then the drawing, then the minutes
// a few at a time.
#define CHART_STEP_MINUTES 6
int chart_step(ChartBuild *b){
  if(b->ground){
    const int r=FACE_ROLL&&(!FACE_CHART||b->fc)?fuller_ground_step(b,b->fine?1:FULLER_STEP_ROWS):ground_step(b->ground,b->rows,CHART_STEP_ROWS);
    if(r<=0){
      ground_free(b);
      if(b->gc){
        // The grid's directions are read again for the scene.
        b->src.release(b->gc);b->gc=NULL;b->src.release(b->dirs);b->dirs=NULL;b->src.release(b->tgrid);b->tgrid=NULL;
      }
    }
    return r<0?-1:1;
  }
  if(!b->out)return finish_draw(b)?1:-1;
  if(FACE_ROLL&&b->out->fuller&&b->tile_row<H)return fuller_tile_rows(b,b->tile_row+TILE_STEP_ROWS)?1:-1;
  if(b->minute<60){
    const int to=b->minute+CHART_STEP_MINUTES<60?b->minute+CHART_STEP_MINUTES:60;
    if(!finish_minutes(b,b->minute,to))return -1;
    b->minute=to;
  }
  return b->minute<60?1:0;
}
// civil date of a day count (days since 1970-01-01), after Howard Hinnant.
static void civil_from_days(int32_t z,int *y,int *m,int *d){
  z+=719468;const int32_t era=(z>=0?z:z-146096)/146097;const unsigned doe=(unsigned)(z-era*146097);
  const unsigned yoe=(doe-doe/1460+doe/36524-doe/146096)/365,doy=doe-(365*yoe+yoe/4-yoe/100),mp=(5*doy+2)/153;
  *d=(int)(doy-(153*mp+2)/5+1);*m=(int)(mp<10?mp+3:mp-9);*y=(int)yoe+era*400+(*m<=2);
}
// The world band's instrument tape (SCALE in enroute-render.js).
#define TAPE_X0 10
#define TAPE_X1 190
#define TAPE_BASELINE 46
#define TAPE_PANEL 67

// The drawing and the scene, but for its minutes. False on failure (the
// build then aborted by the caller).
static bool finish_draw(ChartBuild *b){
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;
  const Plate *pal=&b->plate;
  void *(*const alloc)(size_t)=src->alloc;void (*const release)(void *)=src->release;
  const int count=b->count,h0=b->h0,h1=b->h1;const Cam cam=b->cam;const bool world=FACE_WORLD&&(!FACE_HOUR||cam.world);
  const int top=cam.top,bottom=cam.bottom;
  Draw *draw=NULL;Px *scratch=NULL;EnrScene *out=NULL;EnrPoint *points=NULL;int16_t zulu_x=0,zulu_baseline=0;
  int16_t tape_lo=0,tape_hi=0;
  // The class plane, from the ground's runs, each chunk freed once read.
  for(int k=0;k<PLANE_BANDS;k++)if(!(b->plane.band[k]=alloc(W*BAND_ROWS)))FAIL;
  const Plane *const classes=&b->plane;
  {int x=0,y=0;const unsigned cap=b->sink.cap,inside=b->sink.n<cap?b->sink.n:cap;
  for(unsigned k=0;k+1<inside;k+=2){memset(PLANE_ROW(classes,y)+x,b->sink.arena[k+1],b->sink.arena[k]);x+=b->sink.arena[k];if(x>=W){x=0;y++;}}
  // The arena, read, holds the track and the drawing's lists next.
  for(RunChunk *c=b->sink.head;c;){
    for(int k=0;k+1<c->used;k+=2){memset(PLANE_ROW(classes,y)+x,c->data[k+1],c->data[k]);x+=c->data[k];if(x>=W){x=0;y++;}}
    RunChunk *next=c->next;release(c);c=next;b->sink.head=c;
  }
  b->sink.tail=NULL;
  if(y!=H)FAIL;}
  // The track again, on the screen.
  _Static_assert(sizeof(TrackPoint)*401+sizeof(Draw)+8<=RUN_ARENA,"the arena holds the track and the drawing");
  const size_t ARENA=b->sink.cap;
  _Static_assert(sizeof(TrackPoint)*401+sizeof(EnrPoint)*401+8<=RUN_ARENA,"the arena holds the track and the points");
  TrackPoint *const track=(TrackPoint *)b->sink.arena;
  const bool rolled=FACE_ROLL&&(!FACE_CHART||b->fc);
  if(rolled){
    // The route rolled again, as the camera rolled it.
    FullerCell tile;
    for(int i=0;i<count;i++){
      double lat,lon,d[3];if(!body_position(src,in->body,in->start+T_OF(b,i),&lat,&lon))FAIL;fuller_direction(lat,lon,d);
      if(!i)fuller_track_start(b->fg,d,&tile);
      fuller_track_next(b->fc,&tile,d,&track[i].a,&track[i].b);
    }
  }
  else{
  if(make_track(in,src,track)!=count)FAIL;
  for(int i=0;i<count;i++){const double lat=track[i].a,lon=track[i].b;track[i].a=sx(&cam,lon);track[i].b=sy(&cam,lat);}
  }
  draw=(Draw *)(b->sink.arena+((sizeof(TrackPoint)*count+7)&~7u));
  // Past the drawing's lists, room for the figures' bitmaps.
  uint8_t *const room=(uint8_t *)(draw+1);const size_t room_size=ARENA-(size_t)(room-b->sink.arena);
  scratch=draw->scratch;
  Canvas cv={classes,true,0};
  uint8_t ring[2*120];

  // Graticule: crosses every 5 degrees (30 on the world band), ticks every
  // degree (10) along the edges of the map.
  const bool day=FACE_HOUR&&cam.day;
  const int step=world?30:day?10:5,minor=world?10:day?5:1;
  if(rolled){
    // Rolling Fuller: the net's outline in ink, folds inside it dotted.
    const FullerCam *fc=b->fc;
    for(int t=0;t<fc->tile_count;t++)for(int e=0;e<3;e++){
      static const int E[3][2]={{0,1},{1,2},{2,0}};
      double ax,ay,bx,by;fuller_to_screen(fc,fc->tiles[t].tri[E[e][0]],&ax,&ay);fuller_to_screen(fc,fc->tiles[t].tri[E[e][1]],&bx,&by);
      int x=(int)js_round(ax),y=(int)js_round(ay);const int xx=(int)js_round(bx),yy=(int)js_round(by);
      const int dx=abs(xx-x),sx_=x<xx?1:-1,dy=-abs(yy-y),sy_=y<yy?1:-1;int err=dx+dy,n=0;
      for(int k=0;k<4000;k++){
        if(fc->tiles[t].edge[e]==2)plot(&cv,x,y,L_SPACE_INK);
        else if(fc->tiles[t].edge[e]==1||(n++%4==0))plot(&cv,x,y,L_GRID);
        if(x==xx&&y==yy)break;
        const int e2=2*err;
        if(e2>=dy){err+=dy;x+=sx_;}
        if(e2<=dx){err+=dx;y+=sy_;}
      }
    }
  }else
  {const double g0lat=glat(&cam,bottom),g0lon=glon(&cam,0),g1lat=glat(&cam,top),g1lon=glon(&cam,W);
  for(double lat=ceil(g0lat/step)*step;lat<=g1lat;lat+=step)for(double lon=ceil(g0lon/step)*step;lon<=g1lon;lon+=step){
    const double x=js_round(sx(&cam,lon)),y=js_round(sy(&cam,lat));if(!(y>=top&&y<=bottom))continue;
    for(int d=-2;d<=2;d++){plot(&cv,x+d,y,L_GRID);plot(&cv,x,y+d,L_GRID);}
  }
  for(double lon=ceil(g0lon/minor)*minor;lon<=g1lon;lon+=minor){
    const double x=js_round(sx(&cam,lon));const int len=f_fmod(lon,step)==0?4:2;
    for(int d=0;d<len;d++){plot(&cv,x,top+d,L_GRID);plot(&cv,x,bottom-d,L_GRID);}
  }
  for(double lat=ceil(g0lat/minor)*minor;lat<=g1lat;lat+=minor){
    const double y=js_round(sy(&cam,lat));const int len=f_fmod(lat,step)==0?4:2;if(!(y>=top&&y<=bottom))continue;
    for(int d=0;d<len;d++){plot(&cv,d,y,L_GRID);plot(&cv,W-1-d,y,L_GRID);}
  }}

  // Home, placed first so the network gives way; drawn last. (Its
  // acquisition circle on the world band is the minute's.)
  Box *const taken=draw->taken;int taken_n=0;
  // The lettering the day's callout breaks its leader for.
  Box avoid[24];int avoid_n=0;
  #define AVOID(b) do{if(avoid_n<24)avoid[avoid_n++]=(b);}while(0)
  if(!world){taken[taken_n++]=(Box){0,H-16,W,16};if(in->home)taken[taken_n++]=(Box){0,0,W,14};}
  bool home_mark=false;int hx=0,hy=0;Box home_box={0,0,0,0};uint16_t marks[128];int mark_n=0;Px *const home_code=draw->home_code;int home_code_n=0;
  if(in->home){
    double qx,qy;project(&cam,in->home_lat,in->home_lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
    const int w=text_width("HOM");const bool right=x+7+w<W-3;const Box box={right?x-5:x-8-w,y-6,w+13,13};
    if(x>=4&&x<=W-5&&y>=top+6&&y<=bottom-6&&!(rolled&&fuller_locate(b->fc,x,y,NULL)<0)&&!overlaps(taken,taken_n,box)){
      home_code_n=text_pixels("HOM",right?x+7:x-7-w,y+4,home_code);taken[taken_n++]=box;home_mark=true;hx=x;hy=y;home_box=box;
      AVOID(bounds_of(home_code,home_code_n));
    }
  }
  cv.stage=1;
  // The tracking stations, circled, with their codes; on the world band
  // each with its acquisition circle.
  const double acquisition=reach(410,5);
  int16_t shown[32][2];uint8_t shown_table[32];int nshown=0;
  const bool ringed=world||(rolled&&cam.wide);
  if(ringed&&FACE_CHART)bearings(5,draw->sb,draw->cb);
  for(unsigned s=0;s<(day?0:TABLE_STATIONS);s++){
    // On a whole-orbit Fuller sheet, only the stations that hear the
    // satellite this hour.
    if(rolled&&cam.wide&&!(b->heard>>s&1))continue;
    Station st;{uint8_t t[20];if(src->tables(src->table_source,TABLE_STATION_AT(s),t,20)!=20)FAIL;memcpy(st.code,t,4);st.code[3]=0;memcpy(&st.lat,t+4,8);memcpy(&st.lon,t+12,8);}
    double qx,qy;project(&cam,st.lat,st.lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
    if(x<4||x>W-5||y<top+6||y>bottom-6)continue;
    const int w=text_width(st.code);const bool right=x+5+w<W-3;const Box box={right?x-3:x-6-w,y-5,w+9,11};
    if(overlaps(taken,taken_n,box))continue;
    if(taken_n<TAKEN)taken[taken_n++]=box;
    if(nshown<32){shown[nshown][0]=(int16_t)x;shown[nshown][1]=(int16_t)y;shown_table[nshown]=(uint8_t)s;nshown++;}
    if(ringed){const int n=circle_pixels(&cam,st.lat,st.lon,acquisition,5,FACE_CHART?draw->sb:NULL,FACE_CHART?draw->cb:NULL,ring);for(int i=0;i<n;i++)plot(&cv,ring[2*i],ring[2*i+1],L_GRID);}
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){const int r=dx*dx+dy*dy;if(r<=5&&r>=3)plot(&cv,x+dx,y+dy,L_INK);}
    plot(&cv,x,y,L_INK);
    const int n=text_pixels(st.code,right?x+5:x-5-w,y+4,scratch);AVOID(bounds_of(scratch,n));letter(&cv,scratch,n,L_INK,1);
  }
  // The route: cased in white on a one-ink plate; dashed outside the hour.
  // On a Fuller sheet a one-ink plate's route is heavier: two pixels ahead
  // of the body (the second the hour's), three behind.
  bool heavy=rolled&&(pal->flags&PLATE_MONO);
  #define JUMP(p,q) (fabs(track[q].a-track[p].a)>W/2)
  if(pal->flags&PLATE_MONO)for(int i=1;i<count;i++){
    if(JUMP(i-1,i)||!(HOUR_OF(b,i-1)&&HOUR_OF(b,i)))continue;
    segment(&cv,track[i-1].a,track[i-1].b,track[i].a,track[i].b,casing_pixel,&heavy);
  }
  cv.early=false;cv.stage=2;
  for(int i=1;i<count;i++){
    if(JUMP(i-1,i))continue;
    const bool hour=HOUR_OF(b,i-1)&&HOUR_OF(b,i),steep=fabs(track[i].b-track[i-1].b)>fabs(track[i].a-track[i-1].a);
    uint8_t how=(uint8_t)((hour?1:0)|(heavy?2:0)|(steep?4:0));
    segment(&cv,track[i-1].a,track[i-1].b,track[i].a,track[i].b,route_pixel,&how);
  }
  // A whole day is graduated in hours instead: a tick every hour, longer
  // and numbered every three, longest at the two midnights. Where the day's
  // track crosses itself two hours meet, and the later label gives way.
  if(day){
    Box labels[10];int nlabels=0;
    for(int i=0;i<count;i+=12){
      const TrackPoint *a=&track[i>0?i-1:0],*q=&track[i<count-1?i+1:count-1],*p=&track[i];
      const double l0=f_sqrt((q->a-a->a)*(q->a-a->a)+(q->b-a->b)*(q->b-a->b)),len=l0?l0:1;
      double nx=-(q->b-a->b)/len,ny=(q->a-a->a)/len;if(ny<0){nx=-nx;ny=-ny;}
      const int hr=i/12,size=hr%24==0?7:hr%3==0?5:3;
      for(int k=1;k<=size;k++)plot(&cv,p->a+nx*k,p->b+ny*k,L_ROUTE);
      if(hr%3==0){
        const int hh=in->day_hours[hr<27?hr:26],v=in->clock24?(hr==24?24:hh):(hh%12?hh%12:12);
        char label[4];put_int(label,v,1);const int lw=text_width(label);
        const int n=text_pixels(label,(int)js_round(p->a+nx*9-lw/2.0)+1,(int)js_round(p->b+ny*9+9),scratch);const Box bx=bounds_of(scratch,n);
        bool clear_=true;for(int k=0;k<nlabels;k++){const Box *o=&labels[k];if(!(o->x+o->w+6<=bx.x||bx.x+bx.w+6<=o->x||o->y+o->h+4<=bx.y||bx.y+bx.h+4<=o->y))clear_=false;}
        if(clear_&&nlabels<10){labels[nlabels++]=bx;AVOID(bx);letter(&cv,scratch,n,L_ROUTE,(pal->flags&PLATE_MONO)?1:0);}
      }
    }
  }
  // The route as a scale: minute graduations, the quarters numbered; on the
  // world band five-minute ties only.
  for(int i=1;i<count-1&&!day;i++){
    if(!HOUR_OF(b,i))continue;
    const int64_t since=(int64_t)T_OF(b,i)-T_OF(b,h0);const int m=(int)js_round(since/60.0);
    if(since%60||m<=0||m>=60||(world&&m%5))continue;
    const double len0=f_sqrt((track[i+1].a-track[i-1].a)*(track[i+1].a-track[i-1].a)+(track[i+1].b-track[i-1].b)*(track[i+1].b-track[i-1].b)),len=len0?len0:1;
    double nx=-(track[i+1].b-track[i-1].b)/len,ny=(track[i+1].a-track[i-1].a)/len;
    if(cam.slow?nx*cam.nx+ny*cam.ny>0:ny<0){nx=-nx;ny=-ny;}
    const int size=world?(m%15==0?4:2):m%15==0?6:m%5==0?4:2;
    for(int s=1;s<=size;s++)plot(&cv,track[i].a+nx*s,track[i].b+ny*s,L_ROUTE);
    if(!world&&m%15==0){
      char label[4];label[0]=(char)('0'+m/10);label[1]=(char)('0'+m%10);label[2]=0;
      const int lw=text_width(label);
      const int n=text_pixels(label,(int)js_round(track[i].a+nx*8-lw/2.0)+1,(int)js_round(track[i].b+ny*8+9),scratch);
      AVOID(bounds_of(scratch,n));letter(&cv,scratch,n,L_ROUTE,(pal->flags&PLATE_MONO)?1:0);
    }
  }
  // This hour's VOR rose (on the hour chart) and hexagon; the next hour's
  // reporting point.
  const int c0x=(int)js_round(track[h0].a),c0y=(int)js_round(track[h0].b),c1x=(int)js_round(track[h1].a),c1y=(int)js_round(track[h1].b);
  const bool forward=c1x>c0x;
  if(!world&&!day){const int R=16;
  // The rose turns to true north at the station: north is up on the
  // cylindrical charts, anywhere on a rolled Fuller sheet.
  double north=0;
  if(rolled){
    double lat,lon,q0x,q0y,q1x,q1y;if(!body_position(src,in->body,in->start+T_OF(b,h0),&lat,&lon))FAIL;
    project(&cam,lat,lon,&q0x,&q0y);project(&cam,lat+.5<89.9?lat+.5:89.9,lon,&q1x,&q1y);
    const double l=f_sqrt((q1x-q0x)*(q1x-q0x)+(q1y-q0y)*(q1y-q0y)),nl=l?l:1;north=f_atan2((q1x-q0x)/nl,-(q1y-q0y)/nl);
  }
  for(int a=0;a<720;a++){const double t=a*PI/360;plot(&cv,c0x+js_round(f_sin(t+north)*R),c0y-js_round(f_cos(t+north)*R),L_INK);}
  for(int a=0;a<360;a+=30){const int len=a%90==0?5:3;for(int r=R-len;r<R;r++){const double t=a*RAD;plot(&cv,c0x+js_round(f_sin(t+north)*r),c0y-js_round(f_cos(t+north)*r),L_INK);}}
  for(int k=0;k<3;k++)for(int d=-k;d<=k;d++){const int r=R+4-k;plot(&cv,c0x+js_round(f_sin(north)*r+f_cos(north)*d),c0y-js_round(f_cos(north)*r-f_sin(north)*d),L_INK);}}
  if(!day){symbol(&cv,HEXAGON,5,c0x,c0y);plot(&cv,c0x,c0y,L_INK);symbol(&cv,TRIANGLE,7,c1x,c1y-1);}
  // The body is the minute's; all after it lies over it.
  cv.stage=3;
  char hour[4],next[4];
  // The hour figures' bounds (on the hour chart and the fixed tape), which
  // events' names give way to.
  Box figs[2];int nfigs=0;
  {const int hh=in->clock24?in->local_hour:(in->local_hour%12?in->local_hour%12:12),nh=in->clock24?(in->local_hour+1)%24:((in->local_hour+1)%12?(in->local_hour+1)%12:12);
  put_int(hour,hh,1);put_int(next,nh,1);}
  #define PLACE(end,w) ({int v=(int)js_round((end)-(w)/2.0);v=v<W-4-(w)?v:W-4-(w);v>4?v:4;})
  if(world&&in->tape){
    // A sliding tape moves each minute, all of it the minute's.
    for(int i=0;i<TAPE_PANEL*W;i++)PLANE_AT(classes,i)=G_SPACE;
  }else if(world){
    // The world band's hours are set in a panel over the map, an
    // instrument tape: minute graduations, tall hour marks under the
    // figures, this hour solid and the next outlined. Its index is the
    // minute's.
    const int B=TAPE_BASELINE,P=TAPE_PANEL,X0=TAPE_X0,X1=TAPE_X1;
    for(int i=0;i<P*W;i++)PLANE_AT(classes,i)=G_SPACE;
    for(int x=0;x<W;x++)plot(&cv,x,P-1,L_SPACE_INK);
    for(int x=X0;x<=X1;x++)plot(&cv,x,B,L_SPACE_INK);
    for(int m=0;m<=60;m++){
      const double x=js_round(forward?X0+(double)(X1-X0)*m/60:X1-(double)(X1-X0)*m/60);const int len=m%60==0?12:m%15==0?6:m%5==0?4:2;
      for(int d=1;d<=len;d++)plot(&cv,x,B+d,L_SPACE_INK);
      if(m%60==0)for(int d=1;d<=6;d++)plot(&cv,x,B-d,L_SPACE_INK);
      if(m%15==0&&m%60){
        char label[4];label[0]=(char)('0'+m/10);label[1]=(char)('0'+m%10);label[2]=0;
        const int lw=text_width(label),n=text_pixels(label,(int)x-(int)floor(lw/2.0)+1,B+17,scratch);
        for(int i=0;i<n;i++)plot(&cv,scratch[i].x,scratch[i].y,L_SPACE_INK);
      }
    }
    const int size=40,hw=run_width(hour,size),nw=run_width(next,size),gx=PLACE(forward?X0:X1,hw),nx=PLACE(forward?X1:X0,nw);
    int base;uint8_t *bits=load_figures(src,size,&base,room,room_size);if(!bits)FAIL;
    FigureRun run;figure_run(hour,size,gx,4,&run);run.bits=bits;run.base=base;plot_figure(&cv,&run,0,L_SPACE_INK);figs[nfigs++]=figure_bounds(&run);
    figure_run(next,size,nx,4,&run);run.bits=bits;run.base=base;plot_figure(&cv,&run,1,L_SPACE_INK);figs[nfigs++]=figure_bounds(&run);
    tape_lo=(int16_t)((gx+hw<nx+nw?gx+hw:nx+nw)+3);tape_hi=(int16_t)((gx>nx?gx:nx)-3-text_width("00"));
    // How the tape's even minutes fall on the route, in a strip under the
    // tape (renderEnroute()'s transfer): the route's own minutes ticked, a
    // stroke from each five minutes leaning toward its place on the route,
    // or chevrons where the route squeezes (in) or stretches (out).
    if(FACE_WORLD&&in->transfer){
      #define AT(m) (forward?X0+(double)(X1-X0)*(m)/60:X1-(double)(X1-X0)*(m)/60)
      // The route's point at minute m of the hour (every minute is one of
      // its points, the step dividing a minute), and whether it is on the band.
      #define AT_ROUTE(m) (((T_OF(b,h0)+(m)*60-b->t0)%b->step==0&&(T_OF(b,h0)+(m)*60-b->t0)/b->step<count)?(T_OF(b,h0)+(m)*60-b->t0)/b->step:-1)
      #define ON(m) (AT_ROUTE(m)>=0)
      #define RX(m) (track[AT_ROUTE(m)].a)
      #define ON_BAND(m) (ON(m)&&RX(m)>=0&&RX(m)<W)
      const int t0=P+1;
      if(in->transfer==1){
        for(int m=0;m<=60;m++)if(ON_BAND(m)){const int len=m%15==0?5:m%5==0?3:1;for(int d=0;d<len;d++)plot(&cv,RX(m),t0+d,L_SPACE_INK);}
      }else if(in->transfer==2){
        for(int m=0;m<=60;m+=5)if(ON_BAND(m)){
          const double a=AT(m),v=(RX(m)-a)/6,lean=v>4?4:v<-4?-4:v;
          for(int d=0;d<6;d++)plot(&cv,a+lean*d/5,t0+d,L_SPACE_INK);
        }
      }else{
        static const int8_t IN[6][2]={{-3,0},{-2,1},{-3,2},{3,0},{2,1},{3,2}},OUT[6][2]={{-2,0},{-3,1},{-2,2},{2,0},{3,1},{2,2}};
        for(int m=5;m<=55;m+=5){
          if(!ON_BAND(m))continue;
          const double k=!ON(m-1)||!ON(m+1)?1:fabs(RX(m+1)-RX(m-1))/fabs(AT(m+1)-AT(m-1));if(k>=0.7&&k<=1.4)continue;
          const int cx=(int)js_round(AT(m));
          for(int j=0;j<6;j++){const int8_t *d=k<0.7?IN[j]:OUT[j];plot(&cv,cx+d[0],t0+1+d[1],L_SPACE_INK);}
        }
      }
      #undef ON_BAND
      #undef RX
      #undef ON
      #undef AT_ROUTE
      #undef AT
    }
  }else if(!day){
    // The hour figures: this hour solid over its rose, the next outlined.
    const int size=strlen(hour)>1||strlen(next)>1?72:80,hw=run_width(hour,size),nw=run_width(next,size),fh=figure(size,'0')->height,gy=c0y-26-fh;
    int base;uint8_t *bits=load_figures(src,size,&base,room,room_size);if(!bits)FAIL;
    int hx0=PLACE(c0x,hw),hy0=gy,nx0=PLACE(c1x,nw),ny0=gy;
    if(cam.slow){
      // Each figure stands off its station on the route's open side.
      #define STAND(cx,cy,w,ox,oy) do{const double d=26+fabs(cam.nx)*(w)/2.0+fabs(cam.ny)*fh/2.0;int vx=(int)js_round((cx)+cam.nx*d-(w)/2.0),vy=(int)js_round((cy)+cam.ny*d-fh/2.0);vx=vx<W-4-(w)?vx:W-4-(w);ox=vx>4?vx:4;vy=vy<H-18-fh?vy:H-18-fh;oy=vy>4?vy:4;}while(0)
      STAND(c0x,c0y,hw,hx0,hy0);STAND(c1x,c1y,nw,nx0,ny0);
      #undef STAND
    }
    FigureRun run;figure_run(hour,size,hx0,hy0,&run);run.bits=bits;run.base=base;letter_figure(&cv,&run,0,L_INK);figs[nfigs++]=figure_bounds(&run);
    figure_run(next,size,nx0,ny0,&run);run.bits=bits;run.base=base;letter_figure(&cv,&run,2,L_INK);figs[nfigs++]=figure_bounds(&run);

  }
  #undef PLACE
  // Events are compulsory reporting points: a filled triangle on the route
  // at the event's minute, its name over it (the minute's: see
  // enroute_core.c), clear of the lettering, the network and the figures.
  static const char *const FIX[7]={"....#....","...###...","...###...","..#####..","..#####..",".#######.","#########"};
  int nevents=0;struct {int16_t x,y,lx,box[4];uint8_t clear;char name[5];} events[16];
  for(int e=0;e<in->event_count;e++){
    const int64_t t=in->events[e].t-in->start;int i=1;
    while(i<count&&!(T_OF(b,i-1)<=t&&T_OF(b,i)>=t))i++;
    if(i>=count||JUMP(i-1,i))continue;
    const double f=(double)(t-T_OF(b,i-1))/((T_OF(b,i)-T_OF(b,i-1))?(double)(T_OF(b,i)-T_OF(b,i-1)):1);
    const int x=(int)js_round(track[i-1].a+(track[i].a-track[i-1].a)*f),y=(int)js_round(track[i-1].b+(track[i].b-track[i-1].b)*f);
    if(x<5||x>W-6||y<top+8||y>bottom-4)continue;
    for(int dy=0;dy<7;dy++){int first=-1,last=-1;for(int k=0;k<9;k++)if(FIX[dy][k]=='#'){if(first<0)first=k;last=k;}
      for(int dx=0;dx<9;dx++){if(FIX[dy][dx]=='#')plot(&cv,x+dx-4,y+dy-4,L_INK);else if(first<dx&&dx<last)clear(&cv,x+dx-4,y+dy-4);}}
    const char *name=in->events[e].name;const int lw=text_width(name);int lx=x-lw/2;lx=lx<W-4-lw?lx:W-4-lw;lx=lx>4?lx:4;
    const Box bx=bounds_of(scratch,text_pixels(name,lx,y-7,scratch));
    bool clear_=bx.y>=(in->home?14:2);
    #define CLEAR_OF(o) (!((o).x+(o).w+1<=bx.x||bx.x+bx.w+1<=(o).x||(o).y+(o).h+1<=bx.y||bx.y+bx.h+1<=(o).y))
    for(int k=0;k<taken_n&&clear_;k++)if(CLEAR_OF(taken[k]))clear_=false;
    for(int k=0;k<avoid_n&&clear_;k++)if(CLEAR_OF(avoid[k]))clear_=false;
    for(int k=0;k<nfigs&&clear_;k++)if(figs[k].w&&CLEAR_OF(figs[k]))clear_=false;
    #undef CLEAR_OF
    if(nevents<16){events[nevents].x=(int16_t)x;events[nevents].y=(int16_t)y;events[nevents].lx=(int16_t)lx;
      events[nevents].box[0]=(int16_t)bx.x;events[nevents].box[1]=(int16_t)bx.y;events[nevents].box[2]=(int16_t)bx.w;events[nevents].box[3]=(int16_t)bx.h;
      events[nevents].clear=clear_;memset(events[nevents].name,0,5);memcpy(events[nevents].name,name,strlen(name)<5?strlen(name):5);nevents++;}
  }
  // Home, over the route and figures, on its own knockout.
  if(home_mark){
    for(int dy=-6;dy<=6;dy++)for(int dx=-6;dx<=6;dx++)if(dx*dx+dy*dy<=36)clear(&cv,hx+dx,hy+dy);
    for(int dy=0;dy<11;dy++)for(int dx=0;dx<11;dx++)if(AIRPORT[dy][dx]=='#')plot(&cv,hx+dx-5,hy+dy-5,L_MARK);
    letter(&cv,home_code,home_code_n,L_MARK,1);
    // Its mark's pixels, in order: the symbol's and, over the ground, the
    // code's, where no knockout has cleared them.
    #define MARK_AT(px,py,code) do{const int X=(px),Y=(py);if(X>=0&&Y>=0&&X<W&&Y<H&&(PLANE_AT(classes,Y*W+X)>>4)==L_LATE_INK&&mark_n<128){\
      bool over_space_code=false;for(int i=0;i<home_code_n;i++)if(home_code[i].x==X&&home_code[i].y==Y&&(PLANE_AT(classes,Y*W+X)&15)==G_SPACE)over_space_code=true;\
      if(!over_space_code&&(!(code)||(PLANE_AT(classes,Y*W+X)&15)!=G_SPACE))marks[mark_n++]=(Y)*W+(X);}}while(0)
    for(int dy=0;dy<11;dy++)for(int dx=0;dx<11;dx++)if(AIRPORT[dy][dx]=='#')MARK_AT(hx+dx-5,hy+dy-5,false);
    for(int i=0;i<home_code_n;i++)MARK_AT(home_code[i].x,home_code[i].y,true);
    #undef MARK_AT
    // Sorted, each once.
    for(int i=1;i<mark_n;i++){const uint16_t v=marks[i];int j=i;while(j>0&&marks[j-1]>v){marks[j]=marks[j-1];j--;}marks[j]=v;}
    int kept=0;for(int i=0;i<mark_n;i++)if(!kept||marks[kept-1]!=marks[i])marks[kept++]=marks[i];mark_n=kept;
  }
  int16_t top_x=6,top_baseline=11,height_right=0,height_baseline=0;
  if(world){
    // Over the band, where the satellite's numbers come from: its elements'
    // epoch; its height at the right is the minute's. Under it, the pass
    // line and Zulu time.
    const SatSegment *seg=src->satellite?src->satellite(src->satellite_context,in->start):NULL;if(!seg)FAIL;
    int y,mo,d;const int32_t e=seg->epoch,day=(int32_t)((e>=0?e:e-86399)/86400),sec=e-day*86400;civil_from_days(day,&y,&mo,&d);
    char source[24],*p=source;
    for(const char *c=in->code[0]?in->code:"SAT";*c;c++)*p++=*c;
    memcpy(p," EL ",4);p+=4;p=put_int(p,d,2);*p++=' ';memcpy(p,MONTHS[mo-1],3);p+=3;*p++=' ';p=put_int(p,sec/3600,2);p=put_int(p,sec%3600/60,2);*p++='Z';*p=0;
    const int n=text_pixels(source,6,top-6,scratch);letter(&cv,scratch,n,L_INK,1);
    zulu_x=(int16_t)(W-6-text_width("0000Z"));zulu_baseline=H-1;top_baseline=H-1;height_right=W-6;height_baseline=(int16_t)(top-6);
  }else{
    // Margins: the local date and day of the year, Zulu time between them;
    // over the chart, home's rise and set.
    char left[24],right_[24];
    {char *p=put_int(left,in->day,2);*p++=' ';memcpy(p,MONTHS[in->month-1],3);p+=3;*p++=' ';put_int(p,in->year,1);
    memcpy(right_,"DAY ",4);put_int(right_+4,in->day_of_year,3);}
    {const int y=H-5,lw=text_width(left),rw=text_width(right_);
    int n=text_pixels(left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
    n=text_pixels(right_,W-6-rw,y,scratch);letter(&cv,scratch,n,L_INK,1);
    const int l=6+lw,r=W-6-rw;zulu_x=(int16_t)js_round((l+r-text_width("0000Z"))/2.0);zulu_baseline=(int16_t)y;}
    if(in->home&&in->rise_left[0]){
      const int y=11,rw=text_width(in->rise_right);
      int n=text_pixels(in->rise_left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
      n=text_pixels(in->rise_right,W-6-rw,y,scratch);letter(&cv,scratch,n,L_INK,1);
    }
  }
  draw=NULL;

  // The route's points, to the pixel, at the arena's end (the drawing's
  // lists done with); then the track is done with.
  const size_t tail=(ARENA-sizeof(EnrPoint)*(size_t)count)&~(size_t)3;
  EnrPoint *const kept=(EnrPoint *)(b->sink.arena+tail);
  for(int i=0;i<count;i++){
    EnrPoint *q=&kept[i];q->x=(int16_t)js_round(track[i].a);q->y=(int16_t)js_round(track[i].b);
    q->flags=(uint8_t)((i&&fabs(track[i].b-track[i-1].b)>fabs(track[i].a-track[i-1].a)?ENR_STEEP:0)|(i&&fabs(track[i].a-track[i-1].a)>W/2?ENR_JUMP:0)|(HOUR_OF(b,i)?ENR_HOUR:0));
  }
  const double c1x_=track[h1].a;
  double least=INFINITY;for(int i=0;i<count;i++)if(track[i].a<least)least=track[i].a;
  // The class plane as row runs, into the arena before the points; the
  // plane freed leaves one free stretch for the scene, and the points and
  // runs move there at their own sizes. Runs too long for the arena are made
  // over the plane itself.
  const uint8_t *runs;
  if(rolled){
    // A Fuller build's arena is small: its runs are packed over the plane
    // itself, and the plane shrunk to them.
    // The first band's runs go to the arena (its drawing done with), each
    // band after to its own block once the band before is let go; then all
    // of them together.
    uint8_t *piece[PLANE_BANDS]={0};unsigned n=0;b->sink.row_offset[0]=0;bool ok=true;
    for(int k=0;k<PLANE_BANDS&&ok;k++){
      unsigned m=0;for(int y=k*BAND_ROWS;y<(k+1)*BAND_ROWS;y++)m+=(unsigned)row_runs(PLANE_ROW(classes,y),NULL);
      piece[k]=k?alloc(m?m:1):m<=tail?b->sink.arena:NULL;
      if(!piece[k]){ok=false;break;}
      unsigned at=0;for(int y=k*BAND_ROWS;y<(k+1)*BAND_ROWS;y++){at+=(unsigned)row_runs(PLANE_ROW(classes,y),piece[k]+at);b->sink.row_offset[y+1]=(uint16_t)(n+at);}
      n+=m;release(b->plane.band[k]);b->plane.band[k]=NULL;
    }
    uint8_t *all=ok?alloc(n?n:1):NULL;
    if(all){unsigned at=0;for(int k=0;k<PLANE_BANDS;k++){const unsigned m=(unsigned)(b->sink.row_offset[(k+1)*BAND_ROWS]-b->sink.row_offset[k*BAND_ROWS]);memcpy(all+at,piece[k],m);at+=m;}}
    for(int k=1;k<PLANE_BANDS;k++)release(piece[k]);
    if(!all)FAIL;
    runs=all;
    points=alloc(sizeof(EnrPoint)*(count?count:1));if(!points){release(all);FAIL;}
    memcpy(points,kept,sizeof(EnrPoint)*count);release(b->sink.arena);b->sink.arena=NULL;
  }else
  {unsigned n=0;for(int y=0;y<H;y++)n+=(unsigned)row_runs(PLANE_ROW(classes,y),NULL);
  uint8_t *arena=b->sink.arena;
  if(n<=tail){
    n=0;b->sink.row_offset[0]=0;
    for(int y=0;y<H;y++){n+=(unsigned)row_runs(PLANE_ROW(classes,y),arena+n);b->sink.row_offset[y+1]=(uint16_t)n;}
    plane_free(b);
    points=alloc(sizeof(EnrPoint)*(count?count:1));if(!points)FAIL;
    memcpy(points,kept,sizeof(EnrPoint)*count);
    b->sink.arena=NULL;
    uint8_t *moved=src->resize?src->resize(arena,n?n:1):NULL;
    runs=moved?moved:arena;
  }else{
    // Longer than the room before the points: the rest to a spill block,
    // and all of it together once the plane is freed.
    uint8_t *spill=alloc(n-tail);if(!spill)FAIL;
    unsigned at=0;b->sink.row_offset[0]=0;uint8_t row[2*W];
    for(int y=0;y<H;y++){
      const int k=row_runs(PLANE_ROW(classes,y),row);
      for(int q=0;q<k;q++,at++){if(at<tail)arena[at]=row[q];else spill[at-tail]=row[q];}
      b->sink.row_offset[y+1]=(uint16_t)at;
    }
    plane_free(b);
    points=alloc(sizeof(EnrPoint)*(count?count:1));
    uint8_t *all=alloc(n);
    if(!points||!all){release(all);release(spill);FAIL;}
    memcpy(points,kept,sizeof(EnrPoint)*count);memcpy(all,arena,tail);memcpy(all+tail,spill,n-tail);
    release(spill);release(arena);b->sink.arena=NULL;runs=all;
  }}
  if(!runs)FAIL;
  
  // The scene: the plate, the night's tables, the minutes and the track.
  out=alloc(sizeof(EnrScene));if(!out){release((void *)runs);FAIL;}
  memset(out,0,sizeof *out);
  out->runs=runs;out->owns_runs=true;memcpy(out->row_offset,b->sink.row_offset,sizeof out->row_offset);
  out->track=points;out->track_count=(uint16_t)count;out->track_t0=b->t0;out->track_step=(int16_t)b->step;points=NULL;
  out->flags=(uint8_t)((pal->flags&PLATE_ZONES?1:0)|(pal->flags&PLATE_SCAN?2:0)|(pal->flags&PLATE_TERMINATOR?4:0)|(pal->flags&PLATE_NIGHT_DOTS?8:0)|(in->readout==1?16:0)|(in->readout==2?32:0)|(world&&in->tape?64:0)|(world&&in->tape==2?128:0));
  out->body=(uint8_t)in->body;out->view=world?ENR_VIEW_WORLD:day?ENR_VIEW_DAY:ENR_VIEW_HOUR;out->forward=(int8_t)(forward?1:-1);out->hour_start=(int32_t)in->start;
  memcpy(out->zoned,pal->zoned,sizeof out->zoned);
  out->space=pal->space;out->space_ink=pal->space_ink;out->screen=pal->screen;out->waterline=pal->waterline;out->terminator=pal->terminator;out->night_dots=pal->night_dots;
  for(int k=0;k<5;k++)out->tints[k]=k<pal->tint_count?pal->tints[k]:0;
  for(int k=0;k<2;k++)out->depths[k]=k<pal->depth_count?pal->depths[k]:0;
  if(!rolled){
  for(int y=0;y<H;y++){const double lat=glat(&cam,y+.5)*RAD;out->row_cos[y]=(enr_real)f_cos(lat);out->row_sin[y]=(enr_real)f_sin(lat);}
  for(int x=0;x<W;x++){const double lon=glon(&cam,x+.5)*RAD;out->col_cos[x]=(enr_real)f_cos(lon);out->col_sin[x]=(enr_real)f_sin(lon);}
  }else{
    // A Fuller sheet is lit from its faces' grids: their frames, each
    // tile's place, which tile each pixel lies on, the grid's directions.
    const FullerCam *fc=b->fc;EnrFuller *f=out->fuller=alloc(sizeof(EnrFuller));if(!f)FAIL;memset(f,0,sizeof *f);
    double net=INFINITY;for(int t=0;t<fc->tile_count;t++)if(fc->tiles[t].box[1]<net)net=fc->tiles[t].box[1];f->net_top=net>0?net:0;
    memcpy(f->bases,b->fg->bases,sizeof f->bases);
    f->tile_count=(uint8_t)fc->tile_count;for(int t=0;t<fc->tile_count;t++){f->tile_face[t]=fc->tiles[t].face;fuller_tile_grid(fc,t,GRID_N,f->tile_grid[t]);}
    // Which tile each pixel lies on comes after (fuller_tile_rows).
    b->tile_cap=2048;b->tile_n=0;b->tile_row=0;f->tile_runs=alloc(b->tile_cap);if(!f->tile_runs)FAIL;f->tile_offset[0]=0;
    if(b->dirs){f->dirs=b->dirs;b->dirs=NULL;}
    else{
      f->dirs=alloc(sizeof(int16_t)*3*GRID_POINTS);if(!f->dirs)FAIL;
      uint8_t *d=(uint8_t *)f->dirs;if(src->grids(src->grid_source,FULLER_HEADER,d,6*GRID_POINTS)!=6*GRID_POINTS)FAIL;
      for(int k=0;k<3*GRID_POINTS;k++){const int16_t v=(int16_t)(d[2*k]|d[2*k+1]<<8);f->dirs[k]=v;}
    }
    out->heavy=heavy;
  }
  out->c1x=(enr_real)c1x_;out->normal_x=cam.slow?(enr_real)cam.nx:0;out->normal_y=cam.slow?(enr_real)cam.ny:-1;
  out->zulu_x=zulu_x;out->zulu_baseline=zulu_baseline;out->top_x=top_x;out->top_baseline=top_baseline;out->height_right=height_right;out->height_baseline=height_baseline;
  if(world&&!in->tape){out->tape_x0=TAPE_X0;out->tape_x1=TAPE_X1;out->tape_baseline=TAPE_BASELINE;out->tape_lo=tape_lo;out->tape_hi=tape_hi;}
  out->home_x=home_mark?(int16_t)hx:-1000;out->home_y=home_mark?(int16_t)hy:-1000;
  out->numerals=(uint8_t)in->numerals;
  out->slide_minute=world&&in->tape==2?(uint8_t)in->minute:255;
  out->event_count=(uint8_t)nevents;memcpy(out->events,events,sizeof events[0]*nevents);
  if(world&&in->tape){
    memcpy(out->tape_hour,hour,strlen(hour));memcpy(out->tape_next,next,strlen(next));
    if(!chart_callout_figures(out,src->figures,src->figure_source,alloc))FAIL;
  }
  out->c0[0]=(int16_t)c0x;out->c0[1]=(int16_t)c0y;out->c1[0]=(int16_t)c1x;out->c1[1]=(int16_t)c1y;
  out->station_count=(uint8_t)nshown;memcpy(out->stations,shown,sizeof(int16_t)*2*nshown);memcpy(out->station_table,shown_table,nshown);
  for(int k=0;k<nfigs&&k<2;k++){out->fig_box[k][0]=(int16_t)figs[k].x;out->fig_box[k][1]=(int16_t)figs[k].y;out->fig_box[k][2]=(int16_t)figs[k].w;out->fig_box[k][3]=(int16_t)figs[k].h;}
  if(!world){
    // The time callout's place, hour and the lettering it breaks for; its
    // figures, when it is drawn.
    if(day){out->callout_left=(int16_t)(floor(least)-8);out->callout_top=(int16_t)(4+(in->home?14:0));out->callout_bottom=H-18;}
    memset(out->hour_text,0,3);
    if(in->numerals==ENR_EVEN&&in->clock24&&!hour[1]){out->hour_text[0]='0';out->hour_text[1]=hour[0];}else memcpy(out->hour_text,hour,strlen(hour));
    out->avoid_count=(uint8_t)avoid_n;
    for(int k=0;k<avoid_n;k++){out->avoid[k][0]=(int16_t)avoid[k].x;out->avoid[k][1]=(int16_t)avoid[k].y;out->avoid[k][2]=(int16_t)avoid[k].w;out->avoid[k][3]=(int16_t)avoid[k].h;}
    if((day||in->readout==2)&&!chart_callout_figures(out,src->figures,src->figure_source,alloc))FAIL;
  }
  out->mark_count=(uint8_t)mark_n;for(int k=0;k<mark_n;k++){out->marks[k][0]=(uint8_t)(marks[k]%W);out->marks[k][1]=(uint8_t)(marks[k]/W);}
  if(home_mark){out->home_box[0]=(int16_t)home_box.x;out->home_box[1]=(int16_t)home_box.y;out->home_box[2]=(int16_t)home_box.w;out->home_box[3]=(int16_t)home_box.h;}
  b->out=out;b->forward=forward;b->minute=0;
  if((world||(rolled&&cam.wide&&!day))&&in->home){b->sb=alloc(2*120*sizeof(double));if(!b->sb)FAIL;b->cb=b->sb+120;bearings(3,b->sb,b->cb);}
  return true;
fail:
  if(out){enr_free(out,release);release(out);}
  release(points);
  return false;
}
// Minutes m0 up to m1 of the scene; home's acquisition circles, minutes
// that plot the same pixels sharing one.
static bool finish_minutes(ChartBuild *b,int m0,int m1){
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;const Cam cam=b->cam;const bool world=FACE_WORLD&&(!FACE_HOUR||cam.world),forward=b->forward;
  EnrScene *const out=b->out;uint8_t ring[2*120];
  for(int m=m0;m<m1;m++){
    const int64_t t=in->start+m*60;EnrMinute *e=&out->minutes[m];
    double lat,lon,altitude;if(!body_position(src,0,t,&lat,&lon))FAIL;
    e->sun[0]=(enr_real)(f_cos(lat*RAD)*f_cos(lon*RAD));e->sun[1]=(enr_real)(f_cos(lat*RAD)*f_sin(lon*RAD));e->sun[2]=(enr_real)f_sin(lat*RAD);
    if(!body_place(src,in->body,t,&lat,&lon,&altitude))FAIL;
    double mx,my;project(&cam,lat,lon,&mx,&my);e->mx=(enr_real)mx;e->my=(enr_real)my;
    const Segment *seg=src->segment(src->segment_context,(int32_t)(t/86400));if(!seg)FAIL;
    bool waxing;double fraction;seg_moon_light(seg,t,&fraction,&waxing);e->moon_fraction=(enr_real)fraction;e->waxing=waxing;
    // The margin's time: Zulu, or the nautical zone's under the body (15
    // degrees wide, lettered A-M east, N-Y west).
    int zh=0;char zl='Z';
    if(in->zone_body){
      const double v=js_round((f_fmod(lon+540,360)-180)/15);zh=v>12?12:v<-12?-12:(int)v;
      if(zh>0)zl="ABCDEFGHIKLM"[zh-1];else if(zh<0)zl="NOPQRSTUVWXY"[-zh-1];
    }
    const int64_t day=((t+zh*3600)%86400+86400)%86400;const int hh=(int)(day/3600),mm=(int)(day%3600/60);
    e->zulu[0]=(char)('0'+hh/10);e->zulu[1]=(char)('0'+hh%10);e->zulu[2]=(char)('0'+mm/10);e->zulu[3]=(char)('0'+mm%10);e->zulu[4]=zl;
    // The local clock's minute: the hour starts on the local hour.
    e->minute[0]=(char)('0'+m/10);e->minute[1]=(char)('0'+m%10);memset(e->top,0,sizeof e->top);
    // A satellite's pass line, which can change within the hour.
    if(in->body>=2&&in->home&&src->pass_line)src->pass_line(src->pass_context,t,e->top);
    memset(e->height,0,sizeof e->height);e->circle=255;e->index=0;
    // A Fuller satellite sheet's home circle follows the satellite's height.
    if(FACE_ROLL&&(!FACE_CHART||b->fc)&&cam.wide&&!cam.day&&in->home){
      const int n=circle_pixels_on(&cam,in->home_lat,in->home_lon,reach(altitude,10),3,b->sb,b->cb,ring,true);int k=0;
      for(;k<out->circle_count;k++)if(out->circle_n[k]==n&&!memcmp(out->circle_px[k],ring,2*n))break;
      if(k==out->circle_count){
        if(k>=60||!(out->circle_px[k]=src->alloc(n?2*n:1)))FAIL;
        memcpy(out->circle_px[k],ring,2*n);out->circle_n[k]=(uint8_t)n;out->circle_count++;
      }
      e->circle=(uint8_t)k;
    }
    if(world){
      if(!in->tape)e->index=(int16_t)js_round(forward?TAPE_X0+(double)(TAPE_X1-TAPE_X0)*m/60:TAPE_X1-(double)(TAPE_X1-TAPE_X0)*m/60);
      char *p=put_int(e->height,(int)js_round(altitude),1);memcpy(p," KM",3);
      if(in->home){
        const int n=circle_pixels(&cam,in->home_lat,in->home_lon,reach(altitude,10),3,b->sb,b->cb,ring);int k=0;
        for(;k<out->circle_count;k++)if(out->circle_n[k]==n&&!memcmp(out->circle_px[k],ring,2*n))break;
        if(k==out->circle_count){
          if(k>=60||!(out->circle_px[k]=src->alloc(n?2*n:1)))FAIL;
          memcpy(out->circle_px[k],ring,2*n);out->circle_n[k]=(uint8_t)n;out->circle_count++;
        }
        e->circle=(uint8_t)k;
      }
    }
  }
  return true;
fail:
  return false;
}
EnrScene *chart_finish(ChartBuild *b){
  int r;while((r=chart_step(b))>0){}
  if(r<0||!b->out||b->minute<60){chart_abort(b);return NULL;}
  EnrScene *out=b->out;b->out=NULL;
  enr_ready(out);b->src.release(b->sb);fuller_free(b);b->src.release(b);
  return out;
}
bool chart_callout_figures(EnrScene *s,MapReadFn read,void *source,void *(*alloc)(size_t)){
  const unsigned from=FIGURE_GLYPHS[0].first,to=FIGURE_GLYPHS[30].first;
  s->fig_bits=alloc(to-from);
  if(!s->fig_bits||read(source,from,s->fig_bits,to-from)!=to-from)return false;
  for(int k=0;k<3;k++)for(int d=0;d<10;d++){const FigureGlyph *g=&FIGURE_GLYPHS[k*10+d];s->figures[k].width[d]=g->width;s->figures[k].height[d]=g->height;s->figures[k].first[d]=(uint16_t)(g->first-from);}
  return true;
}
EnrScene *chart_build(const ChartInput *in,const ChartSources *src){
  ChartBuild *b=chart_begin(in,src);if(!b)return NULL;
  return chart_finish(b);
}

static int row_runs(const uint8_t *row,uint8_t *out){
  int n=0;
  for(int x=0;x<W;){int k=1;while(x+k<W&&k<255&&row[x+k]==row[x])k++;if(out){out[n]=(uint8_t)k;out[n+1]=row[x];}n+=2;x+=k;}
  return n;
}
bool chart_runs(const uint8_t *classes,EnrScene *s,void *(*alloc)(size_t)){
  unsigned n=0;
  for(int y=0;y<H;y++)n+=(unsigned)row_runs(classes+y*W,NULL);
  uint8_t *runs=alloc(n?n:1);if(!runs)return false;
  n=0;s->row_offset[0]=0;
  for(int y=0;y<H;y++){n+=(unsigned)row_runs(classes+y*W,runs+n);s->row_offset[y+1]=(uint16_t)n;}
  s->runs=runs;s->owns_runs=true;return true;
}
// The same, written over the class plane itself, then shrunk: no second
// plane's worth of memory. A row's runs are written over rows already read;
// where the top rows' runs (lettering, figures) run ahead of that, they wait
// in a small queue. Takes the plane (freed or kept as the runs) in any case.
#define RUN_QUEUE 1024
bool chart_runs_in_place(uint8_t *classes,EnrScene *s,const ChartSources *src){
  const uint8_t *runs=chart_plane_runs(classes,s->row_offset,src);
  if(!runs)return false;
  s->runs=runs;s->owns_runs=true;return true;
}
const uint8_t *chart_plane_runs(uint8_t *classes,uint16_t *row_offset,const ChartSources *src){
  uint8_t *queue=src->resize?src->alloc(RUN_QUEUE):NULL;
  if(!queue){EnrScene *s=src->alloc(sizeof(EnrScene));if(!s){src->release(classes);return NULL;}
    const bool ok=chart_runs(classes,s,src->alloc);src->release(classes);memcpy(row_offset,s->row_offset,sizeof s->row_offset);const uint8_t *r=ok?s->runs:NULL;src->release(s);return r;}
  unsigned n=0,written=0,head=0,held=0;row_offset[0]=0;
  for(int y=0;y<H;y++){
    uint8_t runs[2*W];const int k=row_runs(classes+y*W,runs);
    // Too far ahead (the rows before are overwritten): only a failure.
    if(held+(unsigned)k>RUN_QUEUE){src->release(queue);src->release(classes);return NULL;}
    for(int i=0;i<k;i++){queue[(head+held)%RUN_QUEUE]=runs[i];held++;}
    n+=(unsigned)k;row_offset[y+1]=(uint16_t)n;
    // Rows up to y are read: runs may go up to the next row's start.
    const unsigned limit=y+1<H?(unsigned)(y+1)*W:(unsigned)W*H;
    while(held&&written<limit){classes[written++]=queue[head];head=(head+1)%RUN_QUEUE;held--;}
  }
  src->release(queue);
  if(held){src->release(classes);return NULL;}
  uint8_t *runs=src->resize(classes,n?n:1);
  return runs?runs:classes;
}
