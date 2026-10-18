// The face's animations (enroute_core.h ENR_FX_*): a few frames drawn over
// the minute already on the screen, which is left as it was when they end.
// Each frame changes a few strips of rows: the rows are kept before they
// are changed and put back before the next frame (or the end) changes
// others, so an effect never needs the chart drawn again.
//
// The scans run down the screen: the refresh, a bright line with the glow
// of phosphor behind it; the sort, a band in which each row's runs of
// pixels are sorted by their light, so that light smears across it; the
// reacquiring, a sort that breaks the rows into blocks and resolves them
// pixel by pixel behind it, a box in the middle saying so (LOSS OF SIGNAL,
// REACQUIRING, blinking; SIGNAL ACQUIRED as it ends); the tear, blocks of rows thrown sideways, their
// red apart from the rest, as a picture losing its hold. The pulses are a
// ring opening about a point: the body as it steps each minute (a blink
// first), or home as the satellite rises into view.
#include "enroute_core.h"
#include "fmath.h"
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

#define W ENR_W
#define H ENR_H
// (At most this many rows changed at once.)
#define FX_ROWS 52
typedef struct {int y0,y1;} Span;
typedef struct {
  int kind,step,steps;uint32_t seed;
  bool up,left;                            // a scan's way: up the screen; a sort's light to the left
  int cx,cy;                               // a pulse's middle
  uint8_t accent,ground,ink;               // the plate's bright ink, and its space and lettering on it
  Span held[4];int nheld;                  // the rows kept, as strips
  uint8_t rows[FX_ROWS][W];                // and their pixels
  EnrPx text[480];                         // the reacquiring's box's lettering
  uint8_t tmp[3][W];                       // rows worked on (not on the stack: it is 2 KB)
} Fx;
static Fx *fx;

// The frame's rows: on the Round 2 each row's pixels from x0 to x1, of
// them the chart's circle's (the rim and its lettering are left alone).
#if ENR_ROUND
static uint8_t *row_of(uint8_t *frame,int stride,int y,int *x0,int *x1){
  const EnrFrame *f=(const EnrFrame *)frame;(void)stride;
  const int d=2*y+1-H,r2=4*ENR_CHART_R*ENR_CHART_R-d*d,half=r2>0?(int)f_floor(f_sqrt((enr_real)r2)/2):0;
  *x0=f->x0[y]>W/2-half?f->x0[y]:W/2-half;*x1=f->x1[y]<W/2+half-1?f->x1[y]:W/2+half-1;
  return f->row[y];
}
#else
static uint8_t *row_of(uint8_t *frame,int stride,int y,int *x0,int *x1){*x0=0;*x1=W-1;return frame+y*stride;}
#endif
static uint32_t rnd(void){fx->seed=fx->seed*1664525u+1013904223u;return fx->seed>>8;}
// A GColor8's light: its channels, green counted twice (0-12).
static int light(uint8_t c){return ((c>>4)&3)+2*((c>>2)&3)+(c&3);}
// n steps lighter in its own hue (each channel it has), so that a green
// screen's glow is green; black, the plate's bright ink dimmed (n 1, 2) or
// whole (3).
static uint8_t lighter(uint8_t c,int n){
  int r=(c>>4)&3,g=(c>>2)&3,b=c&3;
  if(!(r|g|b)){
    if(!fx)return c;
    const uint8_t a=fx->accent;r=(a>>4)&3;g=(a>>2)&3;b=a&3;const int k=3-n;
    r=r>k?r-k:0;g=g>k?g-k:0;b=b>k?b-k:0;return (uint8_t)(0xC0|r<<4|g<<2|b);
  }
  if(r)r+=n;
  if(g)g+=n;
  if(b)b+=n;
  r=r>3?3:r;g=g>3?3:g;b=b>3?3:b;
  return (uint8_t)(0xC0|r<<4|g<<2|b);
}

