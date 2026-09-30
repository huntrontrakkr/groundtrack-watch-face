// Builds an hour's scene with the watch's chart builder and writes it in the
// phone's scene format (src/native-scene.js), for byte-for-byte comparison.
//   chart_test <map.pack> <figures.bin> <out.scene>   with the input on stdin:
//   key value lines (body, plate, flag, clock24, start, hour, day, month,
//   year, yday, home, lat, lon, rise, set) and "segment <hex>" lines.
#define _POSIX_C_SOURCE 200809L
#include "../src/c/chart.h"
#include "../src/c/passes.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint8_t *slurp(const char *path,size_t *len){
  FILE *f=fopen(path,"rb");if(!f)return 0;fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);
  uint8_t *b=malloc(n);if(fread(b,1,n,f)!=(size_t)n){fclose(f);free(b);return 0;}fclose(f);*len=n;return b;
}
typedef struct {const uint8_t *data;size_t length;} Mem;
static size_t mem_read(void *src,uint32_t at,uint8_t *out,size_t n){Mem *m=src;if(at>=m->length)return 0;if(at+n>m->length)n=m->length-at;memcpy(out,m->data+at,n);return n;}
static Segment segs[8];static int nsegs;
static const Segment *seg_for(void *ctx,int32_t day){for(int i=0;i<nsegs;i++)if(segs[i].day==day)return &segs[i];return 0;}
// A satellite's segments, and its pass blocks.
static SatSegment sats[64];static int nsats;
static const SatSegment *sat_for(void *ctx,int64_t t){for(int i=0;i<nsats;i++)if(t>=sats[i].start&&t<sats[i].start+sats[i].span)return &sats[i];return 0;}
static uint8_t blocks[4][2048];static size_t block_len[4];static int nblocks;
static void pass_for(void *ctx,int64_t t,char out[24]){
  for(int i=0;i<nblocks;i++){const uint8_t *b=blocks[i];const int32_t start=(int32_t)((uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24);
    if(t>=start&&t<start+PASS_BLOCK_SECONDS){pass_line_from(b,block_len[i],t,out);return;}}
  memset(out,0,24);
}
// Counting allocator: the build's peak, as the watch's heap would see it
// (each block with 8 bytes of the allocator's own).
static size_t live,peak;
static void *counted(size_t n){size_t *p=malloc(n+sizeof(size_t));if(!p)return 0;*p=n;live+=n+8;if(live>peak)peak=live;return p+1;}
static void uncounted(void *q){if(!q)return;size_t *p=(size_t *)q-1;live-=*p+8;free(p);}
static void *recounted(void *q,size_t n){if(!q)return counted(n);size_t *p=(size_t *)q-1;const size_t old=*p;p=realloc(p,n+sizeof(size_t));if(!p)return 0;live=live-old+n;if(live>peak)peak=live;*p=n;return p+1;}
static size_t unhex(const char *hex,uint8_t *out,size_t max){size_t n=0;while(hex[0]&&hex[1]&&n<max){unsigned v;sscanf(hex,"%2x",&v);out[n++]=(uint8_t)v;hex+=2;}return n;}

static FILE *out;
static void u8(unsigned v){fputc(v&255,out);}
static void u16(unsigned v){u8(v);u8(v>>8);}
static void i32(int32_t v){uint32_t u=(uint32_t)v;u16(u&65535);u16(u>>16);}
static void f64(double v){uint8_t b[8];memcpy(b,&v,8);fwrite(b,1,8,out);}

int main(int argc,char **argv){
  if(argc<4){fprintf(stderr,"usage: chart_test map.pack figures.bin out.scene < input\n");return 2;}
  size_t n;Mem m,f,tb;m.data=slurp(argv[1],&n);m.length=n;f.data=slurp(argv[2],&n);f.length=n;
  // tables.bin beside figures.bin.
  char tables[1024];snprintf(tables,sizeof tables,"%.*stables.bin",(int)(strrchr(argv[2],'/')?strrchr(argv[2],'/')-argv[2]+1:0),argv[2]);
  tb.data=slurp(tables,&n);tb.length=n;
  if(!m.data||!f.data||!tb.data){fprintf(stderr,"no pack, figures or tables\n");return 2;}
  ChartInput in;memset(&in,0,sizeof in);
  char line[8192],key[32],value[8000];
  while(fgets(line,sizeof line,stdin)){
    line[strcspn(line,"\n")]=0;
    value[0]=0;
    if(sscanf(line,"%31s %7999[^\n]",key,value)<1)continue;
    if(!strcmp(key,"satseg")){uint8_t b[SAT_SEGMENT_BYTES];unhex(value,b,sizeof b);sat_segment_decode(b,&sats[nsats++]);}
    else if(!strcmp(key,"passes")){block_len[nblocks]=unhex(value,blocks[nblocks],sizeof blocks[0]);nblocks++;}
    else if(!strcmp(key,"segment")){uint8_t b[SEG_BYTES];for(int i=0;i<SEG_BYTES;i++){unsigned v;sscanf(value+2*i,"%2x",&v);b[i]=(uint8_t)v;}seg_decode(b,&segs[nsegs++]);}
    else if(!strcmp(key,"body"))in.body=atoi(value);else if(!strcmp(key,"view"))in.view=atoi(value);
    else if(!strcmp(key,"daystart"))in.day_start=atoll(value);else if(!strcmp(key,"dayend"))in.day_end=atoll(value);
    else if(!strcmp(key,"dayhours")){char *p=value;for(int k=0;k<27;k++)in.day_hours[k]=(uint8_t)strtol(p,&p,10);}
    else if(!strcmp(key,"code"))snprintf(in.code,sizeof in.code,"%s",value);else if(!strcmp(key,"plate"))in.plate=atoi(value);
    else if(!strcmp(key,"flag"))in.flag=atoi(value);else if(!strcmp(key,"readout"))in.readout=atoi(value);
    else if(!strcmp(key,"numerals"))in.numerals=atoi(value);else if(!strcmp(key,"zonebody"))in.zone_body=atoi(value);
    else if(!strcmp(key,"tape"))in.tape=atoi(value);else if(!strcmp(key,"minute"))in.minute=atoi(value);
    else if(!strcmp(key,"event")&&in.event_count<16){char name[8]={0};long long t=0;sscanf(value,"%lld %7s",&t,name);in.events[in.event_count].t=t;snprintf(in.events[in.event_count].name,6,"%s",name);in.event_count++;}else if(!strcmp(key,"clock24"))in.clock24=atoi(value);
    else if(!strcmp(key,"start"))in.start=atoll(value);else if(!strcmp(key,"hour"))in.local_hour=atoi(value);
    else if(!strcmp(key,"day"))in.day=atoi(value);else if(!strcmp(key,"month"))in.month=atoi(value);
    else if(!strcmp(key,"year"))in.year=atoi(value);else if(!strcmp(key,"yday"))in.day_of_year=atoi(value);
    else if(!strcmp(key,"home"))in.home=atoi(value);else if(!strcmp(key,"lat"))in.home_lat=strtod(value,0);
    else if(!strcmp(key,"lon"))in.home_lon=strtod(value,0);
    else if(!strcmp(key,"rise"))snprintf(in.rise_left,sizeof in.rise_left,"%s",value);
    else if(!strcmp(key,"set"))snprintf(in.rise_right,sizeof in.rise_right,"%s",value);
  }
  const ChartSources src={.map=mem_read,.map_source=&m,.figures=mem_read,.figure_source=&f,.tables=mem_read,.table_source=&tb,.segment=seg_for,
    .satellite=sat_for,.pass_line=pass_for,.alloc=counted,.release=uncounted,.resize=recounted};
  EnrScene *scene=chart_build(&in,&src);
  if(!scene){fprintf(stderr,"build failed\n");return 1;}
  const EnrScene s=*scene;
  out=fopen(argv[3],"wb");
  fputs("GTS3",out);u16(200);u16(228);u8(s.flags);u8(s.body);u8((uint8_t)s.forward);u8(s.view);i32(s.hour_start);
  for(int k=0;k<9;k++)for(int z=0;z<3;z++)u8(s.zoned[k][z]);
  u8(s.space);u8(s.space_ink);u8(s.screen);u8(s.waterline);u8(s.terminator);u8(s.night_dots);
  for(int k=0;k<5;k++)u8(s.tints[k]);
  for(int k=0;k<2;k++)u8(s.depths[k]);
  for(int y=0;y<228;y++)f64(s.row_cos[y]);
  for(int y=0;y<228;y++)f64(s.row_sin[y]);
  for(int x=0;x<200;x++)f64(s.col_cos[x]);
  for(int x=0;x<200;x++)f64(s.col_sin[x]);
  f64(s.c1x);f64(s.normal_x);f64(s.normal_y);u16((uint16_t)s.zulu_x);u16((uint16_t)s.zulu_baseline);
  {const int16_t v[18]={s.top_x,s.top_baseline,s.height_right,s.height_baseline,s.tape_x0,s.tape_x1,s.tape_baseline,s.tape_lo,s.tape_hi,s.home_x,s.home_y,s.home_box[0],s.home_box[1],s.home_box[2],s.home_box[3],s.callout_left,s.callout_top,s.callout_bottom};
  for(int k=0;k<18;k++)u16((uint16_t)v[k]);}
  fwrite(s.hour_text,1,3,out);u8(s.numerals);u8(s.avoid_count);for(int k=0;k<s.avoid_count;k++)for(int j=0;j<4;j++)u16((uint16_t)s.avoid[k][j]);
  u16((uint16_t)s.c0[0]);u16((uint16_t)s.c0[1]);u16((uint16_t)s.c1[0]);u16((uint16_t)s.c1[1]);
  u8(s.station_count);for(int k=0;k<s.station_count;k++){u16((uint16_t)s.stations[k][0]);u16((uint16_t)s.stations[k][1]);}
  fwrite(s.tape_hour,1,3,out);fwrite(s.tape_next,1,3,out);u8(s.slide_minute);
  u8(s.event_count);for(int k=0;k<s.event_count;k++){const int16_t v[7]={s.events[k].x,s.events[k].y,s.events[k].lx,s.events[k].box[0],s.events[k].box[1],s.events[k].box[2],s.events[k].box[3]};for(int j=0;j<7;j++)u16((uint16_t)v[j]);u8(s.events[k].clear);fwrite(s.events[k].name,1,5,out);}
  for(int k=0;k<60;k++){const EnrMinute *e=&s.minutes[k];for(int j=0;j<3;j++)f64(e->sun[j]);f64(e->mx);f64(e->my);f64(e->moon_fraction);u8(e->waxing);
    fwrite(e->zulu,1,5,out);fwrite(e->minute,1,2,out);fwrite(e->top,1,24,out);u16((uint16_t)e->index);fwrite(e->height,1,8,out);u8(e->circle);}
  u16(s.circle_count);
  for(int k=0;k<s.circle_count;k++){u16(s.circle_n[k]);fwrite(s.circle_px[k],1,2*s.circle_n[k],out);}
  u16(s.track_count);i32(s.track_t0);u16((uint16_t)s.track_step);
  for(int k=0;k<s.track_count;k++){u16((uint16_t)s.track[k].x);u16((uint16_t)s.track[k].y);u8(s.track[k].flags);}
  for(int y=0;y<=228;y++)u16(s.row_offset[y]);
  fwrite(s.runs,1,s.row_offset[228],out);
  fclose(out);
  {int held=0;for(int y=0;y<228;y++){const int ahead=(int)s.row_offset[y+1]-(y+1<228?(y+1)*200:200*228);if(ahead>held)held=ahead;}fprintf(stderr,"queue %d; ",held);}
  fprintf(stderr,"scene %u bytes, runs %u bytes, peak %u bytes, kept %u bytes\n",(unsigned)sizeof s,(unsigned)s.row_offset[228],(unsigned)peak,(unsigned)live);
  return 0;
}
