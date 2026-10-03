// See core_api.h. The input text is the phone's for an hour: settings, the
// local hour and date, home and its rise and set, and the Sun, Moon and
// satellite segments, as tools/chart-input.mjs writes it.
#include "core_api.h"
#include "../src/c/chart.h"
#include "../src/c/passes.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stddef.h>

typedef struct {const uint8_t *data;size_t length;} Mem;
static Mem s_source[5];
static size_t mem_read(void *src,uint32_t at,uint8_t *out,size_t n){Mem *m=src;if(at>=m->length)return 0;if(at+n>m->length)n=m->length-at;memcpy(out,m->data+at,n);return n;}
static Segment s_segs[8];static int s_nsegs;
static const Segment *seg_for(void *ctx,int32_t day){for(int i=0;i<s_nsegs;i++)if(s_segs[i].day==day)return &s_segs[i];return 0;}
static SatSegment s_sats[64];static int s_nsats;
static const SatSegment *sat_for(void *ctx,int64_t t){for(int i=0;i<s_nsats;i++)if(t>=s_sats[i].start&&t<s_sats[i].start+s_sats[i].span)return &s_sats[i];return 0;}
static uint8_t s_blocks[4][2048];static size_t s_block_len[4];static int s_nblocks;
static void pass_for(void *ctx,int64_t t,char out[24]){
  for(int i=0;i<s_nblocks;i++){const uint8_t *b=s_blocks[i];const int32_t start=(int32_t)((uint32_t)b[0]|(uint32_t)b[1]<<8|(uint32_t)b[2]<<16|(uint32_t)b[3]<<24);
    if(t>=start&&t<start+PASS_BLOCK_SECONDS){pass_line_from(b,s_block_len[i],t,out);return;}}
  memset(out,0,24);
}
static size_t unhex(const char *hex,uint8_t *out,size_t max){size_t n=0;while(hex[0]&&hex[1]&&n<max){unsigned v;sscanf(hex,"%2x",&v);out[n++]=(uint8_t)v;hex+=2;}return n;}
static EnrScene *s_scene[CORE_SLOTS];static char s_why[64];
static void *(*s_alloc)(size_t)=malloc;static void (*s_release)(void *)=free;static void *(*s_resize)(void *,size_t)=realloc;
void core_allocator(void *(*alloc)(size_t),void (*release)(void *),void *(*resize)(void *,size_t)){s_alloc=alloc;s_release=release;s_resize=resize;}

void *core_alloc(size_t n){return malloc(n);}
void core_free(void *p){free(p);}
void core_source(int kind,const uint8_t *data,size_t length){if(kind>=0&&kind<5){s_source[kind].data=data;s_source[kind].length=length;}}
const char *core_failure(void){return s_why;}
const EnrScene *core_scene(int slot){return slot>=0&&slot<CORE_SLOTS?s_scene[slot]:NULL;}