// The kept rows put back.
static void put_back(uint8_t *frame,int stride){
  int k=0;
  for(int i=0;i<fx->nheld;i++)for(int y=fx->held[i].y0;y<=fx->held[i].y1;y++,k++){
    int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);memcpy(r+x0,fx->rows[k]+x0,(size_t)(x1-x0+1));
  }
  fx->nheld=0;
}
// Rows y0 to y1 kept (within the screen and the room): the strip's index
// into rows[] of its first, or -1.
static int hold(uint8_t *frame,int stride,int y0,int y1){
  if(y0<0)y0=0;
  if(y1>H-1)y1=H-1;
  if(y0>y1||fx->nheld==4)return -1;
  int k=0;for(int i=0;i<fx->nheld;i++)k+=fx->held[i].y1-fx->held[i].y0+1;
  if(k+(y1-y0+1)>FX_ROWS)y1=y0+FX_ROWS-k-1;
  if(y1<y0)return -1;
  for(int i=0;i<fx->nheld;i++)if(y0<=fx->held[i].y1&&y1>=fx->held[i].y0)return -1;   // (strips never overlap)
  for(int y=y0;y<=y1;y++){int x0,x1;const uint8_t *r=row_of(frame,stride,y,&x0,&x1);memcpy(fx->rows[k+y-y0]+x0,r+x0,(size_t)(x1-x0+1));}
  fx->held[fx->nheld++]=(Span){y0,y1};
  return k;
}
// The kept (unchanged) pixels of a held row.
static const uint8_t *kept(int y){
  int k=0;
  for(int i=0;i<fx->nheld;i++){if(y>=fx->held[i].y0&&y<=fx->held[i].y1)return fx->rows[k+y-fx->held[i].y0];k+=fx->held[i].y1-fx->held[i].y0+1;}
  return NULL;
}

// Rows y0 to y1 kept where they are not already (the strips between).
static void hold_rows(uint8_t *frame,int stride,int y0,int y1){
  for(int y=y0;y<=y1;){
    if(kept(y)){y++;continue;}
    int e=y;while(e+1<=y1&&!kept(e+1))e++;
    hold(frame,stride,y,e);y=e+1;
  }
}
// The reacquiring's box in the middle of the screen: its words by how far
// the sweep has gone, blinking (four frames lit, four not) but the last.
static void signal_box(uint8_t *frame,int stride){
  const int left=fx->steps-fx->step;
  const char *t=left<=6?"SIGNAL ACQUIRED":fx->step<fx->steps/2?"LOSS OF SIGNAL":"REACQUIRING";
  // (The box as wide as the longest, its words centred in it.)
  const int n=(int)strlen(t),w=enr_text_width("SIGNAL ACQUIRED",15)+10,h=13,x0=W/2-w/2,y0=H/2-h/2;
  hold_rows(frame,stride,y0,y0+h-1);
  const bool lit=left<=6||(fx->step/4)%2==0;
  const int count=lit?enr_text_pixels(t,n,W/2-enr_text_width(t,n)/2,y0+10,fx->text):0;
  for(int y=y0;y<y0+h;y++){
    int a,b;uint8_t *r=row_of(frame,stride,y,&a,&b);if(!kept(y))continue;
    for(int x=x0;x<x0+w;x++)if(x>=a&&x<=b)r[x]=y==y0||y==y0+h-1||x==x0||x==x0+w-1?fx->accent:fx->ground;
  }
  for(int i=0;i<count&&i<(int)(sizeof fx->text/sizeof fx->text[0]);i++){
    const int x=fx->text[i].x,y=fx->text[i].y;int a,b;
    if(y<y0||y>=y0+h)continue;
    uint8_t *r=row_of(frame,stride,y,&a,&b);if(x>=a&&x<=b)r[x]=fx->ink;
  }
}
// A row's runs of pixels at least `at` light sorted by their light, the
// lightest to the right: a counting sort, steady. (On a dark plate the
// runs are of what is at most 12 - at, the dark ground with them: its
// light gathers at their ends.)
static void sort_row(uint8_t *r,const uint8_t *src,int x0,int x1,int at,bool dark){
  if(dark)at=12-at;
  // (The lightest to the left: the row read backward and written back so.)
  if(fx->left){
    uint8_t *a=fx->tmp[0],*b=fx->tmp[1];for(int x=x0;x<=x1;x++)a[x]=src[x1-(x-x0)];
    fx->left=false;sort_row(b,a,x0,x1,dark?12-at:at,dark);fx->left=true;
    for(int x=x0;x<=x1;x++)r[x]=b[x1-(x-x0)];
    return;
  }
  for(int x=x0;x<=x1;){
    if(dark?light(src[x])>at:light(src[x])<at){r[x]=src[x];x++;continue;}
    int e=x;while(e<=x1&&(dark?light(src[e])<=at:light(src[e])>=at))e++;
    int count[13]={0};for(int i=x;i<e;i++)count[light(src[i])]++;
    int start[13];for(int v=0,s=0;v<13;v++){start[v]=s;s+=count[v];}
    for(int i=x;i<e;i++)r[x+start[light(src[i])]++]=src[i];
    x=e;
  }
}

