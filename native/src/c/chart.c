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
static double js_round(double v){const double r=f_floor(v);return v-r>=0.5?r+1:r;}
// geometry.js wrap(): longitude into -180..180.
static double wrap(double lon){return f_mod(lon+180,360)-180;}

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
// (Home's circle at the satellite's height, to two degrees: an oval orbit
// changes height every minute, and each circle of its own is kept.)
#define REACH(altitude) (js_round(reach(altitude,10)/2)*2)
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
  const Segment *seg=src->segment(src->segment_context,(int32_t)q64(t,86400));
  if(!seg)return false;
  seg_position(seg,body==1,t,lat,lon);return true;
}

// ---------------------------------------------------------------- map tiles
// The map under the chart (map_pack.h), from the mip whose cells are at
// most a pixel wide, streamed a cell row at a time: a strip of tile
// decoders across the chart, each tile decoded once as the ground goes
// down the map, and the last few cell rows kept flat across the chart's
// columns, so a cell is an index into a row. Land and height are read
// bilinearly between cell centres, as the study always did, in integers:
// fractions in Q8, heights in Q8 metres.
#define MAP_ROWS 4                       // cell rows kept
#define MAP_COLS 402                     // cells across (under 400 by the mip rule, and a neighbour)
#define MAP_ACROSS 15                    // tiles across
typedef struct {
  MapPack pack;int mip;const MapMip *q;double cell;      // the mip read and its cell size in degrees
  int c0,ncols;                          // the chart's first cell column (the mip's), and how many
  int ty,tx0,ntiles;                     // the strip open: its tile row, first tile column, tiles
  int row_j[MAP_ROWS],newest,next;       // the rows kept (-1 none) and the newest's
  uint8_t rows[MAP_ROWS][MAP_COLS];
  MapTileStream tiles[MAP_ACROSS];
  bool failed;
} Tiles;
// The mip for a chart's scale (pixels a degree): the coarsest whose cells
// are at most a pixel wide, else the finest the pack has.
static void tiles_choose(Tiles *t,double px_per_degree){
  int best=-1;double bd=0,finest=1e9;int fine=0;
  for(int m=0;m<t->pack.mips;m++){
    const double d=map_cell_degrees(t->pack.mip[m].resolution);
    if(d<finest){finest=d;fine=m;}
    if(d*px_per_degree<=1.0&&d>bd){bd=d;best=m;}
  }
  t->mip=best>=0?best:fine;t->q=&t->pack.mip[t->mip];t->cell=map_cell_degrees(t->q->resolution);
  for(int k=0;k<MAP_ROWS;k++)t->row_j[k]=-1;
  t->newest=-1;t->next=0;t->ty=-1;
}
// The map's place under a longitude or latitude: the cell centre before the
// point and the fraction past it (Q8), for bilinear reading. Columns are
// the chart's own (from c0, wrapping round the world).
typedef struct {int32_t i,f;} Place;
static int32_t cell_column(double lon,double cell){return (int32_t)f_floor((wrap(lon)+180)/cell-.5);}
static Place place_lon(const Tiles *t,double lon){
  const double u=(wrap(lon)+180)/t->cell-.5,i=f_floor(u);const int w=t->q->width;
  return (Place){((((int32_t)i-t->c0)%w)+w)%w,(int32_t)f_floor((u-i)*256)};
}
static Place place_lat(const Tiles *t,double lat){const double v=(90-lat)/t->cell-.5,j=f_floor(v);return (Place){(int32_t)j,(int32_t)f_floor((v-j)*256)};}
// The chart's columns: from the cell under its left edge to the one past
// its right edge; a chart wider than the world (the band fitted to a long
// hour) takes the whole world and the first column again.
static bool tiles_columns(Tiles *t,const Cam *cam){
  const int w=t->q->width;
  const double l=glon(cam,.25),r=glon(cam,W-.25);
  const int32_t a=(int32_t)f_floor((l+180)/t->cell-.5),b=(int32_t)f_floor((r+180)/t->cell-.5);
  // (Within the world's columns: half a cell east of the date line is the
  // last column, not one before the first.)
  t->c0=((cell_column(l,t->cell)%w)+w)%w;
  int n=(int)(b-a)+2;
  if(n>w+1)n=w+1;
  if(n>MAP_COLS)return false;
  t->ncols=n;return true;
}
// A strip of decoders opened for tile row ty.
static bool tiles_strip(Tiles *t,int ty){
  const MapMip *q=t->q;
  t->ty=ty;t->tx0=t->c0/MAP_TILE;
  // Tiles until the chart's columns are covered (the last tile across the
  // world may be narrower than the rest).
  int n=0;for(int covered=-(t->c0%MAP_TILE);covered<t->ncols&&n<q->cols;n++){const int tx=(t->tx0+n)%q->cols,tw=q->width-tx*MAP_TILE;covered+=tw<MAP_TILE?tw:MAP_TILE;}
  t->ntiles=n;
  if(t->ntiles>MAP_ACROSS)return false;
  for(int k=0;k<t->ntiles;k++)if(!map_tile_open(&t->pack,t->mip,(t->tx0+k)%q->cols,ty,&t->tiles[k]))return false;
  return true;
}
// Cell row j (the mip's rows, held to its edge) across the chart's columns.
// Rows are asked for downward: a new one is decoded on from the newest.
static const uint8_t *map_row(Tiles *t,int j){
  const MapMip *q=t->q;const int w=q->width;
  j=j<q->first?q->first:j>=q->first+q->rows?q->first+q->rows-1:j;
  for(int k=0;k<MAP_ROWS;k++)if(t->row_j[k]==j)return t->rows[k];
  if(t->newest>=0&&j<t->newest){t->failed=true;return t->rows[0];}
  for(int jj=t->newest<0?j:t->newest+1;jj<=j;jj++){
    const int ty=(jj-q->first)/MAP_TILE,cy=(jj-q->first)%MAP_TILE;
    if(ty!=t->ty){if(!tiles_strip(t,ty)){t->failed=true;return t->rows[0];}}
    // Decode forward to this row of every tile in the strip, keeping only
    // the one asked for.
    uint8_t *row=t->rows[t->next];
    for(int k=0;k<t->ntiles;k++){
      MapTileStream *st=&t->tiles[k];uint8_t cells[MAP_TILE];
      while(st->row<=cy){
        if(!map_tile_row(&t->pack,t->mip,(t->tx0+k)%q->cols,ty,st,cells)){t->failed=true;return t->rows[0];}
      }
      // The tile's own columns (the last tile across may be partial).
      const int tx=(t->tx0+k)%q->cols,tw=w-tx*MAP_TILE<MAP_TILE?w-tx*MAP_TILE:MAP_TILE,base=tx*MAP_TILE-t->c0;
      for(int cx=0;cx<tw;cx++){
        int ci=((base+cx)%w+w)%w;
        if(ci<t->ncols)row[ci]=cells[cx];
        if(ci==0&&t->ncols==w+1)row[w]=cells[cx];
      }
    }
    t->row_j[t->next]=jj;t->newest=jj;t->next=(t->next+1)%MAP_ROWS;
  }
  for(int k=0;k<MAP_ROWS;k++)if(t->row_j[k]==j)return t->rows[k];
  t->failed=true;return t->rows[0];
}
// Land (0..256) and height (Q8 metres) bilinear at a place, between the
// cell rows under and past it (fetched once a pixel row).
static inline int32_t land_at(const uint8_t *r0,const uint8_t *r1,Place px,int32_t fy){
  const int32_t c00=r0[px.i]>>4,c10=r0[px.i+1]>>4,c01=r1[px.i]>>4,c11=r1[px.i+1]>>4;
  return (((c00*(256-px.f)+c10*px.f)*(256-fy)+(c01*(256-px.f)+c11*px.f)*fy)+128)>>8;
}
static inline int32_t height_at(const int16_t *h,const uint8_t *r0,const uint8_t *r1,Place px,int32_t fy){
  const int32_t h00=h[r0[px.i]&15],h10=h[r0[px.i+1]&15],h01=h[r1[px.i]&15],h11=h[r1[px.i+1]&15];
  return ((h00*(256-px.f)+h10*px.f)*(256-fy)+(h01*(256-px.f)+h11*px.f)*fy)>>8;
}

// ---------------------------------------------------------------- relief smoothing
// reliefLayer(): three passes of a three-tap box, across then down, in Q8
// metres, each mean rounded to the nearest. Rows flow through three stages
// as they are sampled.
typedef void (*EmitFn)(void *ctx,int row,const int32_t *values);
// Every stage writes its output into one shared row (the stages run one
// inside another, each taking its input before writing): nothing large is
// kept on the stack.
typedef struct {int32_t t[3][W];int rows;EmitFn emit;void *ctx;int32_t *out;} Smooth;
static int32_t mean_of(int32_t sum,int n){return sum>=0?(sum+n/2)/n:-((-sum+n/2)/n);}
static void smooth_push(Smooth *s,const int32_t *in){
  const int r=s->rows++;int32_t *t=s->t[r%3];
  t[0]=mean_of(in[0]+in[1],2);
  for(int x=1;x<W-1;x++)t[x]=mean_of(in[x-1]+in[x]+in[x+1],3);
  t[W-1]=mean_of(in[W-2]+in[W-1],2);
  if(r>=1){
    // Row r-1 from rows r-2 (if any), r-1 and r.
    int32_t *out=s->out;const int y=r-1;const int32_t *a=y>0?s->t[(y-1)%3]:NULL,*b=s->t[y%3],*c=s->t[r%3];
    if(a)for(int x=0;x<W;x++)out[x]=mean_of(a[x]+b[x]+c[x],3);
    else for(int x=0;x<W;x++)out[x]=mean_of(b[x]+c[x],2);
    s->emit(s->ctx,y,out);
  }
}
static void smooth_finish(Smooth *s){
  int32_t *out=s->out;const int y=s->rows-1;
  for(int x=0;x<W;x++){int32_t sum=0;int n=0;for(int d=-1;d<=1;d++){const int yy=y+d;if(yy>=0&&yy<H&&yy<=y){sum+=s->t[yy%3][x];n++;}}out[x]=mean_of(sum,n);}
  s->emit(s->ctx,y,out);
}