int core_build(const char *text,size_t length,int slot){
  if(slot<0||slot>=CORE_SLOTS)return 0;
  if(s_scene[slot]){enr_free(s_scene[slot],s_release);s_release(s_scene[slot]);s_scene[slot]=NULL;}
  s_nsegs=s_nsats=s_nblocks=0;s_why[0]=0;
  ChartInput in;memset(&in,0,sizeof in);
  char key[32];static char value[8000];
  for(size_t at=0;at<length;){
    size_t end=at;while(end<length&&text[end]!='\n')end++;
    const size_t n=end-at<sizeof value-1?end-at:sizeof value-1;
    char line[sizeof value];memcpy(line,text+at,n);line[n]=0;at=end+1;
    value[0]=0;
    if(sscanf(line,"%31s %7999[^\n]",key,value)<1)continue;
    if(!strcmp(key,"satseg")){if(s_nsats<64){uint8_t b[SAT_SEGMENT_BYTES];unhex(value,b,sizeof b);sat_segment_decode(b,&s_sats[s_nsats++]);}}
    else if(!strcmp(key,"passes")){if(s_nblocks<4){s_block_len[s_nblocks]=unhex(value,s_blocks[s_nblocks],sizeof s_blocks[0]);s_nblocks++;}}
    else if(!strcmp(key,"segment")){if(s_nsegs<8){uint8_t b[SEG_BYTES];unhex(value,b,sizeof b);seg_decode(b,&s_segs[s_nsegs++]);}}
    else if(!strcmp(key,"fuller"))in.fuller=atoi(value);
    else if(!strcmp(key,"body"))in.body=atoi(value);else if(!strcmp(key,"view"))in.view=atoi(value);
    else if(!strcmp(key,"daystart"))in.day_start=atoll(value);else if(!strcmp(key,"dayend"))in.day_end=atoll(value);
    else if(!strcmp(key,"dayhours")){char *p=value;for(int k=0;k<27;k++)in.day_hours[k]=(uint8_t)strtol(p,&p,10);}
    else if(!strcmp(key,"code"))snprintf(in.code,sizeof in.code,"%s",value);else if(!strcmp(key,"plate"))in.plate=atoi(value);
    else if(!strcmp(key,"flag"))in.flag=atoi(value);else if(!strcmp(key,"readout"))in.readout=atoi(value);
    else if(!strcmp(key,"numerals"))in.numerals=atoi(value);else if(!strcmp(key,"zonebody"))in.zone_body=atoi(value);
    else if(!strcmp(key,"tape"))in.tape=atoi(value);
    
    else if(!strcmp(key,"transfer"))in.transfer=atoi(value);else if(!strcmp(key,"also"))in.also=atoi(value);else if(!strcmp(key,"bare"))in.bare=atoi(value);else if(!strcmp(key,"legend"))in.legend=atoi(value);else if(!strcmp(key,"figures"))in.figures=atoi(value);else if(!strcmp(key,"corner"))in.corner=atoi(value);else if(!strcmp(key,"wday"))in.weekday=atoi(value);
    else if(!strcmp(key,"event")&&in.event_count<16){char name[8]={0};long long t=0;sscanf(value,"%lld %7s",&t,name);in.events[in.event_count].t=t;snprintf(in.events[in.event_count].name,6,"%s",name);in.event_count++;}
    else if(!strcmp(key,"clock24"))in.clock24=atoi(value);
    else if(!strcmp(key,"start"))in.start=atoll(value);else if(!strcmp(key,"hour"))in.local_hour=atoi(value);
    else if(!strcmp(key,"day"))in.day=atoi(value);else if(!strcmp(key,"month"))in.month=atoi(value);
    else if(!strcmp(key,"year"))in.year=atoi(value);else if(!strcmp(key,"yday"))in.day_of_year=atoi(value);
    else if(!strcmp(key,"home"))in.home=atoi(value);else if(!strcmp(key,"lat"))in.home_lat=strtod(value,0);
    else if(!strcmp(key,"lon"))in.home_lon=strtod(value,0);
    else if(!strcmp(key,"rise"))snprintf(in.rise_left,sizeof in.rise_left,"%s",value);
    else if(!strcmp(key,"set"))snprintf(in.rise_right,sizeof in.rise_right,"%s",value);
  }
  const ChartSources src={.map=mem_read,.map_source=&s_source[CORE_MAP],.figures=mem_read,.figure_source=&s_source[CORE_FIGURES],.tables=mem_read,.table_source=&s_source[CORE_TABLES],
    .grids=s_source[CORE_GRIDS].data?mem_read:NULL,.grid_source=&s_source[CORE_GRIDS],.land=s_source[CORE_LAND].data?mem_read:NULL,.land_source=&s_source[CORE_LAND],
    .segment=seg_for,.satellite=sat_for,.pass_line=pass_for,.alloc=s_alloc,.release=s_release,.resize=s_resize};
  s_scene[slot]=chart_build(&in,&src);
  if(!s_scene[slot]){snprintf(s_why,sizeof s_why,"%s",chart_failure());return 0;}
  return 1;
}
int core_render(int slot,int minute,uint8_t *frame){const EnrScene *s=core_scene(slot);if(!s)return -1;enr_render(s,minute,frame,ENR_W);return 0;}
int core_render_update(int slot,int from,int minute,uint8_t *frame){const EnrScene *s=core_scene(slot);if(!s)return -1;return enr_render_update(s,from,minute,frame,ENR_W);}
// The scene's layout, in the order src/core.js reads it.
int core_layout(int32_t *out,int max){
  const int32_t v[]={
    (int32_t)sizeof(EnrScene),(int32_t)sizeof(EnrPoint),(int32_t)sizeof(EnrMinute),
    offsetof(EnrScene,flags),offsetof(EnrScene,body),offsetof(EnrScene,view),offsetof(EnrScene,forward),offsetof(EnrScene,hour_start),offsetof(EnrScene,heavy),offsetof(EnrScene,fuller),
    offsetof(EnrScene,zulu_x),offsetof(EnrScene,zulu_baseline),offsetof(EnrScene,top_x),offsetof(EnrScene,top_baseline),offsetof(EnrScene,height_right),offsetof(EnrScene,height_baseline),
    offsetof(EnrScene,tape_x0),offsetof(EnrScene,tape_x1),offsetof(EnrScene,tape_baseline),offsetof(EnrScene,tape_lo),offsetof(EnrScene,tape_hi),
    offsetof(EnrScene,home_x),offsetof(EnrScene,home_y),offsetof(EnrScene,home_box),offsetof(EnrScene,mark_count),
    offsetof(EnrScene,callout_left),offsetof(EnrScene,callout_top),offsetof(EnrScene,callout_bottom),offsetof(EnrScene,hour_text),offsetof(EnrScene,numerals),
    offsetof(EnrScene,c0),offsetof(EnrScene,c1),offsetof(EnrScene,station_count),offsetof(EnrScene,stations),offsetof(EnrScene,station_table),offsetof(EnrScene,fig_box),
    offsetof(EnrScene,tape_hour),offsetof(EnrScene,tape_next),
    offsetof(EnrScene,event_count),offsetof(EnrScene,events),(int32_t)sizeof(s_scene[0]->events[0]),
    offsetof(EnrScene,minutes),offsetof(EnrMinute,mx),offsetof(EnrMinute,my),offsetof(EnrMinute,zulu),offsetof(EnrMinute,minute),offsetof(EnrMinute,top),offsetof(EnrMinute,index),offsetof(EnrMinute,corner),
    offsetof(EnrScene,track_count),offsetof(EnrScene,track_t0),offsetof(EnrScene,track_step),offsetof(EnrScene,track),
    (int32_t)sizeof(enr_real),offsetof(EnrFuller,tile_count),offsetof(EnrFuller,tile_face),offsetof(EnrScene,counter)};
  const int n=(int)(sizeof v/sizeof v[0]);
  for(int i=0;i<n&&i<max;i++)out[i]=v[i];
  return n;
}
void core_measure(int slot,int minute,int part,int16_t *out){const EnrScene *s=core_scene(slot);if(s)enr_measure(s,minute,part,out);else out[0]=out[1]=out[2]=out[3]=0;}
void core_text_box(const char *text,int n,int x,int baseline,int16_t *out){enr_text_box(text,n,x,baseline,out);}
void core_power(int percent,int state){enr_power(percent,state);}
void core_status(const char *text,int n){char t[8];int k=0;for(;k<n&&k<7;k++)t[k]=text[k];t[k]=0;enr_status(t);}
int core_text_width(const char *text,int n){return enr_text_width(text,n);}
int core_class(int slot,int x,int y){const EnrScene *s=core_scene(slot);return s?enr_class(s,x,y):-1;}
int core_zone(int slot,int minute,int x,int y){const EnrScene *s=core_scene(slot);return s?enr_zone(s,minute,x,y):-1;}