// A scan's row d rows into it (down the screen, or up it).
static int scan_row(int lead,int d){return fx->up?H-1-lead+d:lead-d;}
static void refresh(uint8_t *frame,int stride){
  // The line 9 rows a frame from beyond one edge to past the other, lit in
  // the plate's bright ink where the screen is dark; behind it the glow of
  // the phosphor, 18 rows of it fading, in scan lines at its tail.
  const int lead=-2+fx->step*9,y0=scan_row(lead,fx->up?0:18),y1=scan_row(lead,fx->up?18:0);
  if(hold(frame,stride,y0,y1)<0)return;
  for(int d=0;d<=18;d++){
    const int y=scan_row(lead,d);if(y<0||y>=H)continue;
    int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);const uint8_t *src=kept(y);if(!src)continue;
    for(int x=x0;x<=x1;x++)r[x]=d==0&&light(src[x])<5?fx->accent:d<2?lighter(src[x],3):d<5?lighter(src[x],2):d<10?lighter(src[x],1):(d&1)?lighter(src[x],1):src[x];
  }
}
static void pixel_sort(uint8_t *frame,int stride,bool resolving){
  // The band 24 rows (the reacquiring 40, its last 28 resolving), 6 rows a
  // frame; the threshold lowest at its middle, where the runs are longest.
  const int band=resolving?36:28,head=resolving?12:28,lead=fx->step*6;
  {const int a=scan_row(lead,0),b=scan_row(lead,band-1);if(hold(frame,stride,a<b?a:b,a<b?b:a)<0)return;}
  const bool dark=light(fx->accent)>6;
  for(int k=0;k<band;k++){
    const int y=scan_row(lead,band-1-k);if(y<0||y>=H)continue;
    int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);const uint8_t *src=kept(y);if(!src)continue;
    const int d=k;                      // 0 at the band's trailing edge
    if(!resolving||d>=band-head){
      // (The sorted band: the threshold by the distance from its middle.)
      const int at=resolving?1:2+abs(d-band/2)*10/(band/2);
      sort_row(r,src,x0,x1,at,dark);
      if(resolving){
        // Blocks of the row thrown sideways, as a signal breaking up.
        const int shift=(int)(rnd()%13)-6;
        if(shift){uint8_t *t=fx->tmp[0];memcpy(t+x0,r+x0,(size_t)(x1-x0+1));for(int x=x0;x<=x1;x++){int sx=x-shift;sx=sx<x0?x0:sx>x1?x1:sx;r[x]=t[sx];}}
      }
    }else{
      // Resolving behind it: each pixel back as the band leaves it.
      uint8_t *sorted=fx->tmp[2];sort_row(sorted,src,x0,x1,1,dark);
      const int keep=(band-head-d)*256/(band-head);   // (the chance a pixel is back, of 256)
      for(int x=x0;x<=x1;x++)r[x]=(int)(rnd()&255)<keep?src[x]:sorted[x];
    }
  }
}
static void tear(uint8_t *frame,int stride){
  // Two or three blocks a frame, 3 to 12 rows each, anywhere, thrown up to
  // 16 pixels either way; their red 2 pixels further.
  const int n=2+(int)(rnd()%2);
  for(int i=0;i<n;i++){
    const int h=3+(int)(rnd()%10),y0=(int)(rnd()%(unsigned)(H-h)),shift=((int)(rnd()%33)-16)|1;
    if(hold(frame,stride,y0,y0+h-1)<0)continue;
    for(int y=y0;y<y0+h&&y<H;y++){
      int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);const uint8_t *src=kept(y);if(!src)continue;
      for(int x=x0;x<=x1;x++){
        int a=x-shift,b=x-shift-(shift>0?2:-2);a=a<x0?x0:a>x1?x1:a;b=b<x0?x0:b>x1?x1:b;
        r[x]=(uint8_t)((src[a]&0xCF)|(src[b]&0x30));
      }
    }
  }
}
static void pulse(uint8_t *frame,int stride){
  // The body's blink (two frames lit about it), then the ring opening
  // from 4 to 14 pixels, fading.
  const bool body=fx->kind==ENR_FX_PULSE_BODY;
  const int s=fx->step-(body?3:0);
  if(s<0){
    if(fx->step==1)return;             // (between the two lit frames: as it is)
    if(hold(frame,stride,fx->cy-4,fx->cy+4)<0)return;
    for(int y=fx->cy-4<0?0:fx->cy-4;y<=fx->cy+4&&y<H;y++){
      int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);const uint8_t *src=kept(y);
      for(int x=fx->cx-4;x<=fx->cx+4;x++)if(x>=x0&&x<=x1&&(x-fx->cx)*(x-fx->cx)+(y-fx->cy)*(y-fx->cy)<=16)r[x]=lighter(src[x],2);
    }
    return;
  }
  const int rad=4+s*2;
  if(hold(frame,stride,fx->cy-rad-1,fx->cy+rad+1)<0)return;
  for(int y=fx->cy-rad-1<0?0:fx->cy-rad-1;y<=fx->cy+rad+1&&y<H;y++){
    int x0,x1;uint8_t *r=row_of(frame,stride,y,&x0,&x1);const uint8_t *src=kept(y);
    for(int x=fx->cx-rad-1;x<=fx->cx+rad+1;x++){
      if(x<x0||x>x1)continue;
      const int d2=(x-fx->cx)*(x-fx->cx)+(y-fx->cy)*(y-fx->cy);
      if(d2>=(rad-1)*(rad-1)&&d2<=rad*rad+rad)r[x]=s<3?fx->accent:lighter(src[x],s<5?2:1);
    }
  }
}

