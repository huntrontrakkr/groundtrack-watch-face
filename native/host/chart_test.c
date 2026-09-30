// Builds an hour's scene with the watch's chart builder and writes it in the
// phone's scene format (src/native-scene.js), for byte-for-byte comparison.
//   chart_test <map.pack> <out.scene>   with the input on stdin:
//   key value lines (body, plate, flag, clock24, start, hour, day, month,
//   year, yday, home, lat, lon, rise, set) and "segment <hex>" lines.
#define _POSIX_C_SOURCE 200809L
#include "../src/c/chart.h"
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

static FILE *out;
static void u8(unsigned v){fputc(v&255,out);}
static void u16(unsigned v){u8(v);u8(v>>8);}
static void i32(int32_t v){uint32_t u=(uint32_t)v;u16(u&65535);u16(u>>16);}
static void f64(double v){uint8_t b[8];memcpy(b,&v,8);fwrite(b,1,8,out);}

int main(int argc,char **argv){
  if(argc<3){fprintf(stderr,"usage: chart_test map.pack out.scene < input\n");return 2;}
  size_t n;Mem m;m.data=slurp(argv[1],&n);m.length=n;if(!m.data){fprintf(stderr,"no pack\n");return 2;}
  MapPack pack;if(!map_pack_open(&pack,mem_read,&m)){fprintf(stderr,"bad pack\n");return 2;}
  ChartInput in;memset(&in,0,sizeof in);
  char line[4096],key[32],value[2048];
  while(fgets(line,sizeof line,stdin)){
    line[strcspn(line,"\n")]=0;
    if(sscanf(line,"%31s %2047[^\n]",key,value)<1)continue;
    if(!strcmp(key,"segment")){uint8_t b[SEG_BYTES];for(int i=0;i<SEG_BYTES;i++){unsigned v;sscanf(value+2*i,"%2x",&v);b[i]=(uint8_t)v;}seg_decode(b,&segs[nsegs++]);}
    else if(!strcmp(key,"body"))in.body=atoi(value);else if(!strcmp(key,"plate"))in.plate=atoi(value);
    else if(!strcmp(key,"flag"))in.flag=atoi(value);else if(!strcmp(key,"clock24"))in.clock24=atoi(value);
    else if(!strcmp(key,"start"))in.start=atoll(value);else if(!strcmp(key,"hour"))in.local_hour=atoi(value);
    else if(!strcmp(key,"day"))in.day=atoi(value);else if(!strcmp(key,"month"))in.month=atoi(value);
    else if(!strcmp(key,"year"))in.year=atoi(value);else if(!strcmp(key,"yday"))in.day_of_year=atoi(value);
    else if(!strcmp(key,"home"))in.home=atoi(value);else if(!strcmp(key,"lat"))in.home_lat=strtod(value,0);
    else if(!strcmp(key,"lon"))in.home_lon=strtod(value,0);
    else if(!strcmp(key,"rise"))snprintf(in.rise_left,sizeof in.rise_left,"%s",value);
    else if(!strcmp(key,"set"))snprintf(in.rise_right,sizeof in.rise_right,"%s",value);
  }
  static MapWork work;ChartWork *wk=malloc(chart_work_size());
  static EnrScene s;static uint8_t classes[200*228];static EnrPoint points[CHART_TRACK_MAX];
  if(!chart_build(&in,&pack,&work,seg_for,0,wk,&s,classes,points)||!chart_runs(classes,&s,malloc)){fprintf(stderr,"build failed\n");return 1;}
  out=fopen(argv[2],"wb");
  fputs("GTS2",out);u16(200);u16(228);u8(s.flags);u8(s.body);u8((uint8_t)s.forward);u8(0);i32(s.hour_start);
  for(int k=0;k<9;k++)for(int z=0;z<3;z++)u8(s.zoned[k][z]);
  u8(s.space);u8(s.space_ink);u8(s.screen);u8(s.waterline);u8(s.terminator);u8(s.night_dots);
  for(int k=0;k<5;k++)u8(s.tints[k]);
  for(int k=0;k<2;k++)u8(s.depths[k]);
  for(int y=0;y<228;y++)f64(s.row_cos[y]);
  for(int y=0;y<228;y++)f64(s.row_sin[y]);
  for(int x=0;x<200;x++)f64(s.col_cos[x]);
  for(int x=0;x<200;x++)f64(s.col_sin[x]);
  f64(s.c1x);f64(s.normal_x);f64(s.normal_y);u16((uint16_t)s.zulu_x);u16((uint16_t)s.zulu_baseline);
  for(int k=0;k<60;k++){const EnrMinute *e=&s.minutes[k];for(int j=0;j<3;j++)f64(e->sun[j]);f64(e->mx);f64(e->my);f64(e->moon_fraction);u8(e->waxing);
    fwrite(e->zulu,1,5,out);fwrite(e->minute,1,2,out);fwrite(e->top,1,24,out);}
  u16(s.track_count);
  for(int k=0;k<s.track_count;k++){f64(s.track[k].x);f64(s.track[k].y);i32(s.track[k].seconds);u8(s.track[k].hour);}
  for(int y=0;y<=228;y++)u16(s.row_offset[y]);
  fwrite(s.runs,1,s.row_offset[228],out);
  fclose(out);
  fprintf(stderr,"chart work %u bytes, scene %u bytes, runs %u bytes\n",chart_work_size(),(unsigned)sizeof s,(unsigned)s.row_offset[228]);
  return 0;
}