// ---------------------------------------------------------------- the ground
#define LAND_RING 16
#define E3_RING 8
// The ground's classes leave row by row as row runs: the class plane itself
// is made only once the map's decoder is done with. The runs go to an arena
// taken first, so the decoder's memory, freed, leaves one free stretch for
// the plane; any more go to chunks.
// (The arena then becomes the scene's own: its minutes and, on the map's
// charts, the columns' lighting table.)
#define RUN_ARENA (FACE_CHART?9472:8192)
#define RUN_CHUNK 2048
_Static_assert(RUN_ARENA>=60*sizeof(EnrMinute)+(FACE_CHART?2*W*sizeof(enr_real):0)&&60*sizeof(EnrMinute)%8==0,"the arena holds the scene's minutes and columns");
typedef struct RunChunk {struct RunChunk *next;uint16_t used;uint8_t data[RUN_CHUNK];} RunChunk;
// cap: the arena's room for runs (a Fuller build keeps its track at the end).
// dropped: chunks let go from the head, their rows read for the last time.
typedef struct {uint8_t *arena;RunChunk *head,*tail;void *(*alloc)(size_t);uint16_t row_offset[H+1];unsigned n,cap,dropped;bool failed;} RunSink;
static int row_runs(const uint8_t *row,uint8_t *out);
static void sink_row(RunSink *k,int y,const uint8_t *row){
  uint8_t runs[2*W];const int n=row_runs(row,runs);
  // (The rows' offsets are 16 bits.)
  if(k->n+(unsigned)n>65535){k->failed=true;return;}
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
  uint8_t hdist[LAND_RING][W/2];              // each pixel's distance along its row to land, 0-6, a nibble each
  #define MAT_RING 4
  uint8_t mat[MAT_RING][W];int mat_y[MAT_RING];   // materials of the rows being finalised (-1 none)
  uint8_t space[LAND_RING][W/8+1];            // a Fuller sheet's pixels off its net
  int32_t e3[E3_RING][W];int e3_rows;         // smoothed relief rows emitted (Q8 metres)
  int32_t row[W];                             // the sampled row, then each stage's output
  // The map's place under each column, at x + .25, .5 and .75 (a face
  // without the map's charts, Groundtrack Fuller, keeps none).
  Place col[FACE_CHART?3:1][FACE_CHART?W:1];
  int done;                                   // rows finalised
  int32_t shade_step;                         // shaded relief: Q8 metres a step of light
} Ground;
static void emit2(void *ctx,int row,const int32_t *v){Ground *g=ctx;(void)row;smooth_push(&g->s3,v);}
static void emit1(void *ctx,int row,const int32_t *v){Ground *g=ctx;(void)row;smooth_push(&g->s2,v);}
static void emit3(void *ctx,int row,const int32_t *v){Ground *g=ctx;memcpy(g->e3[row%E3_RING],v,sizeof(int32_t)*W);g->e3_rows=row+1;}
static bool is_land(const Ground *g,int x,int y){return (g->land[y%LAND_RING][x>>3]>>(x&7))&1;}
static int hdist_at(const Ground *g,int x,int y){return (g->hdist[y%LAND_RING][x>>1]>>((x&1)*4))&15;}
// A sampled row's distances along it to land, capped at 6: a sweep each way.
static void row_distances(Ground *g,int y){
  uint8_t *h=g->hdist[y%LAND_RING];uint8_t d[W];int run=6;
  for(int x=0;x<W;x++){run=is_land(g,x,y)?0:run<6?run+1:6;d[x]=(uint8_t)run;}
  run=6;
  for(int x=W-1;x>=0;x--){run=is_land(g,x,y)?0:run<6?run+1:6;if(run<d[x])d[x]=(uint8_t)run;}
  for(int x=0;x<W;x+=2)h[x>>1]=(uint8_t)(d[x]|d[x+1]<<4);
}
// seaDistance(): chessboard distance to the nearest land pixel, capped at 6:
// the least over the rows round it of the greater of the row's distance
// away and the distance along it.
static int sea_distance(const Ground *g,int x,int y){
  int best=6;
  for(int dy=0;dy<best;dy++){
    if(y+dy<H){const int d=hdist_at(g,x,y+dy);if((d>dy?d:dy)<best)best=d>dy?d:dy;}
    if(dy&&y-dy>=0){const int d=hdist_at(g,x,y-dy);if((d>dy?d:dy)<best)best=d>dy?d:dy;}
  }
  return best;
}
// The waterlines' distance: steps along rows and columns, capped at 6.
static int shore_distance(const Ground *g,int x,int y){
  int best=6;
  for(int dy=0;dy<best;dy++){
    if(y+dy<H){const int d=dy+hdist_at(g,x,y+dy);if(d<best)best=d;}
    if(dy&&y-dy>=0){const int d=dy+hdist_at(g,x,y-dy);if(d<best)best=d;}
  }
  return best;
}
static int material_of(const Ground *g,int x,int y){
  if(is_land(g,x,y))return M_LAND;
  const int d=sea_distance(g,x,y);
  return d<=1?M_COAST:d==4?M_WAVE:M_SEA;
}
// A row's materials, found once (finalise_row reads each row three times,
// as a row and as its neighbours').
static const uint8_t *material_row(Ground *g,int y){
  const int k=y%MAT_RING;
  if(g->mat_y[k]!=y){for(int x=0;x<W;x++)g->mat[k][x]=(uint8_t)material_of(g,x,y);g->mat_y[k]=y;}
  return g->mat[k];
}
#define material(g,x,y) (material_row((Ground *)(g),(y))[(x)])
// The contours: every level; on the whole-day chart 2,000 and 4,000 m only.
static const int WIDE_CONTOURS[2]={2000,4000};
static int level_of_in(int32_t v,const int *levels,int n){int k=0;for(int c=0;c<n;c++)if(v>=levels[c]*256)k++;return k;}
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
    const int32_t relief=g->e3[y%E3_RING][x];
    int overlay=0;
    // contourLevel()
    int level=0;
    if(land){
      const int k=level_of(relief);
      if(k)for(int w=0;w<4;w++){int nx,ny;if(!neighbour(x,y,w,&nx,&ny))continue;if(material(g,nx,ny)==M_LAND&&level_of(g->e3[ny%E3_RING][nx])<k){level=levels[k-1];break;}}
    }
    if(level&&((level!=CHART_CONTOURS[0]&&!(pal->flags&PLATE_DOTS))||((x+y)&1)==0))overlay=L_CONTOUR;
    else if(m==M_COAST)overlay=L_COAST;
    else if(!sparse&&!land&&relief<CHART_SHELF*256&&((x+y)&1)==0&&({bool any=false;for(int w=0;w<4&&!any;w++){int nx,ny;if(neighbour(x,y,w,&nx,&ny)&&material(g,nx,ny)!=M_LAND&&g->e3[ny%E3_RING][nx]>=CHART_SHELF*256)any=true;}any;}))overlay=L_SHELF;
    else if((pal->flags&PLATE_WATERLINE)&&!sparse&&!land&&({const int d=shore_distance(g,x,y);d>=2&&d<=5;})&&y%3==0)overlay=L_WATERLINE;
    // The ground class: tints by height on land, depths at sea.
    int ground=land?G_LAND:G_WATER;
    if(land&&pal->tint_count){int k=0;while(k<pal->tint_count-1&&!(relief<pal->tint_q[k]))k++;ground=G_TINT0+k;}
    else if(!land&&pal->depth_count){int k=0;while(k<pal->depth_count-1&&!(relief>=pal->depth_q[k]))k++;ground=G_DEPTH0+k;}
    // Shaded relief: the land's light from its slope (the smoothed relief,
    // held at sea level so the coast does not fall away), lit from the
    // northwest and dithered like an airbrush: classes 0 (deep shadow) to
    // 4 (full light), 2 flat. Contours give way to it.
    if(land&&(pal->flags&PLATE_SHADE)&&!g->shade_step)ground=G_TINT0+2;
    else if(land&&(pal->flags&PLATE_SHADE)){
      #define AT(xx,yy) ({const int32_t v_=g->e3[(yy)%E3_RING][(xx)];v_>0?v_:0;})
      const int xl=x>0?x-1:x,xr=x<W-1?x+1:x,yu=y>0?y-1:y,yd=y<H-1?y+1:y;
      const int32_t gx=AT(xr,y)-AT(xl,y),gy=AT(x,yd)-AT(x,yu);
      #undef AT
      // A slope facing the northwest rises to the southeast: gx + gy > 0.
      static const int8_t BAYER16[16]={0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5};
      const int32_t v=(gx+gy)*16/g->shade_step+BAYER16[(y&3)*4+(x&3)]-8;
      int k=2+(v>=0?(v+8)/16:-((-v+7)/16));k=k<0?0:k>4?4:k;
      ground=G_TINT0+k;if(overlay==L_CONTOUR)overlay=0;
    }
    // The lattice is the ground alone: its dots are the coast and relief.
    if(pal->flags&PLATE_LATTICE)overlay=0;
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
  for(int k=0;k<MAT_RING;k++)g->mat_y[k]=-1;
  // A step of light: 90 m a pixel pair on the hour charts, more where the
  // chart is smaller and a level boundary is crossed in fewer pixels (to
  // four times at the world band's scale).
  if(pal->flags&PLATE_SHADE){const double sc=cam->scale>0?cam->scale:2,f=1+2/sc;g->shade_step=(int32_t)(90*256*(f>4?4:f));}
}
static bool ground_row_done(Ground *g);
static int ground_rows_end(Ground *g);
// Up to `budget` pixel rows of the ground: 1 while rows remain, 0 when the
// ground is done, -1 if the map fails.
static int ground_step(Ground *g,Tiles *t,int budget){
  const Cam *cam=g->cam;
  if(g->land_rows==0){
    if(!tiles_columns(t,cam))return -1;
    for(int x=0;x<W;x++){g->col[0][x]=place_lon(t,glon(cam,x+.25));g->col[1][x]=place_lon(t,glon(cam,x+.5));g->col[2][x]=place_lon(t,glon(cam,x+.75));}
  }
  for(;budget>0&&g->land_rows<H;budget--){
    const int y=g->land_rows;
    // Land at four points in the pixel, as groundLayer sampled it; height
    // at its centre. Space (off the world band) has no land; its height,
    // sampled all the same, is smoothed into the band's edge.
    const bool band=y>=cam->top&&y<=cam->bottom;
    const Place ra=place_lat(t,glat(cam,y+.25)),rm=place_lat(t,glat(cam,y+.5)),rb=place_lat(t,glat(cam,y+.75));
    // The cell rows under this pixel row, in order down the map.
    const uint8_t *ra0=map_row(t,ra.i),*ra1=map_row(t,ra.i+1),*rm0=map_row(t,rm.i),*rm1=map_row(t,rm.i+1),*rb0=map_row(t,rb.i),*rb1=map_row(t,rb.i+1);
    const int16_t *heights=t->pack.height;
    int32_t *e0=g->row;uint8_t *land=g->land[y%LAND_RING];memset(land,0,W/8+1);memset(g->space[y%LAND_RING],0,W/8+1);
    for(int x=0;x<W;x++){
      if(band){
        const int32_t c=land_at(ra0,ra1,g->col[0][x],ra.f)+land_at(ra0,ra1,g->col[2][x],ra.f)+land_at(rb0,rb1,g->col[0][x],rb.f)+land_at(rb0,rb1,g->col[2][x],rb.f);
        if(c>=512)land[x>>3]|=(uint8_t)(1<<(x&7));
      }
      e0[x]=height_at(heights,rm0,rm1,g->col[1][x],rm.f);
    }
    if(t->failed)return -1;
    row_distances(g,y);
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
// The drawing's plane: each pixel's drawn layer alone, a nibble (0 where
// nothing is drawn: the ground's own class stands), in four bands of rows,
// each its own allocation, so that it can be let go of a band at a time.
// The ground stays in its row runs (the sink), read where the drawing
// asks what lies under a pixel, and merged with the plane at the end.
#define PLANE_BANDS 4
#define BAND_ROWS (H/PLANE_BANDS)
#define BAND_BYTES ((W/2)*BAND_ROWS)
typedef struct {uint8_t *band[PLANE_BANDS];} Plane;
static int layer_at(const Plane *p,int x,int y){return (p->band[y/BAND_ROWS][(y%BAND_ROWS)*(W/2)+(x>>1)]>>((x&1)*4))&15;}
static void layer_set(const Plane *p,int x,int y,int layer){
  uint8_t *q=&p->band[y/BAND_ROWS][(y%BAND_ROWS)*(W/2)+(x>>1)];
  *q=(x&1)?(uint8_t)((*q&0x0F)|layer<<4):(uint8_t)((*q&0xF0)|layer);
}
// A byte of the ground's runs: the sink's arena, then its chunks (each
// filled whole, in order).
static uint8_t sink_byte(const RunSink *k,unsigned p){
  if(p<k->cap)return k->arena[p];
  p-=k->cap+k->dropped*RUN_CHUNK;const RunChunk *c=k->head;for(;p>=RUN_CHUNK;p-=RUN_CHUNK)c=c->next;
  return c->data[p];
}
// The chunks wholly before byte `upto` let go.
static void sink_drop(RunSink *k,unsigned upto,void (*release)(void *)){
  while(k->head&&upto>=k->cap+(k->dropped+1)*RUN_CHUNK){RunChunk *c=k->head;k->head=c->next;if(!k->head)k->tail=NULL;release(c);k->dropped++;}
}
// A row of the ground's classes; rows above `panel` (the world band's tape
// panel, once it is cleared) are space.
static void ground_row(const RunSink *k,int panel,int y,uint8_t *row){
  if(y<panel){memset(row,G_SPACE,W);return;}
  int x=0;
  for(unsigned p=k->row_offset[y];p+1<k->row_offset[y+1]&&x<W;){
    int n=sink_byte(k,p);
    if(n>ENR_RUN_MAX){n-=ENR_RUN_MAX;for(int i=1;i<=n&&x+1<W;i++){const uint8_t c=sink_byte(k,p+i);row[x++]=c&15;row[x++]=c>>4;}p+=n+1;}
    else{if(n>W-x)n=W-x;memset(row+x,sink_byte(k,p+1),n);x+=n;p+=2;}
  }
}
// wrap: the plane is the world round (the sliding band): columns wrap.
// (top, bottom: the rows the route is drawn in, the world band's own.)
typedef struct {const Plane *c;bool early;int stage;bool wrap;const RunSink *ground;int panel;int top,bottom;} Canvas;
// The ground's class under a pixel (its low nibble the ground).
static int ground_at(const Canvas *cv,int x,int y){
  if(y<cv->panel)return G_SPACE;
  const RunSink *k=cv->ground;int at=0;
  for(unsigned p=k->row_offset[y];p+1<k->row_offset[y+1];){
    const int n=sink_byte(k,p);
    if(n>ENR_RUN_MAX){const int m=n-ENR_RUN_MAX;if(x<at+2*m){const uint8_t c=sink_byte(k,p+1+((x-at)>>1));return (x-at)&1?c>>4:c&15;}at+=2*m;p+=m+1;}
    else{at+=n;if(x<at)return sink_byte(k,p+1)&15;p+=2;}
  }
  return G_SPACE;
}
static int wrap_x(const Canvas *cv,int x){return FACE_WORLD&&cv->wrap?((x%W)+W)%W:x;}
static void plot(Canvas *cv,double fx,double fy,int layer){
  const int x=wrap_x(cv,(int)js_round(fx)),y=(int)js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  if(layer==L_INK&&cv->early)layer=L_EARLY_INK;
  if(layer==L_GRID&&cv->stage>=1)layer=L_NET_GRID;
  if(cv->stage==3&&(layer==L_INK||layer==L_MARK||layer==L_SPACE_INK))layer=L_LATE_INK;
  layer_set(cv->c,x,y,layer);
}
static void clear(Canvas *cv,double fx,double fy){
  const int x=wrap_x(cv,(int)js_round(fx)),y=(int)js_round(fy);
  if(x<0||y<0||x>=W||y>=H)return;
  layer_set(cv->c,x,y,cv->early?L_EARLY_CLEARED:cv->stage==3?L_LATE_CLEARED:L_CLEARED);
}
typedef EnrPx Px;
typedef struct {int x,y,w,h;} Box;
// letter(): a halo of knockout round every pixel, then the ink; over space
// the ink is the space ink.
static void letter(Canvas *cv,const Px *px,int n,int layer,int halo){
  for(int i=0;i<n;i++)for(int dy=-halo;dy<=halo;dy++)for(int dx=-halo;dx<=halo;dx++)clear(cv,px[i].x+dx,px[i].y+dy);
  for(int i=0;i<n;i++){
    const int wx=wrap_x(cv,px[i].x),cx=wx<0?0:wx>W-1?W-1:wx,cy=px[i].y<0?0:px[i].y>H-1?H-1:px[i].y;
    plot(cv,px[i].x,px[i].y,ground_at(cv,cx,cy)==G_SPACE?L_SPACE_INK:layer);
  }
}
// The lettering is the renderer's (at most 512 pixels a text: SCRATCH).
static int text_width(const char *t){return enr_text_width(t,(int)strlen(t));}
static int text_pixels(const char *t,int x,int baseline,Px *out){return enr_text_pixels(t,(int)strlen(t),x,baseline,out);}
// segment(): Bresenham between rounded ends.
typedef void (*PixelFn)(Canvas *cv,int x,int y,void *arg);
static void segment(Canvas *cv,double ax,double ay,double bx,double by,PixelFn fn,void *arg){
  int x=(int)js_round(ax),y=(int)js_round(ay);const int xx=(int)js_round(bx),yy=(int)js_round(by);
  const int dx=abs(xx-x),sx_=x<xx?1:-1,dy=-abs(yy-y),sy_=y<yy?1:-1;int err=dx+dy;
  for(int n=0;n<4000;n++){fn(cv,x,y,arg);if(x==xx&&y==yy)break;const int e=2*err;if(e>=dy){err+=dy;x+=sx_;}if(e<=dx){err+=dx;y+=sy_;}}
}
static void casing_pixel(Canvas *cv,int x,int y,void *arg){if(y<cv->top||y>cv->bottom)return;const int c=*(bool *)arg?2:1;for(int dy=-c-1;dy<=c+1;dy++)for(int dx=-c;dx<=c;dx++)clear(cv,x+dx,y+dy);}
// arg: 1 within the hour, 2 heavy, 4 steep.
static void route_pixel(Canvas *cv,int x,int y,void *arg){
  const uint8_t how=*(uint8_t *)arg;
  // (A polar orbit runs off a band that could not be made taller: its route
  // stops at the band's edge, clear of the date and the line below.)
  if(y<cv->top||y>cv->bottom)return;
  if(!(how&1)){if(((x+y)>>1)%2==0)plot(cv,x,y,L_ROUTE);return;}
  plot(cv,x,y,L_ROUTE);
  if(how&2)plot(cv,how&4?x+1:x,how&4?y:y-1,L_ROUTE);
}
// The figures: Jost digits, bottom-aligned on a shared baseline.
// The build's figure set (its table read from figures.bin by chart_begin).
static const FigureGlyph *s_glyphs;
static const FigureGlyph *figure(int size,char c){for(int s=0;s<5;s++)if(FIGURE_SIZES[s]==size)return &s_glyphs[s*10+(c-'0')];return 0;}
static int gap_for(int size){return (int)js_round(size/16.0);}
static int run_width(const char *t,int size){int w=0,n=0;for(;*t;t++,n++)w+=figure(size,*t)->width;return w+gap_for(size)*(n-1);}
// A run of figures laid out as figurePixels() does: glyph i at (x[i], y[i]).
typedef struct {const FigureGlyph *g[3];int x[3],y[3],n,x0,y0,x1,y1;const uint8_t *bits[3];} FigureRun;
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
    if(r->bits[i][gy*((g->width+7)/8)+(gx>>3)]&(128>>(gx&7)))return true;
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
    plot(cv,x,y,ground_at(cv,cx,cy)==G_SPACE?L_SPACE_INK:layer);
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

// The symbols keep every pixel as row bits, without strings or pointers.
typedef struct {uint8_t width,height;uint16_t row[11];} Symbol;
static const Symbol HEXAGON={7,5,{0x01c,0x022,0x041,0x022,0x01c}};
static const Symbol TRIANGLE={9,7,{0x010,0x028,0x028,0x044,0x044,0x082,0x1ff}};
static const Symbol AIRPORT={11,11,{0x020,0x020,0x070,0x088,0x104,0x707,0x104,0x088,0x070,0x020,0x020}};
static void symbol(Canvas *cv,const Symbol *shape,int cx,int cy){
  const int len=shape->width,count=shape->height;
  for(int dy=0;dy<count;dy++){
    const uint16_t row=shape->row[dy];
    int first=-1,last=-1;for(int k=0;k<len;k++)if(row>>k&1){if(first<0)first=k;last=k;}
    for(int dx=0;dx<len;dx++){
      const int x=cx-(len>>1)+dx,y=cy-(count>>1)+dy;
      if(row>>dx&1)plot(cv,x,y,L_INK);
      else if(first<dx&&dx<last)clear(cv,x,y);
    }
  }
}

// The widest the margins' corner is: its centre-placed Zulu time keeps clear.
#define CORNER_WIDEST "00N 000E"
static const char WEEKDAYS[7][4]={"SUN","MON","TUE","WED","THU","FRI","SAT"};
static const char MONTHS[12][4]={"JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"};
// Integer to decimal, zero-padded to `width`.
static char *put_int(char *p,int v,int width){char d[12];int n=0;do{d[n++]=(char)('0'+v%10);v/=10;}while(v);while(n<width)d[n++]='0';while(n)*p++=d[--n];*p=0;return p;}

#define SCRATCH 512
// The drawing's pixel lists and placements.
// Groundtrack Fuller's is smaller: fewer placements, and its stations'
// bearings worked out as they are drawn.
#define TAKEN (FACE_CHART?64:32)
#define BEARINGS (FACE_CHART?72:1)
typedef struct {Px scratch[SCRATCH];Box taken[TAKEN];Px home_code[64];double sb[BEARINGS],cb[BEARINGS];uint8_t ring[2*120];Box labels[10];} Draw;
// The drawing's lists: the track on the screen, the pixel lists and
// placements, and room for the hour figures' digits, only those drawn
// (FIGURE_ROOM, chart_data.h).
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
  for(int k=0;k<5;k++)p->tint_q[k]=isfinite(p->tint_limits[k])?(int32_t)(p->tint_limits[k]*256):INT32_MAX;
  for(int k=0;k<2;k++)p->depth_q[k]=isfinite(p->depth_limits[k])?(int32_t)(p->depth_limits[k]*256):INT32_MIN;
  return true;
}
// The figures of one size that two runs of digits use, each digit's bits
// loaded once into `room` (the build's arena, past what it holds), of
// `space` bytes: at[d] is digit d's place there.
typedef struct {const uint8_t *room;uint16_t at[10];} Figures;
static bool load_figures(const ChartSources *src,int size,const char *a,const char *b,Figures *f,uint8_t *room,size_t space){
  int s=0;while(s<5&&FIGURE_SIZES[s]!=size)s++;
  if(s==5)return false;
  f->room=room;for(int d=0;d<10;d++)f->at[d]=0xFFFF;
  size_t used=0;
  for(int k=0;k<2;k++)for(const char *t=k?b:a;*t;t++){
    const int d=*t-'0';if(d<0||d>9||f->at[d]!=0xFFFF)continue;
    const FigureGlyph *g=&s_glyphs[s*10+d];const size_t n=(size_t)g->height*((g->width+7)/8);
    if(used+n>space||src->figures(src->figure_source,g->first,room+used,n)!=n)return false;
    f->at[d]=(uint16_t)used;used+=n;
  }
  return true;
}
// A run's glyphs pointed at their loaded bits.
static void figure_bind(FigureRun *r,const Figures *f,int size){
  int s=0;while(s<5&&FIGURE_SIZES[s]!=size)s++;
  for(int i=0;i<r->n;i++)r->bits[i]=f->room+f->at[r->g[i]-&s_glyphs[s*10]];
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
  // Zoomed in: the coastline's rows (land.pack), and the night's grid of
  // directions.
  MapReadFn land;void *land_source;int16_t land_row[LAND_SLOTS];uint32_t land_used[LAND_SLOTS];uint8_t land_bits[LAND_SLOTS][180];
  float meters[256];                            // relief codes to metres (from tables.bin)
} GridCache;
static const GridRow *grid_row(GridCache *c,int face,int a){
  c->tick++;int slot=0;
  for(int i=0;i<GRID_SLOTS;i++){if(c->rows[i].face==face&&c->rows[i].a==a){c->rows[i].used=c->tick;return &c->rows[i];}if(c->rows[i].used<c->rows[slot].used)slot=i;}
  GridRow *r=&c->rows[slot];const uint32_t n=(uint32_t)(GRID_N+1-a),at=(uint32_t)(FULLER_HEADER+GRID_POINTS*6+face*GRID_POINTS+GRID_INDEX(a,0));
  if(c->read(c->source,at,r->cover,n)!=n||c->read(c->source,at+20*GRID_POINTS,r->code,n)!=n)return NULL;
  r->face=(int16_t)face;r->a=(int16_t)a;r->used=c->tick;return r;
}
// A row of the coastline's bits (180 bytes, LSB first) from land.pack
// (tools/land-pack.mjs): alternately sea and land runs, sea first, each a
// varint, the last running to the row's end.
static bool land_row(GridCache *c,int y,uint8_t *out){
  uint8_t o[8];if(c->land(c->land_source,8+4*(uint32_t)y,o,8)!=8)return false;
  const uint32_t data=8+4*721,from=(uint32_t)o[0]|o[1]<<8|(uint32_t)o[2]<<16|(uint32_t)o[3]<<24,to=(uint32_t)o[4]|o[5]<<8|(uint32_t)o[6]<<16|(uint32_t)o[7]<<24;
  memset(out,0,180);
  uint8_t buf[32];uint32_t at=from,have=0,used=0;int x=0,land=0;
  while(at<to||used<have){
    uint32_t v=0;int s=0,b;
    do{
      if(used==have){have=to-at<sizeof buf?to-at:sizeof buf;if(!have||c->land(c->land_source,data+at,buf,have)!=have)return false;at+=have;used=0;}
      b=buf[used++];v|=(uint32_t)(b&127)<<s;s+=7;
    }while(b&128);
    if(land)for(int k=x;k<x+(int)v&&k<1440;k++)out[k>>3]|=(uint8_t)(1<<(k&7));
    x+=(int)v;land^=1;
  }
  if(land)for(int k=x;k<1440;k++)out[k>>3]|=(uint8_t)(1<<(k&7));
  return true;
}
static int land_bit(GridCache *c,int x,int y){
  x=((x%1440)+1440)%1440;y=y<0?0:y>719?719:y;
  c->tick++;int slot=0;
  for(int i=0;i<LAND_SLOTS;i++){if(c->land_row[i]==y){c->land_used[i]=c->tick;return (c->land_bits[i][x>>3]>>(x&7))&1;}if(c->land_used[i]<c->land_used[slot])slot=i;}
  if(!land_row(c,y,c->land_bits[slot]))return -1;
  c->land_row[slot]=(int16_t)y;c->land_used[slot]=c->tick;return (c->land_bits[slot][x>>3]>>(x&7))&1;
}
// gridCell(): the three grid points round a fixed-point place, as (a, b)
// and weights out of 256.
typedef struct {int a[3],b[3],w[3];} GridCell;
static int64_t floor_div256(int64_t v){return v>=0?v/256:-((-v+255)/256);}
// (on a grid of every `step`th point: the night's.)
static void grid_cell_on(const int32_t *q,int64_t qx,int64_t qy,GridCell *c,int step){
  int64_t a=floor_div256(q[0]+q[1]*qx+q[2]*qy),b=floor_div256(q[3]+q[4]*qx+q[5]*qy);
  a=a<0?0:a>GRID_N*256?GRID_N*256:a;b=b<0?0:b>GRID_N*256-a?GRID_N*256-a:b;
  a/=step;b/=step;
  const int ia=(int)(a/256),ib=(int)(b/256),fa=(int)(a-ia*256),fb=(int)(b-ib*256);
  if(ia+ib>=GRID_N/step){*c=(GridCell){{ia,0,0},{ib,0,0},{256,0,0}};return;}
  if(fa+fb<=256){*c=(GridCell){{ia,ia+1,ia},{ib,ib,ib+1},{256-fa-fb,fa,fb}};return;}
  *c=(GridCell){{ia+1,ia,ia+1},{ib+1,ib+1,ib},{fa+fb-256,256-fa,256-fb}};
}
static void grid_cell(const int32_t *q,int64_t qx,int64_t qy,GridCell *c){grid_cell_on(q,qx,qy,c,1);}

// ---------------------------------------------------------------- the hour
// A build in progress: the track and camera, then the ground a slice of
// rows at a time, then the drawing and the scene.
// What the drawing notes for the scene, kept past its lists, in the build
// itself (the stack is small): the lettering the callout's leader breaks
// for, home's mark, the stations shown and the events.
typedef struct {int16_t x,y,lx,box[4];uint8_t clear;char name[5];} EventNote;
// (figs: the hour figures' boxes, kept here off finish_draw's stack.)
typedef struct {Box avoid[24];uint16_t marks[128];int16_t shown[32][2];uint8_t shown_table[32];EventNote events[16];Box figs[2];} Notes;
struct ChartBuild {
  ChartInput in;ChartSources src;
  TrackPoint *track;int count,h0,h1,t0,step;Cam cam;Plate plate;
  Plane plane;Tiles *tiles;Ground *ground;RunSink sink;
  FigureGlyph glyphs[50];    // the figure set's table
  // The drawing's lists, and the scene's runs as they are made: a piece a
  // band of the plane, and their row offsets.
  uint8_t *lists;Notes notes;
  char source[24];           // the band's source line, lettered by the renderer when the world slides
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
  uint32_t heard;int tile_row;unsigned tile_piece,tile_used;
  // How many times a shaded plate's ground has been begun again, lighter.
  uint8_t shade;
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
static int track_step(const ChartInput *in){return in->view>=2?300:in->view?15:60;}
static int64_t track_from(const ChartInput *in){return in->view>=2?in->day_start:in->start-(in->view?1200:2400);}
static int64_t track_to(const ChartInput *in){return in->view>=2?in->day_end:in->start+3600+(in->view?1200:2400);}
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
  if(FACE_CHART&&b->tiles&&b->tiles->pack.tables)map_pack_close(&b->tiles->pack,src->release);
  src->release(b->tiles);b->tiles=NULL;src->release(b->ground);b->ground=NULL;
}
static void plane_free(ChartBuild *b){
  for(int k=0;k<PLANE_BANDS;k++){b->src.release(b->plane.band[k]);b->plane.band[k]=NULL;}
  b->src.release(b->lists);b->lists=NULL;
}
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
// The night's grid (enroute_core.h): every other point of the faces' grid
// each way, a row of the grid read at a time through `scratch` (6*(GRID_N+1)
// bytes). Allocated; NULL without memory or on a short read.
#define NIGHT_INDEX(a,b) ((a)*(ENR_NIGHT_N+1)-(a)*((a)-1)/2+(b))
static int16_t *night_dirs(const ChartSources *src,uint8_t *scratch){
  const int step=GRID_N/ENR_NIGHT_N;
  int16_t *dirs=src->alloc(sizeof(int16_t)*3*ENR_NIGHT_POINTS),*to=dirs;if(!dirs)return NULL;
  for(int a=0;a<=GRID_N;a+=step){
    const size_t n=6*(size_t)(GRID_N+1-a);
    if(src->grids(src->grid_source,FULLER_HEADER+6*GRID_INDEX(a,0),scratch,n)!=n){src->release(dirs);return NULL;}
    for(int c=0;c<=GRID_N-a;c+=step)for(int k=0;k<3;k++)*to++=(int16_t)(scratch[6*c+2*k]|scratch[6*c+2*k+1]<<8);
  }
  return dirs;
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
  const int count=(int)q64(to-from,step)+1;
  if(count<2||count>FULLER_TRACK_MAX||r64(in->start-from,step)||r64(in->start+3600-from,step))return false;
  const int i0=(int)q64(in->start-from,step),i1=(int)q64(in->start+3600-from,step);if(i1>=count)return false;
  // The track on the screen waits at the end of the runs' arena, where the
  // drawing finds it.
  b->fg=alloc(sizeof(FullerConst));b->fc=alloc(sizeof(FullerCam));
  double (*dirs)[3]=alloc(sizeof(double)*3*count);FullerCell *cells=alloc(FULLER_SCRATCH);double *xs=alloc(sizeof(double)*2*count),*ys=xs?xs+count:NULL;
  bool rolled=b->fg&&b->fc&&dirs&&cells&&xs&&src->grids&&fuller_const_read(src->grids,src->grid_source,b->fg,(uint8_t *)cells);
  _Static_assert(FULLER_SCRATCH>=FULLER_HEADER,"the roll's scratch holds the grids' header");
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
    // Zoomed in, each pixel's place on the Earth comes from the night's
    // grid of directions (its 2-degree cells place a pixel within 0.01
    // degrees); the scene keeps it for the night.
    if(!(b->dirs=night_dirs(src,(uint8_t *)b->ground)))return false;
  }
  if(src->tables(src->table_source,TABLE_METERS_AT,(uint8_t *)b->gc->meters,1024)!=1024)return false;
  ground_begin(b->ground,&b->cam,&b->plate,&b->sink);

  return true;
}
// A grid direction at a quarter-pixel place on a tile, in the face's frame.
static void grid_direction(const ChartBuild *b,int t,int64_t qx,int64_t qy,int32_t out[3]){
  GridCell c;grid_cell_on(b->tgrid[t],qx,qy,&c,GRID_N/ENR_NIGHT_N);
  for(int k=0;k<3;k++){
    int32_t s=0;for(int j=0;j<3;j++)s+=b->dirs[NIGHT_INDEX(c.a[j],c.b[j])*3+k]*c.w[j];
    out[k]=s>>8;
  }
}
// fuller-ground.js coverage().
static double land_coverage(GridCache *gc,double lat,double lon,bool *ok){
  const double u=(wrap(lon)+180)*4-.5,v=(90-lat)*4-.5,i=f_floor(u),j=f_floor(v),fu=u-i,fv=v-j;
  const int b00=land_bit(gc,(int)i,(int)j),b10=land_bit(gc,(int)i+1,(int)j),b01=land_bit(gc,(int)i,(int)j+1),b11=land_bit(gc,(int)i+1,(int)j+1);
  if(b00<0||b10<0||b01<0||b11<0)*ok=false;
  return ((double)b00*(1-fu)+(double)b10*fu)*(1-fv)+((double)b01*(1-fu)+(double)b11*fu)*fv;
}
// Up to `budget` rows of a Fuller sheet's ground (as ground_step).
static int fuller_ground_step(ChartBuild *b,int budget){
  Ground *g=b->ground;GridCache *gc=b->gc;const FullerCam *fc=b->fc;const float *meters=gc->meters;
  static const int SUB[4][2]={{1,1},{3,1},{1,3},{3,3}};
  for(;budget>0&&g->land_rows<H;budget--){
    const int y=g->land_rows;
    int32_t *e0=g->row;uint8_t *land=g->land[y%LAND_RING],*space=g->space[y%LAND_RING];memset(land,0,W/8+1);memset(space,0,W/8+1);
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
      e0[x]=(int32_t)relief;
      bool is_land;
      if(b->fine){
        // The coastline at four points in the pixel.
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
    row_distances(g,y);if(!ground_row_done(g))return -1;
  }
  return ground_rows_end(g);
}
// The world band's instrument tape (SCALE in enroute-render.js).
#define TAPE_X0 10
#define TAPE_X1 190
#define TAPE_BASELINE 46
#define TAPE_PANEL 67
ChartBuild *chart_begin(const ChartInput *in_,const ChartSources *src_){
  ChartBuild *b=src_->alloc(sizeof(ChartBuild));if(!b)return NULL;
  memset(b,0,sizeof *b);b->in=*in_;b->src=*src_;
  const unsigned arena=RUN_ARENA;
  b->sink.arena=src_->alloc(arena);if(!b->sink.arena){src_->release(b);return NULL;}
  b->sink.cap=arena;
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;
  void *(*const alloc)(size_t)=src->alloc;void (*const release)(void *)=src->release;
  if(in->plate<0||in->plate>=TABLE_PLATES||!read_plate(src,in->plate,&b->plate))FAIL;
  // The figure set's table, Jost's for an unknown set.
  {const int set=in->figures>=0&&in->figures<FIGURE_SETS?in->figures:0;uint8_t t[6*10];
  // (Ten at a time: the stack is small.)
  for(int k=0;k<50;k++){
    if(k%10==0&&src->figures(src->figure_source,FIGURE_TABLE_AT(set)+6*k,t,sizeof t)!=sizeof t)FAIL;
    const uint8_t *e=t+6*(k%10);b->glyphs[k]=(FigureGlyph){e[0],e[1],(uint32_t)e[2]|(uint32_t)e[3]<<8|(uint32_t)e[4]<<16|(uint32_t)e[5]<<24};
  }
  s_glyphs=b->glyphs;}
  const Plate *pal=&b->plate;
  if(FACE_ROLL&&(!FACE_CHART||in->fuller)){if(!fuller_begin(b))FAIL;return b;}
  // chartCamera(). The track is kept only while the camera is set, and made
  // again for the drawing: the ground needs the memory.
  again:;
  TrackPoint *const track=b->track=alloc(sizeof(TrackPoint)*(size_t)(q64(track_to(in)-track_from(in),track_step(in))+1));if(!track)FAIL;
  const int count=make_track(in,src,track);if(count<0||count>401)FAIL;
  b->step=track_step(in);b->t0=(int)(track_from(in)-in->start);
  double maxlat=-INFINITY,minlat=INFINITY,maxlon=-INFINITY,minlon=INFINITY;int h0=-1,h1=-1;
  // (The hour's reach; on the world band's whole day, the day's.)
  for(int i=0;i<count;i++)if(HOUR_OF(b,i)||in->view==3){
    if(HOUR_OF(b,i)){if(h0<0)h0=i;h1=i;}
    if(track[i].a>maxlat)maxlat=track[i].a;
    if(track[i].a<minlat)minlat=track[i].a;
    if(track[i].b>maxlon)maxlon=track[i].b;
    if(track[i].b<minlon)minlon=track[i].b;
  }
  // A satellite on the hour chart that this hour runs further than the
  // chart can hold (an oval orbit at its low, fast end; one in a low orbit
  // sent here by mistake) has the hour on the world band instead. (What it
  // can hold is the heap's to say: a chart of 60 degrees takes 53 KB at the
  // most, one of 85 more than the watch has.)
  #define HOUR_HOLDS 50
  if(FACE_WORLD&&FACE_HOUR&&in->body>=2&&in->view==0&&(maxlon-minlon>HOUR_HOLDS||maxlat-minlat>HOUR_HOLDS)){release(track);b->track=NULL;b->in.view=1;goto again;}
  Cam cam;memset(&cam,0,sizeof cam);cam.top=0;cam.bottom=H;
  if(VIEW_IS_DAY(in->view)){
    // The whole local day, north up, its shape fitted and set to the right.
    const double alo=minlat,ahi=maxlat,blo=minlon,bhi=maxlon;
    cam.day=cam.wide=true;cam.lat0=(ahi+alo)/2;cam.k=f_cos(cam.lat0*RAD);cam.lonMid=(bhi+blo)/2;
    // (A shape that hardly moves, a satellite standing still, is not drawn
    // larger than twelve degrees to the chart: there is no map so near.)
    {const double w=(bhi-blo)*cam.k,sa=(W*.5)/(w>12?w:12),h=ahi-alo,sb=(H-70)/(h>12?h:12);cam.scale=sa<sb?sa:sb;}
    cam.y0=(14+H-16)/2;cam.x0=W-16-(bhi-blo)*cam.k*cam.scale/2;
    h0=0;h1=count-1;
  }
  else if(VIEW_IS_WORLD(in->view)){
    // The whole world in a band, fitted to the hour's longitudes, in true
    // proportion.
    cam.world=true;cam.scale=(W-16)/(maxlon-minlon>180?maxlon-minlon:180);cam.k=1;cam.y0=H-10;
    cam.lonMid=(maxlon+minlon)/2;cam.x0=W/2;
    // With the world sliding under the tape, the band is the whole world
    // round, W columns to 360 degrees: the minute renderer turns it under
    // the index (enr_render), so the hour is built once.
    if(in->tape==2)cam.scale=W/360.0;
    // Where the world is drawn small enough for it, the band reaches
    // further north and south, to 84 degrees: the polar orbits turn there,
    // and would else run off it through the date above and the line below.
    // (The band leaves room under the panel for its date and, over that,
    // the strip of the transfer's marks: at most 126 rows of it.)
    {const double most=(H-10-(TAPE_PANEL+25))/(double)(WORLD_NORTH-WORLD_SOUTH);if(cam.scale>most)cam.scale=most;}
    {const double room=(H-10-(TAPE_PANEL+25))/cam.scale-(WORLD_NORTH-WORLD_SOUTH),extra=room>36?36:room>0?room:0;
    cam.lat0=WORLD_SOUTH-extra*2/3;
    cam.top=(int)f_ceil(sy(&cam,WORLD_NORTH+extra/3));cam.bottom=(int)f_floor(sy(&cam,cam.lat0));}
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
    const double sx_=(b->b-a->b)*cam.k,sy_=-(b->a-a->a),l0=f_sqrt(sx_*sx_+sy_*sy_),len=l0?l0:1;
    // (Nor an hour's run larger than two degrees to the span.)
    cam.scale=CHART_SPAN/(len>2?len:2);
    double nx=sy_/len,ny=-sx_/len;
    if(ny>0){nx=-nx;ny=-ny;}
    if(fabs(ny)<.3&&nx>0){nx=-nx;ny=-ny;}
    cam.slow=true;cam.nx=nx;cam.ny=ny;
    cam.x0=W/2-nx*30;cam.y0=(14+H-16)/2+8-ny*30;
  }
  b->count=count;b->h0=h0;b->h1=h1;b->cam=cam;
  release(b->track);b->track=NULL;

  // The ground, with the map's tiles and the relief's rings, freed after.
  b->tiles=alloc(sizeof(Tiles));b->ground=alloc(sizeof(Ground));b->sink.alloc=alloc;
  // (Cleared before a failure frees it: the pack's tables are not yet there.)
  if(b->tiles)memset(b->tiles,0,sizeof *b->tiles);
  if(!b->tiles||!b->ground)FAIL;
  if(!map_pack_open(&b->tiles->pack,src->map,src->map_source,alloc))FAIL;
  tiles_choose(b->tiles,b->cam.scale);
  ground_begin(b->ground,&b->cam,pal,&b->sink);
  return b;
fail:
  chart_abort(b);
  return NULL;
}
// Whether a track on the screen goes anywhere: 12 pixels from its start.
// (A function of its own: finish_draw's frame is at its budget.)
static __attribute__((noinline)) bool track_reach(const TrackPoint *track,int count){
  for(int i=1;i<count;i++)if(fabs(track[i].a-track[0].a)+fabs(track[i].b-track[0].b)>=12)return true;
  return false;
}
// A Fuller sheet's scale bar (see finish_draw), in whole numbers but for its
// length: a function of its own, small.
static __attribute__((noinline)) void scale_bar(Canvas *cv,const FullerCam *fc,const Box *taken,int taken_n,const Box *figs,int nfigs,Px *scratch){
  static const uint16_t ROUND[7]={50,100,200,500,1000,2000,5000};
  const int per=(int)(fc->scale*(65536/7054.0));int km=0,len=0;
  for(int k=0;k<7&&len<36;k++){km=ROUND[k];len=km*per>>16;}
  char label[10];memcpy(put_int(label,km,1)," KM",4);
  const int lw=text_width(label),w=(len>lw?len:lw)+6;
  for(int y=H-22;y>=40;y-=6)for(int x=6;x+w<W;x+=6){
    const Box box={x-3,y-16,w,20};bool open=!overlaps(taken,taken_n,box)&&!overlaps(figs,nfigs,box);
    for(int dy=0;dy<=20&&open;dy+=10)for(int dx=0;dx<=w&&open;dx+=12)open=fuller_locate(fc,box.x+dx,box.y+dy,NULL)<0;
    if(!open)continue;
    // (Its pixels gathered, then plotted in one place: the code is small.)
    int n=text_pixels(label,x,y-6,scratch);
    for(int d=0;d<=len;d++){scratch[n++]=(Px){(int16_t)(x+d),(int16_t)y};if(d<5&&d){scratch[n++]=(Px){(int16_t)x,(int16_t)(y-d)};scratch[n++]=(Px){(int16_t)(x+len),(int16_t)(y-d)};}}
    for(int i=0;i<n;i++)plot(cv,scratch[i].x,scratch[i].y,L_SPACE_INK);
    return;
  }
}
static __attribute__((noinline)) bool finish_draw(ChartBuild *b);
static __attribute__((noinline)) bool finish_minutes(ChartBuild *b,int m0,int m1);
// Which tile each pixel of rows up to `to` lies on, found again (the ground
// had no room to keep it), as the scene's row runs. False without memory.
static bool fuller_tile_rows(ChartBuild *b,int to){
  EnrFuller *f=b->out->fuller;const FullerCam *fc=b->fc;
  for(;b->tile_row<to&&b->tile_row<H;b->tile_row++){
    const int y=b->tile_row;int run=-2,n=0;uint8_t r[2*W];
    for(int x=0;x<W;x++){
      const int t=fuller_locate(fc,x+.5,y+.5,NULL);
      if(t!=run||r[n-2]==255){r[n]=0;r[n+1]=(uint8_t)(t+1);n+=2;run=t;}
      r[n-2]++;
    }
    // A row's runs lie in one piece (as the class plane's).
    if(!f->tile_piece[b->tile_piece]||b->tile_used+(unsigned)n>ENR_RUN_PIECE){
      if(f->tile_piece[b->tile_piece]){b->tile_piece++;b->tile_used=0;}
      if(b->tile_piece==ENR_TILE_PIECES||!(f->tile_piece[b->tile_piece]=b->src.alloc(ENR_RUN_PIECE)))return false;
    }
    memcpy(f->tile_piece[b->tile_piece]+b->tile_used,r,(size_t)n);f->tile_offset[y]=(uint16_t)(b->tile_piece*ENR_RUN_PIECE+b->tile_used);b->tile_used+=(unsigned)n;
  }
  // The last piece is cut to what it holds, where the heap can do that.
  if(b->tile_row==H&&b->src.resize&&b->tile_used<ENR_RUN_PIECE){uint8_t *fit=b->src.resize(f->tile_piece[b->tile_piece],b->tile_used);if(fit)f->tile_piece[b->tile_piece]=fit;}
  return true;
}
// A shaded plate's dither over rugged ground makes short runs, to half as
// much again as any other plate's ground takes and more than the watch has
// room for: past the arena and three chunks (four on a Fuller sheet, none
// on a zoomed one, whose build holds more besides), or out of memory for
// them, the ground is begun again with the light's step half as long
// again, up to four times, and then left flat.
#define SHADE_RUNS(b) ((b)->sink.cap+(FACE_ROLL&&(!FACE_CHART||(b)->fc)?((b)->fine?0:4):3)*RUN_CHUNK)
#define SHADE_AGAIN 5
static void ground_again(ChartBuild *b){
  for(RunChunk *c=b->sink.head;c;){RunChunk *next=c->next;b->src.release(c);c=next;}
  b->sink.head=b->sink.tail=NULL;b->sink.n=0;b->sink.dropped=0;b->sink.failed=false;
  if(FACE_CHART&&b->tiles){tiles_choose(b->tiles,b->cam.scale);b->tiles->failed=false;}
  ground_begin(b->ground,&b->cam,&b->plate,&b->sink);
  if(++b->shade==SHADE_AGAIN)b->ground->shade_step=0;else for(int k=0;k<b->shade;k++)b->ground->shade_step+=b->ground->shade_step/2;
}
// A Fuller sheet's rows cost more than the map's.
#define FULLER_STEP_ROWS 3
#define TILE_STEP_ROWS 12
// The ground a slice of rows at a time, then the drawing, then the minutes
// a few at a time.
#define CHART_STEP_MINUTES 6
// (Each stage a function of its own, not folded into chart_step: the
// watch's stack is 2 KB, and one stage's frame must not lie under another's.)
static __attribute__((noinline)) int ground_slice(ChartBuild *b){
    const int r=FACE_ROLL&&(!FACE_CHART||b->fc)?fuller_ground_step(b,b->fine?1:FULLER_STEP_ROWS):ground_step(b->ground,b->tiles,CHART_STEP_ROWS);
    if((b->plate.flags&PLATE_SHADE)&&b->shade<SHADE_AGAIN&&(b->sink.failed||b->sink.n>SHADE_RUNS(b))){ground_again(b);return 1;}
    if(r<=0){
      ground_free(b);
      if(b->gc){
        // (The night's grid, if the ground read it, goes to the scene.)
        b->src.release(b->gc);b->gc=NULL;b->src.release(b->tgrid);b->tgrid=NULL;
      }
    }
    return r<0?-1:1;
}
int chart_step(ChartBuild *b){
  if(b->ground)return ground_slice(b);
  if(!b->out)return finish_draw(b)?1:-1;
  if(FACE_ROLL&&b->out->fuller&&b->tile_row<H)return fuller_tile_rows(b,b->tile_row+TILE_STEP_ROWS)?1:-1;
  if(b->minute<60){
    const int to=b->minute+CHART_STEP_MINUTES<60?b->minute+CHART_STEP_MINUTES:60;
    if(!finish_minutes(b,b->minute,to))return -1;
    b->minute=to;
  }
  return b->minute<60?1:0;
}

// The drawing and the scene, but for its minutes. False on failure (the
// build then aborted by the caller).
static bool finish_draw(ChartBuild *b){
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;
  const Plate *pal=&b->plate;
  void *(*const alloc)(size_t)=src->alloc;void (*const release)(void *)=src->release;
  const int count=b->count,h0=b->h0,h1=b->h1;const Cam *const cam=&b->cam;const bool world=FACE_WORLD&&(!FACE_HOUR||cam->world);
  const int top=cam->top,bottom=cam->bottom;
  Draw *draw=NULL;Px *scratch=NULL;EnrScene *out=NULL;EnrPoint *points=NULL;int16_t zulu_x=0,zulu_baseline=0;uint8_t counter=0;
  int16_t tape_lo=0,tape_hi=0;
  // The drawing's lists, and the plane, nothing drawn. (The lists first:
  // the larger block, into the stretch the ground has left; the plane's
  // bands go where there is room.)
  const size_t track_bytes=(sizeof(TrackPoint)*(size_t)count+7)&~(size_t)7,ARENA=track_bytes+sizeof(Draw)+FIGURE_ROOM;
  if(!(b->lists=alloc(ARENA)))FAIL;
  Notes *const notes=&b->notes;
  for(int k=0;k<PLANE_BANDS;k++){if(!(b->plane.band[k]=alloc(BAND_BYTES)))FAIL;memset(b->plane.band[k],0,BAND_BYTES);}
  const Plane *const classes=&b->plane;
  // The track again, on the screen.
  TrackPoint *const track=(TrackPoint *)b->lists;
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
  for(int i=0;i<count;i++){const double lat=track[i].a,lon=track[i].b;track[i].a=sx(cam,lon);track[i].b=sy(cam,lat);}
  }
  draw=(Draw *)(b->lists+track_bytes);
  // Past the drawing's lists, room for the figures' bitmaps.
  uint8_t *const room=(uint8_t *)(draw+1);const size_t room_size=ARENA-(size_t)(room-b->lists);
  scratch=draw->scratch;
  Canvas cv={classes,true,0,world&&in->tape==2,&b->sink,0,top,bottom};
  uint8_t *const ring=draw->ring;

  // Graticule: crosses every 5 degrees (30 on the world band), ticks every
  // degree (10) along the edges of the map.
  const bool day=FACE_HOUR&cam->day,daily=in->view>=2;
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
  {const double g0lat=glat(cam,bottom),g0lon=glon(cam,0),g1lat=glat(cam,top),g1lon=glon(cam,W);
  for(double lat=f_ceil(g0lat/step)*step;lat<=g1lat;lat+=step)for(double lon=f_ceil(g0lon/step)*step;lon<=g1lon;lon+=step){
    const double x=js_round(sx(cam,lon)),y=js_round(sy(cam,lat));if(!(y>=top&&y<=bottom))continue;
    for(int d=-2;d<=2;d++){plot(&cv,x+d,y,L_GRID);plot(&cv,x,y+d,L_GRID);}
  }
  for(double lon=f_ceil(g0lon/minor)*minor;lon<=g1lon;lon+=minor){
    const double x=js_round(sx(cam,lon));const int len=f_mod(lon,step)==0?4:2;
    for(int d=0;d<len;d++){plot(&cv,x,top+d,L_GRID);plot(&cv,x,bottom-d,L_GRID);}
  }
  for(double lat=f_ceil(g0lat/minor)*minor;lat<=g1lat;lat+=minor){
    const double y=js_round(sy(cam,lat));const int len=f_mod(lat,step)==0?4:2;if(!(y>=top&&y<=bottom))continue;
    for(int d=0;d<len;d++){plot(&cv,d,y,L_GRID);plot(&cv,W-1-d,y,L_GRID);}
  }}

  // Home, placed first so the network gives way; drawn last. (Its
  // acquisition circle on the world band is the minute's.)
  Box *const taken=draw->taken;int taken_n=0;
  // The lettering the day's callout breaks its leader for.
  Box *const avoid=notes->avoid;int avoid_n=0;
  #define AVOID(b) do{if(avoid_n<24)avoid[avoid_n++]=(b);}while(0)
  if(!world){taken[taken_n++]=(Box){0,H-16,W,16};if(in->home)taken[taken_n++]=(Box){0,0,W,14};}
  bool home_mark=false;int hx=0,hy=0;Box home_box={0,0,0,0};uint16_t *const marks=notes->marks;int mark_n=0;Px *const home_code=draw->home_code;int home_code_n=0;
  if(in->home){
    double qx,qy;project(cam,in->home_lat,in->home_lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
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
  int16_t (*const shown)[2]=notes->shown;uint8_t *const shown_table=notes->shown_table;int nshown=0;
  const bool ringed=world||(rolled&cam->wide);
  if(ringed&&FACE_CHART)bearings(5,draw->sb,draw->cb);
  for(unsigned s=0;s<(daily?0:TABLE_STATIONS);s++){
    // On a whole-orbit Fuller sheet, only the stations that hear the
    // satellite this hour.
    if(rolled&cam->wide&&!(b->heard>>s&1))continue;
    Station st;{uint8_t t[20];if(src->tables(src->table_source,TABLE_STATION_AT(s),t,20)!=20)FAIL;memcpy(st.code,t,4);st.code[3]=0;memcpy(&st.lat,t+4,8);memcpy(&st.lon,t+12,8);}
    double qx,qy;project(cam,st.lat,st.lon,&qx,&qy);const int x=(int)js_round(qx),y=(int)js_round(qy);
    if(x<4||x>W-5||y<top+6||y>bottom-6)continue;
    const int w=text_width(st.code);const bool right=x+5+w<W-3;const Box box={right?x-3:x-6-w,y-5,w+9,11};
    if(overlaps(taken,taken_n,box))continue;
    if(taken_n<TAKEN)taken[taken_n++]=box;
    if(nshown<32){shown[nshown][0]=(int16_t)x;shown[nshown][1]=(int16_t)y;shown_table[nshown]=(uint8_t)s;nshown++;}
    if(ringed){const int n=circle_pixels(cam,st.lat,st.lon,acquisition,5,FACE_CHART?draw->sb:NULL,FACE_CHART?draw->cb:NULL,ring);for(int i=0;i<n;i++)plot(&cv,ring[2*i],ring[2*i+1],L_GRID);}
    for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){const int r=dx*dx+dy*dy;if(r<=5&&r>=3)plot(&cv,x+dx,y+dy,L_INK);}
    plot(&cv,x,y,L_INK);
    const int n=text_pixels(st.code,right?x+5:x-5-w,y+4,scratch);AVOID(bounds_of(scratch,n));letter(&cv,scratch,n,L_INK,1);
  }
  // The route: cased in white on a one-ink plate; dashed outside the hour.
  // On a Fuller sheet a one-ink plate's route is heavier: two pixels ahead
  // of the body (the second the hour's), three behind.
  bool heavy=rolled&&(pal->flags&PLATE_MONO);
  // (Round the world, a step across the seam is drawn on round it.)
  #define JUMP(p,q) (fabs(track[q].a-track[p].a)>W/2)
  #define ON_ROUND(p,q) (cv.wrap&&JUMP(p,q)?track[q].a+(track[p].a>track[q].a?W:-W):track[q].a)
  if(pal->flags&PLATE_MONO)for(int i=1;i<count;i++){
    if((JUMP(i-1,i)&&!cv.wrap)||!(HOUR_OF(b,i-1)&&HOUR_OF(b,i)))continue;
    segment(&cv,track[i-1].a,track[i-1].b,ON_ROUND(i-1,i),track[i].b,casing_pixel,&heavy);
  }
  cv.early=false;cv.stage=2;
  for(int i=1;i<count;i++){
    if(JUMP(i-1,i)&&!cv.wrap)continue;
    const bool hour=HOUR_OF(b,i-1)&&HOUR_OF(b,i),steep=fabs(track[i].b-track[i-1].b)>fabs(track[i].a-track[i-1].a);
    uint8_t how=(uint8_t)((hour?1:0)|(heavy?2:0)|(steep?4:0));
    segment(&cv,track[i-1].a,track[i-1].b,ON_ROUND(i-1,i),track[i].b,route_pixel,&how);
  }
  #undef ON_ROUND
  // A whole day is graduated in hours instead: a tick every hour, longer
  // and numbered every three, longest at the two midnights. Where the day's
  // track crosses itself two hours meet, and the later label gives way.
  // (The local hour shown at the day's hour hr.)
  #define HOUR_SHOWN(hr) ({const int hh_=in->day_hours[(hr)<27?(hr):26];in->clock24?((hr)==24?24:hh_):(hh_%12?hh_%12:12);})
  // (A day's track that stays within a few pixels, a satellite standing
  // still, has no hours to mark.)
  if(daily&&track_reach(track,count)){
    Box *const labels=draw->labels;int nlabels=0;
    for(int i=0;i<count;i+=12){
      const TrackPoint *a=&track[i>0?i-1:0],*q=&track[i<count-1?i+1:count-1],*p=&track[i];
      const double l0=f_sqrt((q->a-a->a)*(q->a-a->a)+(q->b-a->b)*(q->b-a->b)),len=l0?l0:1;
      double nx=-(q->b-a->b)/len,ny=(q->a-a->a)/len;if(ny<0){nx=-nx;ny=-ny;}
      const int hr=i/12,size=hr%24==0?7:hr%3==0?5:3;
      for(int k=1;k<=size;k++)plot(&cv,p->a+nx*k,p->b+ny*k,L_ROUTE);
      if(hr%3==0&&!(world&&in->tape==4)){
        const int v=HOUR_SHOWN(hr);
        char label[4];put_int(label,v,1);const int lw=text_width(label);
        const int n=text_pixels(label,(int)js_round(p->a+nx*9-lw/2.0)+1,(int)js_round(p->b+ny*9+9),scratch);Box bx=bounds_of(scratch,n);
        // (Round the world, a label's place is its place on the band.)
        if(cv.wrap)bx.x=(int)f_mod(bx.x,W);
        bool clear_=true;for(int k=0;k<nlabels;k++){const Box *o=&labels[k];if(!(o->x+o->w+6<=bx.x||bx.x+bx.w+6<=o->x||o->y+o->h+4<=bx.y||bx.y+bx.h+4<=o->y))clear_=false;}
        if(clear_&&nlabels<10){labels[nlabels++]=bx;AVOID(bx);letter(&cv,scratch,n,L_ROUTE,(pal->flags&PLATE_MONO)?1:0);}
      }
    }
  }
  // The route as a scale: minute graduations, the quarters numbered; on the
  // world band five-minute ties only.
  for(int i=1;i<count-1&&!daily;i++){
    if(!HOUR_OF(b,i))continue;
    const int64_t since=(int64_t)T_OF(b,i)-T_OF(b,h0);const int m=(int)js_round(since/60.0);
    if(r64(since,60)||m<=0||m>=60||(world&&m%5))continue;
    const double len0=f_sqrt((track[i+1].a-track[i-1].a)*(track[i+1].a-track[i-1].a)+(track[i+1].b-track[i-1].b)*(track[i+1].b-track[i-1].b)),len=len0?len0:1;
    double nx=-(track[i+1].b-track[i-1].b)/len,ny=(track[i+1].a-track[i-1].a)/len;
    if(cam->slow?nx*cam->nx+ny*cam->ny>0:ny<0){nx=-nx;ny=-ny;}
    const int size=world?(m%15==0?4:2):m%15==0?6:m%5==0?4:2;
    for(int s=1;s<=size;s++)plot(&cv,track[i].a+nx*s,track[i].b+ny*s,L_ROUTE);
    if(!world&&m%15==0){
      char label[4];label[0]=(char)('0'+m/10);label[1]=(char)('0'+m%10);label[2]=0;
      const int lw=text_width(label);
      const int n=text_pixels(label,(int)js_round(track[i].a+nx*8-lw/2.0)+1,(int)js_round(track[i].b+ny*8+9),scratch);
      AVOID(bounds_of(scratch,n));letter(&cv,scratch,n,L_ROUTE,(pal->flags&PLATE_MONO)?1:0);
    }
  }
  // This hour's VOR rose and hexagon (on the world band a smaller rose,
  // kept within the band); the next hour's reporting point.
  const int c0x=(int)js_round(track[h0].a),c0y=(int)js_round(track[h0].b),c1x=(int)js_round(track[h1].a),c1y=(int)js_round(track[h1].b);
  const bool forward=c1x>c0x;
  if(!day){const int R=world?11:16;
  #define ROSE(x,y) do{const double y_=(y);if(y_>=top&&y_<=bottom)plot(&cv,(x),y_,L_INK);}while(0)
  // The rose turns to true north at the station: north is up on the
  // cylindrical charts, anywhere on a rolled Fuller sheet.
  double north=0;
  if(rolled){
    double lat,lon,q0x,q0y,q1x,q1y;if(!body_position(src,in->body,in->start+T_OF(b,h0),&lat,&lon))FAIL;
    project(cam,lat,lon,&q0x,&q0y);project(cam,lat+.5<89.9?lat+.5:89.9,lon,&q1x,&q1y);
    const double l=f_sqrt((q1x-q0x)*(q1x-q0x)+(q1y-q0y)*(q1y-q0y)),nl=l?l:1;north=f_atan2((q1x-q0x)/nl,-(q1y-q0y)/nl);
  }
  for(int a=0;a<720;a++){const double t=a*PI/360;ROSE(c0x+js_round(f_sin(t+north)*R),c0y-js_round(f_cos(t+north)*R));}
  for(int a=0;a<360;a+=30){const int len=(a%90==0?5:3)-(world?2:0);for(int r=R-len;r<R;r++){const double t=a*RAD;ROSE(c0x+js_round(f_sin(t+north)*r),c0y-js_round(f_cos(t+north)*r));}}
  for(int k=0;k<3;k++)for(int d=-k;d<=k;d++){const int r=R+4-k;ROSE(c0x+js_round(f_sin(north)*r+f_cos(north)*d),c0y-js_round(f_cos(north)*r-f_sin(north)*d));}
  #undef ROSE
  }
  if(!day){symbol(&cv,&HEXAGON,c0x,c0y);plot(&cv,c0x,c0y,L_INK);symbol(&cv,&TRIANGLE,c1x,c1y-1);}
  // The body is the minute's; all after it lies over it.
  cv.stage=3;
  char hour[4],next[4];
  // The hour figures' bounds (on the hour chart and the fixed tape), which
  // events' names give way to.
  Box *const figs=notes->figs;int nfigs=0;
  {const int hh=in->clock24?in->local_hour:(in->local_hour%12?in->local_hour%12:12),nh=in->clock24?(in->local_hour+1)%24:((in->local_hour+1)%12?(in->local_hour+1)%12:12);
  put_int(hour,hh,1);put_int(next,nh,1);}
  #define PLACE(end,w) ({int v=(int)js_round((end)-(w)/2.0);v=v<W-4-(w)?v:W-4-(w);v>4?v:4;})
  if(world&&in->tape==3){
    // A clock instead of the tape: the panel plain, ruled off from the
    // band; the time is the minute's.
    cv.panel=TAPE_PANEL;for(int y=0;y<TAPE_PANEL;y++)for(int x=0;x<W;x++)layer_set(classes,x,y,0);
    for(int x=0;x<W;x++)plot(&cv,x,TAPE_PANEL-1,L_SPACE_INK);
  }else if(world&&in->tape&&in->tape!=4){
    // A sliding tape moves each minute, all of it the minute's.
    cv.panel=TAPE_PANEL;for(int y=0;y<TAPE_PANEL;y++)for(int x=0;x<W;x++)layer_set(classes,x,y,0);
  }else if(world){
    // The world band's hours are set in a panel over the map, an
    // instrument tape: minute graduations, tall hour marks under the
    // figures, this hour solid and the next outlined. Its index is the
    // minute's.
    // (The route's ruler, tape 4, is scaled to the route: each minute's mark
    // stands over that minute's place on it, the ruler as long as the hour's
    // run across the band, its index over the satellite.)
    const int B=TAPE_BASELINE,P=TAPE_PANEL,X0=TAPE_X0,X1=TAPE_X1;const bool routed=in->tape==4;
    #define AT(m) (forward?X0+(double)(X1-X0)*(m)/60:X1-(double)(X1-X0)*(m)/60)
    // The route's point at minute m of the hour (every minute is one of
    // its points, the step dividing a minute), and whether it is on the band.
    #define AT_ROUTE(m) (((T_OF(b,h0)+(m)*60-b->t0)%b->step==0&&(T_OF(b,h0)+(m)*60-b->t0)/b->step<count)?(T_OF(b,h0)+(m)*60-b->t0)/b->step:-1)
    #define ON(m) (AT_ROUTE(m)>=0)
    #define RX(m) (track[AT_ROUTE(m)].a)
    #define ON_BAND(m) (ON(m)&&RX(m)>=0&&RX(m)<W)
    cv.panel=P;for(int y=0;y<P;y++)for(int x=0;x<W;x++)layer_set(classes,x,y,0);
    for(int x=0;x<W;x++)plot(&cv,x,P-1,L_SPACE_INK);
    for(int x=routed?0:X0;x<=(routed?W-1:X1);x++)plot(&cv,x,B,L_SPACE_INK);
    // (The columns its labels have taken, by eights.)
    uint32_t labelled=0;
    // (Of a whole day the route's ruler is the day's: each hour's mark over
    // the body's place at that hour, every sixth numbered.)
    const bool hours=routed&&daily;
    for(int m=0;m<=60;m++){
      if(hours?m*12>=count:routed&&!ON_BAND(m))continue;
      const double x=js_round(hours?track[m*12].a:routed?RX(m):AT(m));const int len=hours?(m%6==0?6:m%3==0?4:2):m%60==0?12:m%15==0?6:m%5==0?4:2;
      for(int d=1;d<=len;d++)plot(&cv,x,B+d,L_SPACE_INK);
      if(m%60==0&&!hours)for(int d=1;d<=6;d++)plot(&cv,x,B-d,L_SPACE_INK);
      // (Where the route runs north and south its ruler's marks crowd: a
      // label that would stand on the last one is left out.)
      const int col=(int)x>>3;
      if((hours?m%6==0:m%15==0&&m%60)&&col>=0&&col<25&&!(routed&&(labelled>>col&7))){
        labelled|=2u<<col;
        const int v=hours?HOUR_SHOWN(m):m;
        char label[4];label[0]=(char)('0'+v/10);label[1]=(char)('0'+v%10);label[2]=0;
        const int lw=text_width(label),n=text_pixels(label,(int)x-(int)f_floor(lw/2.0)+1,B+17,scratch);
        for(int i=0;i<n;i++)plot(&cv,scratch[i].x,scratch[i].y,L_SPACE_INK);
      }
    }
    const int size=40,hw=run_width(hour,size),nw=run_width(next,size),gx=PLACE(forward?X0:X1,hw),nx=PLACE(forward?X1:X0,nw);
    Figures fig;if(!load_figures(src,size,hour,next,&fig,room,room_size))FAIL;
    FigureRun run;figure_run(hour,size,gx,4,&run);figure_bind(&run,&fig,size);plot_figure(&cv,&run,0,L_SPACE_INK);figs[nfigs++]=figure_bounds(&run);
    figure_run(next,size,nx,4,&run);figure_bind(&run,&fig,size);plot_figure(&cv,&run,1,L_SPACE_INK);figs[nfigs++]=figure_bounds(&run);
    tape_lo=(int16_t)((gx+hw<nx+nw?gx+hw:nx+nw)+3);tape_hi=(int16_t)((gx>nx?gx:nx)-3-text_width("00"));
    // (How its minutes fall on the route, the transfer, is the minute's.)
      #undef ON_BAND
      #undef RX
      #undef ON
      #undef AT_ROUTE
      #undef AT
  }else if(!day&&!in->bare){
    // The hour figures: this hour solid over its rose, the next outlined
    // (unless the chart is asked for bare of them: the route alone, the
    // time beside the body).
    // As the counter readout, this hour's figure is the time, its minutes
    // beside it as the time's figures are set (the minute renderer draws it,
    // from the callout's figure sets): the widest minutes are given room,
    // in 72 and 40 px figures, or 40 and 28 where those will not fit.
    int size=strlen(hour)>1||strlen(next)>1?72:80,extra=0;
    if(in->readout==3){
      for(int try=0;try<2&&!extra;try++){
        size=try?40:72;const int small=try?28:40,mono=in->numerals==ENR_MONO,even=in->numerals==ENR_EVEN,ms=even?size:small;
        int widest=0;for(int d=0;d<10;d++)if(figure(ms,(char)('0'+d))->width>widest)widest=figure(ms,(char)('0'+d))->width;
        const int cs=figure(small,'0')->height/7;
        extra=gap_for(size)+(mono?3+26:in->numerals==ENR_COLON?1+(cs>3?cs:3)+gap_for(size)+1+2*widest+gap_for(small):3+2*widest+gap_for(ms));
        if(run_width(hour,size)+extra>W-8&&!try)extra=0;
      }
      counter=(uint8_t)(size==72?2:1);
    }
    const int hw=run_width(hour,size)+extra,nw=run_width(next,size),fh=figure(size,'0')->height,gy=c0y-26-fh;
    Figures fig;if(!load_figures(src,size,hour,next,&fig,room,room_size))FAIL;
    int hx0=PLACE(c0x,hw),hy0=gy,nx0=PLACE(c1x,nw),ny0=gy;
    if(FACE_CHART&cam->slow){
      // Each figure stands off its station on the route's open side.
      // Held on the face, a wide figure can come back over the rose (20 px
      // round the station): it then stands off along the route's open side
      // until it is clear.
      #define STAND(cx,cy,w,ox,oy) do{double d=26+fabs(cam->nx)*(w)/2.0+fabs(cam->ny)*fh/2.0;\
        for(int k_=0;k_<40;k_++,d+=2){int vx=(int)js_round((cx)+cam->nx*d-(w)/2.0),vy=(int)js_round((cy)+cam->ny*d-fh/2.0);vx=vx<W-4-(w)?vx:W-4-(w);ox=vx>4?vx:4;vy=vy<H-18-fh?vy:H-18-fh;oy=vy>4?vy:4;\
          const int nx_=(cx)<ox?ox:(cx)>ox+(w)?ox+(w):(cx),ny_=(cy)<oy?oy:(cy)>oy+fh?oy+fh:(cy);\
          if((nx_-(cx))*(nx_-(cx))+(ny_-(cy))*(ny_-(cy))>=22*22)break;}}while(0)
      STAND(c0x,c0y,hw,hx0,hy0);STAND(c1x,c1y,nw,nx0,ny0);
      #undef STAND
    }
    // (The time, wider than the hour alone, can reach the next hour's
    // figure: that one then stands on the other side of the route.)
    if(counter&&hx0<nx0+nw&&nx0<hx0+hw&&hy0<ny0+fh&&ny0<hy0+fh){ny0=ny0<c1y?c1y+26:c1y-26-fh;ny0=ny0<4?4:ny0>H-18-fh?H-18-fh:ny0;}
    FigureRun run;figure_run(hour,size,hx0,hy0,&run);figure_bind(&run,&fig,size);
    if(counter)figs[nfigs++]=(Box){hx0,hy0,hw,fh};else{letter_figure(&cv,&run,0,L_INK);figs[nfigs++]=figure_bounds(&run);}
    figure_run(next,size,nx0,ny0,&run);figure_bind(&run,&fig,size);letter_figure(&cv,&run,2,L_INK);figs[nfigs++]=figure_bounds(&run);

  }
  #undef PLACE
  // A Fuller sheet's scale, if asked for: a bar of a round length in the
  // sheet's open space (off the net, clear of the margins, the network and
  // the hour's figures), the lowest and leftmost place that is. (An edge of
  // the icosahedron, the net's unit, is 63.43 degrees of the Earth: 7,054 km.)
  if(rolled&&in->legend)scale_bar(&cv,b->fc,taken,taken_n,figs,nfigs,scratch);
  // Events are compulsory reporting points: a filled triangle on the route
  // at the event's minute, its name over it (the minute's: see
  // enroute_core.c), clear of the lettering, the network and the figures.
  static const Symbol FIX={9,7,{0x010,0x038,0x038,0x07c,0x07c,0x0fe,0x1ff}};
  int nevents=0;EventNote *const events=notes->events;
  for(int e=0;e<in->event_count&&e<16;e++){
    const int64_t t=in->events[e].t-in->start;int i=1;
    while(i<count&&!(T_OF(b,i-1)<=t&&T_OF(b,i)>=t))i++;
    if(i>=count||JUMP(i-1,i))continue;
    const double f=(double)(t-T_OF(b,i-1))/((T_OF(b,i)-T_OF(b,i-1))?(double)(T_OF(b,i)-T_OF(b,i-1)):1);
    const int x=(int)js_round(track[i-1].a+(track[i].a-track[i-1].a)*f),y=(int)js_round(track[i-1].b+(track[i].b-track[i-1].b)*f);
    if(x<5||x>W-6||y<top+8||y>bottom-4)continue;
    symbol(&cv,&FIX,x,y-1);
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
    for(int dy=0;dy<11;dy++)for(int dx=0;dx<11;dx++)if(AIRPORT.row[dy]>>dx&1)plot(&cv,hx+dx-5,hy+dy-5,L_MARK);
    letter(&cv,home_code,home_code_n,L_MARK,1);
    // Its mark's pixels, in order: the symbol's and, over the ground, the
    // code's, where no knockout has cleared them.
    #define MARK_AT(px,py,code) do{const int X=(px),Y=(py);if(X>=0&&Y>=0&&X<W&&Y<H&&layer_at(classes,X,Y)==L_LATE_INK&&mark_n<128){\
      bool over_space_code=false;for(int i=0;i<home_code_n;i++)if(home_code[i].x==X&&home_code[i].y==Y&&ground_at(&cv,X,Y)==G_SPACE)over_space_code=true;\
      if(!over_space_code&&(!(code)||ground_at(&cv,X,Y)!=G_SPACE))marks[mark_n++]=(Y)*W+(X);}}while(0)
    for(int dy=0;dy<11;dy++)for(int dx=0;dx<11;dx++)if(AIRPORT.row[dy]>>dx&1)MARK_AT(hx+dx-5,hy+dy-5,false);
    for(int i=0;i<home_code_n;i++)MARK_AT(home_code[i].x,home_code[i].y,true);
    #undef MARK_AT
    // Sorted, each once.
    for(int i=1;i<mark_n;i++){const uint16_t v=marks[i];int j=i;while(j>0&&marks[j-1]>v){marks[j]=marks[j-1];j--;}marks[j]=v;}
    int kept=0;for(int i=0;i<mark_n;i++)if(!kept||marks[kept-1]!=marks[i])marks[kept++]=marks[i];mark_n=kept;
  }
  int16_t top_x=6,top_baseline=11,height_right=0,height_baseline=0;
  if(world){
    // Over the band, the local date; at its right the minute's corner (the
    // satellite's height or ground point). Under it, the pass line and
    // Zulu time.
    char source[24];
    {char *p=source;memcpy(p,WEEKDAYS[in->weekday%7],3);p+=3;*p++=' ';p=put_int(p,in->day,2);*p++=' ';memcpy(p,MONTHS[in->month-1],3);p[3]=0;}
    if(cv.wrap)memcpy(b->source,source,sizeof b->source);
    else{const int n=text_pixels(source,6,top-6,scratch);letter(&cv,scratch,n,L_INK,1);}
    zulu_x=(int16_t)(W-6-text_width("0000Z"));zulu_baseline=H-1;top_baseline=H-1;height_right=W-6;height_baseline=(int16_t)(top-6);
  }else{
    // Margins: the local date and day of the week, the minute's corner (the
    // day of the year, the body's ground point or the Moon's light), Zulu
    // time between them, centred as for the widest corner; over the chart,
    // home's rise and set.
    char left[24];
    {char *p=left;memcpy(p,WEEKDAYS[in->weekday%7],3);p+=3;*p++=' ';p=put_int(p,in->day,2);*p++=' ';memcpy(p,MONTHS[in->month-1],3);p[3]=0;}
    {const int y=H-5,lw=text_width(left),rw=text_width(CORNER_WIDEST);
    int n=text_pixels(left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
    // The corner is lettered each minute: the callout's leader breaks for it.
    n=text_pixels(CORNER_WIDEST,W-6-rw,y,scratch);AVOID(bounds_of(scratch,n));
    const int l=6+lw,r=W-6-rw;zulu_x=(int16_t)js_round((l+r-text_width("0000Z"))/2.0);zulu_baseline=(int16_t)y;
    height_right=W-6;height_baseline=(int16_t)y;}
    if(in->home&&in->rise_left[0]){
      const int y=11,rw=text_width(in->rise_right);
      int n=text_pixels(in->rise_left,6,y,scratch);letter(&cv,scratch,n,L_INK,1);
      n=text_pixels(in->rise_right,W-6-rw,y,scratch);letter(&cv,scratch,n,L_INK,1);
    }
  }
  draw=NULL;

  // The route's points, to the pixel; then the drawing's lists are done with.
  points=alloc(sizeof(EnrPoint)*(count?count:1));if(!points)FAIL;
  for(int i=0;i<count;i++){
    EnrPoint *q=&points[i];q->x=(int16_t)js_round(track[i].a);q->y=(int16_t)js_round(track[i].b);
    q->flags=(uint8_t)((i&&fabs(track[i].b-track[i-1].b)>fabs(track[i].a-track[i-1].a)?ENR_STEEP:0)|(i&&fabs(track[i].a-track[i-1].a)>W/2?ENR_JUMP:0)|(HOUR_OF(b,i)?ENR_HOUR:0));
  }
  const double c1x_=track[h1].a;
  double least=INFINITY;for(int i=0;i<count;i++)if(track[i].a<least)least=track[i].a;
  // (Then a few rows of scratch in their place: the stack is small.)
  release(b->lists);b->lists=NULL;
  _Static_assert(3*W>=6*(GRID_N+1),"the scratch holds a row of the grid's directions");
  if(!(b->lists=alloc(3*W)))FAIL;
  uint8_t *const row=b->lists,*const out_row=b->lists+W;
  // The scene, small: its minutes, tables and runs lie in blocks of their
  // own, none of them large (by now the heap is in pieces).
  out=alloc(sizeof(EnrScene));if(!out)FAIL;
  memset(out,0,sizeof *out);
  // Its class plane as row runs: each row the ground's classes with what
  // was drawn laid over them, into pieces a row never straddles; the
  // ground's chunks and the plane's bands let go as their rows are done, so
  // the pieces take their places.
  {unsigned piece=0,used=0;
  for(int y=0;y<H;y++){
    ground_row(&b->sink,cv.panel,y,row);for(int x=0;x<W;x++){const int l=layer_at(classes,x,y);if(l)row[x]=(uint8_t)((row[x]&15)|l<<4);}
    const unsigned r=(unsigned)row_runs(row,out_row);
    if(!out->run_piece[piece]||used+r>ENR_RUN_PIECE){
      if(out->run_piece[piece]){piece++;used=0;}
      if(piece==ENR_RUN_PIECES||!(out->run_piece[piece]=alloc(ENR_RUN_PIECE)))FAIL;
    }
    memcpy(out->run_piece[piece]+used,out_row,r);out->row_offset[y]=(uint16_t)(piece*ENR_RUN_PIECE+used);used+=r;
    sink_drop(&b->sink,b->sink.row_offset[y+1],release);
    // (The last band stays: it becomes the rows' lighting table.)
    if((y+1)%BAND_ROWS==0&&y+1<H){release(b->plane.band[y/BAND_ROWS]);b->plane.band[y/BAND_ROWS]=NULL;}
  }
  {const unsigned end=piece*ENR_RUN_PIECE+used;out->row_offset[H]=(uint16_t)(end>65535?65535:end);}
  // The last piece is cut to what it holds, where the heap can do that.
  if(src->resize&&used<ENR_RUN_PIECE){uint8_t *fit=src->resize(out->run_piece[piece],used);if(fit)out->run_piece[piece]=fit;}
  // The ground's arena becomes the scene's minutes (and columns); the
  // plane's last band its rows' table, or is let go.
  out->minutes=(EnrMinute *)b->sink.arena;b->sink.arena=NULL;sink_free(b);
  // (Where the arena is more than they need, a block their size if there
  // is room for one.)
  if(RUN_ARENA>=60*sizeof(EnrMinute)+1024&&(!FACE_CHART||rolled)){EnrMinute *fit=alloc(60*sizeof(EnrMinute));if(fit){release(out->minutes);out->minutes=fit;}}
  memset(out->minutes,0,60*sizeof(EnrMinute));
  _Static_assert(BAND_BYTES>=H*(2*sizeof(enr_real)+2*sizeof(int32_t)),"a band of the plane holds the rows' table");
  if(FACE_CHART&&!rolled){
    out->rows_block=b->plane.band[PLANE_BANDS-1];b->plane.band[PLANE_BANDS-1]=NULL;
    out->row_cos=out->rows_block;out->row_sin=out->row_cos+H;out->row_q=(int32_t (*)[2])(out->row_sin+H);
    out->col_cos=(enr_real *)(out->minutes+60);out->col_sin=out->col_cos+W;
  }else{release(b->plane.band[PLANE_BANDS-1]);b->plane.band[PLANE_BANDS-1]=NULL;}
  }
  out->track=points;out->track_count=(uint16_t)count;out->track_t0=b->t0;out->track_step=(int16_t)b->step;points=NULL;
  out->flags=(uint8_t)((pal->flags&PLATE_ZONES?1:0)|(pal->flags&PLATE_SCAN?2:0)|(pal->flags&PLATE_TERMINATOR?4:0)|(pal->flags&PLATE_NIGHT_DOTS?8:0)|((in->readout==1||(world&&in->readout>=2))?16:0)|(in->readout==2&&!world?32:0)|(world&&(in->tape==1||in->tape==2)?64:0)|(world&&in->tape==2?128:0));
  out->lattice=(pal->flags&PLATE_LATTICE)!=0;out->hal=(pal->flags&PLATE_HAL)!=0;out->clock=world&&in->tape==3;
  out->wash=(pal->flags&PLATE_WASH)!=0;out->counter=counter;out->pattern=(uint8_t)PLATE_PATTERN(pal->flags);
  out->transfer=(uint8_t)(daily||!world||in->tape>2?0:in->transfer);
  out->body=(uint8_t)in->body;out->view=world?ENR_VIEW_WORLD:day?ENR_VIEW_DAY:ENR_VIEW_HOUR;out->forward=(int8_t)(forward?1:-1);out->hour_start=(int32_t)in->start;
  memcpy(out->zoned,pal->zoned,sizeof out->zoned);
  out->space=pal->space;out->space_ink=pal->space_ink;out->screen=pal->screen;out->waterline=pal->waterline;out->terminator=pal->terminator;out->night_dots=pal->night_dots;
  memcpy(out->tints,pal->tints,sizeof out->tints);
  for(int k=0;k<2;k++)out->depths[k]=k<pal->depth_count?pal->depths[k]:0;
  if(!rolled){
  for(int y=0;y<H;y++){const double lat=glat(cam,y+.5)*RAD;out->row_cos[y]=(enr_real)f_cos(lat);out->row_sin[y]=(enr_real)f_sin(lat);}
  for(int x=0;x<W;x++){const double lon=glon(cam,x+.5)*RAD;out->col_cos[x]=(enr_real)f_cos(lon);out->col_sin[x]=(enr_real)f_sin(lon);}
  }else{
    // A Fuller sheet is lit from its faces' grids: their frames, each
    // tile's place, which tile each pixel lies on, the grid's directions.
    const FullerCam *fc=b->fc;EnrFuller *f=out->fuller=alloc(sizeof(EnrFuller));if(!f)FAIL;memset(f,0,sizeof *f);
    double net=INFINITY;for(int t=0;t<fc->tile_count;t++)if(fc->tiles[t].box[1]<net)net=fc->tiles[t].box[1];f->net_top=net>0?net:0;
    memcpy(f->bases,b->fg->bases,sizeof f->bases);
    f->tile_count=(uint8_t)fc->tile_count;for(int t=0;t<fc->tile_count;t++){f->tile_face[t]=fc->tiles[t].face;fuller_tile_grid(fc,t,GRID_N,f->tile_grid[t]);}
    // Which tile each pixel lies on comes after (fuller_tile_rows).
    b->tile_piece=0;b->tile_used=0;b->tile_row=0;
    // The night's grid: the zoomed ground's own, or read now.
    if(b->dirs){f->dirs=b->dirs;b->dirs=NULL;}
    else if(!(f->dirs=night_dirs(src,b->lists)))FAIL;
    out->heavy=heavy;
  }
  out->c1x=(enr_real)c1x_;out->normal_x=cam->slow?(enr_real)cam->nx:0;out->normal_y=cam->slow?(enr_real)cam->ny:-1;
  out->zulu_x=zulu_x;out->zulu_baseline=zulu_baseline;out->top_x=top_x;out->top_baseline=top_baseline;out->height_right=height_right;out->height_baseline=height_baseline;
  // (The route's ruler has no run of its own to fill behind the index: x0 past x1.)
  if(world&&(!in->tape||in->tape==4)){out->tape_x0=in->tape?1:TAPE_X0;out->tape_x1=in->tape?0:TAPE_X1;out->tape_baseline=TAPE_BASELINE;out->tape_lo=tape_lo;out->tape_hi=tape_hi;}
  out->home_x=home_mark?(int16_t)hx:-1000;out->home_y=home_mark?(int16_t)hy:-1000;
  out->numerals=(uint8_t)in->numerals;
  memcpy(out->source,b->source,sizeof out->source);
  out->event_count=(uint8_t)nevents;memcpy(out->events,events,sizeof events[0]*nevents);
  if(world&&in->tape==3){
    // The clock's hour, as the callout's, and its figures.
    if(in->numerals==ENR_EVEN&&in->clock24&&!hour[1]){out->hour_text[0]='0';out->hour_text[1]=hour[0];}else memcpy(out->hour_text,hour,strlen(hour));
    if(!chart_callout_figures(out,src->figures,src->figure_source,alloc))FAIL;
  }else if(world&&in->tape&&in->tape!=4){
    memcpy(out->tape_hour,hour,strlen(hour));memcpy(out->tape_next,next,strlen(next));
    if(!chart_callout_figures(out,src->figures,src->figure_source,alloc))FAIL;
  }
  out->c0[0]=(int16_t)c0x;out->c0[1]=(int16_t)c0y;out->c1[0]=(int16_t)c1x;out->c1[1]=(int16_t)c1y;
  out->station_count=(uint8_t)nshown;memcpy(out->stations,shown,sizeof(int16_t)*2*nshown);memcpy(out->station_table,shown_table,nshown);
  for(int k=0;k<nfigs&&k<2;k++){out->fig_box[k][0]=(int16_t)figs[k].x;out->fig_box[k][1]=(int16_t)figs[k].y;out->fig_box[k][2]=(int16_t)figs[k].w;out->fig_box[k][3]=(int16_t)figs[k].h;}
  if(!world){
    // The time callout's place, hour and the lettering it breaks for; its
    // figures, when it is drawn.
    if(day){out->callout_left=(int16_t)(f_floor(least)-8);out->callout_top=(int16_t)(4+(in->home?14:0));out->callout_bottom=H-18;}
    memset(out->hour_text,0,3);
    if(in->numerals==ENR_EVEN&&in->clock24&&!hour[1]){out->hour_text[0]='0';out->hour_text[1]=hour[0];}else memcpy(out->hour_text,hour,strlen(hour));
    out->avoid_count=(uint8_t)avoid_n;
    for(int k=0;k<avoid_n;k++){out->avoid[k][0]=(int16_t)avoid[k].x;out->avoid[k][1]=(int16_t)avoid[k].y;out->avoid[k][2]=(int16_t)avoid[k].w;out->avoid[k][3]=(int16_t)avoid[k].h;}
    if((day||in->readout==2||counter)&&!chart_callout_figures(out,src->figures,src->figure_source,alloc))FAIL;
  }
  out->mark_count=(uint8_t)mark_n;for(int k=0;k<mark_n;k++){out->marks[k][0]=(uint8_t)(marks[k]%W);out->marks[k][1]=(uint8_t)(marks[k]/W);}
  if(home_mark){out->home_box[0]=(int16_t)home_box.x;out->home_box[1]=(int16_t)home_box.y;out->home_box[2]=(int16_t)home_box.w;out->home_box[3]=(int16_t)home_box.h;}
  b->out=out;b->forward=forward;b->minute=0;
  if((world||(rolled&cam->wide&&!day))&&in->home){b->sb=alloc(2*120*sizeof(double));if(!b->sb)FAIL;b->cb=b->sb+120;bearings(3,b->sb,b->cb);}
   release(b->lists);b->lists=NULL;
   return true;
fail:
  if(out){enr_free(out,release);release(out);b->out=NULL;}
  release(points);
  return false;
}
// Minutes m0 up to m1 of the scene; home's acquisition circles, minutes
// that plot the same pixels sharing one.
static bool finish_minutes(ChartBuild *b,int m0,int m1){
  const ChartInput *in=&b->in;const ChartSources *src=&b->src;const Cam *const cam=&b->cam;const bool world=FACE_WORLD&&(!FACE_HOUR||cam->world),forward=b->forward;
  // (The circle's pixels in the notes' room for home's mark, which the
  // scene has by now.)
  _Static_assert(sizeof(((Notes *)0)->marks)>=2*120,"the notes hold a circle's pixels");
  EnrScene *const out=b->out;uint8_t *const ring=(uint8_t *)b->notes.marks;
  for(int m=m0;m<m1;m++){
    const int64_t t=in->start+m*60;EnrMinute *e=&out->minutes[m];
    double lat,lon,altitude;if(!body_position(src,0,t,&lat,&lon))FAIL;
    e->sun[0]=(enr_real)(f_cos(lat*RAD)*f_cos(lon*RAD));e->sun[1]=(enr_real)(f_cos(lat*RAD)*f_sin(lon*RAD));e->sun[2]=(enr_real)f_sin(lat*RAD);
    if(!body_place(src,in->body,t,&lat,&lon,&altitude))FAIL;
    double mx,my;project(cam,lat,lon,&mx,&my);
    // (Off the band to the north or south, the body rides its edge.)
    if(world){if(my<cam->top)my=cam->top;if(my>cam->bottom)my=cam->bottom;}
    e->mx=(enr_real)mx;e->my=(enr_real)my;
    // The Sun and Moon beside the body, where they are on the chart.
    for(int k=0;k<2;k++){
      double la,lo,x,y;uint8_t *const a=e->also[k];a[0]=255;
      if(!(in->also>>k&1)||in->body==k)continue;
      if(!body_position(src,k,t,&la,&lo))FAIL;
      project(cam,la,lo,&x,&y);
      int xi=(int)js_round(x);const int yi=(int)js_round(y);
      // (Round the sliding world, its place on the band.)
      if(world&&in->tape==2)xi=(xi%W+W)%W;
      if(xi>=0&&xi<W&&yi>=cam->top+7&&yi<=cam->bottom-8){a[0]=(uint8_t)xi;a[1]=(uint8_t)yi;}
    }
    const Segment *seg=src->segment(src->segment_context,(int32_t)q64(t,86400));if(!seg)FAIL;
    bool waxing;double fraction;seg_moon_light(seg,t,&fraction,&waxing);e->moon_fraction=(enr_real)fraction;e->waxing=waxing;
    // The margin's time: Zulu, or the nautical zone's under the body (15
    // degrees wide, lettered A-M east, N-Y west).
    int zh=0;char zl='Z';
    if(in->zone_body){
      const double v=js_round(wrap(lon)/15);zh=v>12?12:v<-12?-12:(int)v;
      if(zh>0)zl="ABCDEFGHIKLM"[zh-1];else if(zh<0)zl="NOPQRSTUVWXY"[-zh-1];
    }
    const int64_t day=r64(r64(t+zh*3600,86400)+86400,86400);const int hh=(int)day/3600,mm=(int)day%3600/60;
    e->zulu[0]=(char)('0'+hh/10);e->zulu[1]=(char)('0'+hh%10);e->zulu[2]=(char)('0'+mm/10);e->zulu[3]=(char)('0'+mm%10);e->zulu[4]=zl;
    // The local clock's minute: the hour starts on the local hour.
    e->minute[0]=(char)('0'+m/10);e->minute[1]=(char)('0'+m%10);memset(e->top,0,sizeof e->top);
    // A satellite's pass line, which can change within the hour.
    if(in->body>=2&&in->home&&src->pass_line)src->pass_line(src->pass_context,t,e->top);
    memset(e->corner,0,sizeof e->corner);e->circle=255;e->index=0;
    // The margins' corner: old elements noted, else the chosen text.
    {const SatSegment *ss=in->body>=2&&src->satellite?src->satellite(src->satellite_context,t):NULL;
    // (Old: a low orbit's elements after two days; a high one's, GPS's or
    // QZSS's, whose segments span six hours, hold for a fortnight, and
    // CelesTrak's newest are often two days old.)
    const bool old=ss&&t-(int64_t)ss->epoch>(ss->span>3600?14:2)*86400;char *p=e->corner;
    // (On the world band led by the satellite's code, but for old elements.)
    if(world&&!old&&in->body>=2){for(const char *k=in->code[0]?in->code:"SAT";*k;k++)*p++=*k;*p++=' ';}
    if(old){memcpy(p,"EL OLD",6);p+=6;if(world&&altitude<9999.5){*p++=' ';p=put_int(p,(int)js_round(altitude),1);memcpy(p," KM",3);}}
    else if(in->corner==1){
      // The ground point, to the degree: 23N 045E.
      const double wl=wrap(lon);
      p=put_int(p,(int)js_round(fabs(lat)),2);*p++=lat<0?'S':'N';*p++=' ';p=put_int(p,(int)js_round(fabs(wl)),3);*p++=wl<0?'W':'E';
    }
    else if(in->corner==2&&in->body>=2){
      const double dot=f_cos(lat*RAD)*(e->sun[0]*f_cos(lon*RAD)+e->sun[1]*f_sin(lon*RAD))+e->sun[2]*f_sin(lat*RAD);
      const bool dark=sat_eclipsed(altitude,dot);memcpy(p,dark?"ECLIPSE":"SUNLIT",dark?7:6);
    }
    else if(world&&in->body>=2){p=put_int(p,(int)js_round(altitude),1);memcpy(p," KM",3);}
    else if(in->corner==2&&in->body==1){p=put_int(p,(int)js_round(fraction*100),1);memcpy(p,waxing?"% WAX":"% WAN",5);}
    else{memcpy(p,"DAY ",4);put_int(p+4,in->day_of_year,3);}}
    // A Fuller satellite sheet's home circle follows the satellite's height.
    if(FACE_ROLL&&(!FACE_CHART||b->fc)&cam->wide&&!cam->day&&in->home){
      const int n=circle_pixels_on(cam,in->home_lat,in->home_lon,REACH(altitude),3,b->sb,b->cb,ring,true);int k=0;
      for(;k<out->circle_count;k++)if(out->circle_n[k]==n&&!memcmp(out->circle_px[k],ring,2*n))break;
      if(k==out->circle_count){
        if(k>=60||!(out->circle_px[k]=src->alloc(n?2*n:1)))FAIL;
        memcpy(out->circle_px[k],ring,2*n);out->circle_n[k]=(uint8_t)n;out->circle_count++;
      }
      e->circle=(uint8_t)k;
    }
    if(world){
      if(!in->tape)e->index=(int16_t)js_round(forward?TAPE_X0+(double)(TAPE_X1-TAPE_X0)*m/60:TAPE_X1-(double)(TAPE_X1-TAPE_X0)*m/60);
      else if(in->tape==4)e->index=(int16_t)((((int)js_round(e->mx))%W+W)%W);
      if(in->home){
        const int n=circle_pixels(cam,in->home_lat,in->home_lon,REACH(altitude),3,b->sb,b->cb,ring);int k=0;
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
  // The set's 20, 28 and 40 px figures, which lie together in figures.bin;
  // for the panel clock, its 28, 40 and 72.
  const int at=s->clock||s->counter==2?1:0;
  const FigureGlyph *last=&s_glyphs[(at+3)*10-1];
  const unsigned from=s_glyphs[at*10].first,to=last->first+(unsigned)last->height*((last->width+7)/8);
  s->fig_bits=alloc(to-from);
  if(!s->fig_bits||read(source,from,s->fig_bits,to-from)!=to-from)return false;
  for(int k=0;k<3;k++)s->figure_px[k]=FIGURE_SIZES[at+k];
  for(int k=0;k<3;k++)for(int d=0;d<10;d++){const FigureGlyph *g=&s_glyphs[(at+k)*10+d];s->figures[k].width[d]=g->width;s->figures[k].height[d]=g->height;s->figures[k].first[d]=(uint16_t)(g->first-from);}
  return true;
}
EnrScene *chart_build(const ChartInput *in,const ChartSources *src){
  ChartBuild *b=chart_begin(in,src);if(!b)return NULL;
  return chart_finish(b);
}

static int row_runs(const uint8_t *row,uint8_t *out){
  int n=0;
  for(int x=0;x<W;){
    // A stretch of short runs of bare ground (a shaded plate's dither) is
    // told pixel by pixel, a nibble each, where that is the shorter.
    int e=x,r=0;
    while(e<W&&e-x<2*(255-ENR_RUN_MAX)){
      const uint8_t c=row[e];if(c>>4||c==G_SPACE)break;
      int k=1;while(e+k<W&&row[e+k]==c)k++;
      if(k>3)break;
      e+=k;r++;
    }
    int len=e-x;if(len>2*(255-ENR_RUN_MAX)){len=2*(255-ENR_RUN_MAX);r--;}
    if(len&1){len--;r--;}
    if(len>=4&&1+len/2<2*r){
      if(out){out[n]=(uint8_t)(ENR_RUN_MAX+len/2);for(int i=0;i<len/2;i++)out[n+1+i]=(uint8_t)(row[x+2*i]|row[x+2*i+1]<<4);}
      n+=1+len/2;x+=len;continue;
    }
    int k=1;while(x+k<W&&row[x+k]==row[x])k++;if(out){out[n]=(uint8_t)k;out[n+1]=row[x];}n+=2;x+=k;
  }
  return n;
}