bool enr_fx_aos(const EnrScene *s,int minute){
  return minute>0&&minute<60&&!memcmp(s->minutes[minute].top,"IN VIEW",7)&&!memcmp(s->minutes[minute-1].top,"AOS",3);
}
bool enr_fx_begin(const EnrScene *s,int kind,int minute,uint32_t seed){
  enr_fx_end(NULL,0);
  if(kind<0||kind>=ENR_FX_KINDS||minute<0||minute>59)return false;
  if(!(fx=malloc(sizeof(Fx))))return false;
  memset(fx,0,offsetof(Fx,rows));
  fx->kind=kind;fx->seed=seed|1;
  #if ENR_ROUND
  enr_rim_style(s->rim);
  #endif
  fx->up=kind<=ENR_FX_REACQUIRE&&(rnd()&1);fx->left=rnd()&1;
  fx->accent=s->zoned[ENR_ROUTE][0];fx->ground=s->space;fx->ink=s->space_ink;
  static const int8_t steps[ENR_FX_KINDS]={33,48,50,8,9,6};   // (the scans' through the screen and past)
  fx->steps=steps[kind]+(ENR_ROUND&&kind<=ENR_FX_REACQUIRE?6:0);
  if(kind==ENR_FX_PULSE_BODY){fx->cx=(int)f_floor(s->minutes[minute].mx+(enr_real)0.5);fx->cy=(int)f_floor(s->minutes[minute].my+(enr_real)0.5);}
  if(kind==ENR_FX_PULSE_HOME){fx->cx=s->home_x;fx->cy=s->home_y;}
  if(kind>=ENR_FX_PULSE_BODY&&(fx->cx<0||fx->cx>=W||fx->cy<0||fx->cy>=H)){free(fx);fx=NULL;return false;}
  return true;
}
int enr_fx_frame(uint8_t *frame,int stride){
  if(!fx)return 0;
  put_back(frame,stride);
  if(fx->step>=fx->steps){free(fx);fx=NULL;return 0;}
  switch(fx->kind){
    case ENR_FX_REFRESH:refresh(frame,stride);break;
    case ENR_FX_SORT:pixel_sort(frame,stride,false);break;
    case ENR_FX_REACQUIRE:pixel_sort(frame,stride,true);signal_box(frame,stride);break;
    case ENR_FX_TEAR:tear(frame,stride);break;
    default:pulse(frame,stride);break;
  }
  fx->step++;
  return 1;
}
void enr_fx_end(uint8_t *frame,int stride){
  if(!fx)return;
  if(frame)put_back(frame,stride);
  free(fx);fx=NULL;
}
