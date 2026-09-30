// See watch_data.h.
#include "watch_data.h"
#include "chart.h"
#include "segments.h"
#include "map_pack.h"
#include "passes.h"

#define SETTINGS_KEY 1
#define SEGMENT_KEY 100        // + UTC day % 64
#define RISE_SET_KEY 200       // + local date % 64
#define RING 64
#define RISE_SET_BYTES 12
// A fast satellite's segments are an hour each: three days of them and the
// hour before need more than 64.
#define SAT_KEY 300            // + (start / span) % 96
#define SAT_RING 96
#define PASS_KEY 400           // + (block / 12 h) % 8

void settings_load(WatchSettings *s){
  // The defaults the phone's settings also start from, without a home until
  // the phone sends one.
  const WatchSettings defaults={2,BODY_SUN,0,1,1,0,0,0,0,0,0,""};
  if(persist_read_data(SETTINGS_KEY,s,sizeof *s)!=(int)sizeof *s||s->version!=2)*s=defaults;
}
void settings_save(const WatchSettings *s){persist_write_data(SETTINGS_KEY,s,sizeof *s);}

static int32_t le32(const uint8_t *p){return (int32_t)((uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24);}
static uint32_t ring(int32_t v){return (uint32_t)(((v%RING)+RING)%RING);}
void segments_store(const uint8_t *b,size_t n){
  for(size_t at=0;at+SEG_WATCH_BYTES<=n;at+=SEG_WATCH_BYTES)persist_write_data(SEGMENT_KEY+ring(le32(b+at)),b+at,SEG_WATCH_BYTES);
}
void rise_sets_store(const uint8_t *b,size_t n){
  for(size_t at=0;at+RISE_SET_BYTES<=n;at+=RISE_SET_BYTES)persist_write_data(RISE_SET_KEY+ring(le32(b+at)),b+at,RISE_SET_BYTES);
}
void sat_segments_store(const uint8_t *b,size_t n){
  for(size_t at=0;at+SAT_SEGMENT_BYTES<=n;at+=SAT_SEGMENT_BYTES){
    const int32_t start=le32(b+at+4),span=le32(b+at+8);
    if(span>0)persist_write_data(SAT_KEY+(uint32_t)(((start/span)%SAT_RING+SAT_RING)%SAT_RING),b+at,SAT_SEGMENT_BYTES);
  }
}
void pass_blocks_store(const uint8_t *b,size_t n){
  if(n<5||n>256)return;
  persist_write_data(PASS_KEY+(uint32_t)((le32(b)/PASS_BLOCK_SECONDS)%8),b,n);
}
// The segment holding t: satellites' segments span an hour or six.
static bool sat_segment_load(int32_t norad,int64_t t,SatSegment *seg){
  static const int32_t spans[2]={3600,21600};
  for(int k=0;k<2;k++){
    uint8_t b[SAT_SEGMENT_BYTES];const int32_t start=(int32_t)(t/spans[k]*spans[k]);
    if(persist_read_data(SAT_KEY+(uint32_t)(((start/spans[k])%SAT_RING+SAT_RING)%SAT_RING),b,sizeof b)!=(int)sizeof b)continue;
    if(le32(b)==norad&&le32(b+4)==start&&le32(b+8)==spans[k])return sat_segment_decode(b,seg);
  }
  return false;
}
int64_t sat_segments_missing(int32_t norad,int64_t from,int32_t seconds){
  SatSegment seg;
  for(int64_t t=from;t<from+seconds;){if(!sat_segment_load(norad,t,&seg))return t;t=seg.start+(int64_t)seg.span;}
  return -1;
}
bool pass_block_known(int64_t t){
  uint8_t b[4];const int64_t block=t/PASS_BLOCK_SECONDS*PASS_BLOCK_SECONDS;
  return persist_read_data(PASS_KEY+(uint32_t)((block/PASS_BLOCK_SECONDS)%8),b,4)==4&&le32(b)==block;
}
static bool segment_load(int32_t day,Segment *seg){
  uint8_t b[SEG_WATCH_BYTES];
  if(persist_read_data(SEGMENT_KEY+ring(day),b,sizeof b)!=(int)sizeof b||le32(b)!=day)return false;
  return seg_decode_watch(b,seg);
}
int32_t segments_missing(int32_t from,int days){
  uint8_t b[4];
  for(int32_t d=from;d<from+days;d++)if(persist_read_data(SEGMENT_KEY+ring(d),b,4)!=4||le32(b)!=d)return d;
  return -1;
}
bool rise_set_known(int32_t date){
  uint8_t b[4];
  return persist_read_data(RISE_SET_KEY+ring(date),b,4)==4&&le32(b)==date;
}
// Days since 1970-01-01 of a proleptic Gregorian date (Howard Hinnant's
// days_from_civil).
int32_t civil_date(int y,int m,int d){
  y-=m<=2;const int era=(y>=0?y:y-399)/400;const unsigned yoe=(unsigned)(y-era*400);
  const unsigned doy=(153*(m+(m>2?-3:9))+2)/5+d-1,doe=yoe*365+yoe/4-yoe/100+doy;
  return era*146097+(int32_t)doe-719468;
}
// renderEnroute's riseText(): "HOM SR 0650" and "SS 1841" (MR and MS for
// the Moon), with ---- for a rise or set that doesn't happen that day.
static void rise_text(const uint8_t *r,bool moon,char *left,char *right){
  const int a=moon?2:0;
  const char *labels[4]={"SR","SS","MR","MS"};
  for(int k=0;k<2;k++){
    const unsigned v=(unsigned)(r[4+2*(a+k)]|r[5+2*(a+k)]<<8);char *p=k?right:left;
    if(!k){memcpy(p,"HOM ",4);p+=4;}
    memcpy(p,labels[a+k],2);p+=2;*p++=' ';
    if(v==0xFFFF){memcpy(p,"----",4);p+=4;}
    else{const unsigned h=v/60,m=v%60;*p++=(char)('0'+h/10);*p++=(char)('0'+h%10);*p++=(char)('0'+m/10);*p++=(char)('0'+m%10);}
    *p=0;
  }
}

// The segments and pass blocks a build needs, read once from storage.
typedef struct {Segment seg[3];int n;SatSegment sat[4];int nsat;uint8_t pass[2][256];int pass_len[2];} Days;
static const Segment *segment_for(void *ctx,int32_t day){Days *d=ctx;for(int i=0;i<d->n;i++)if(d->seg[i].day==day)return &d->seg[i];return NULL;}
static const SatSegment *sat_for(void *ctx,int64_t t){Days *d=ctx;for(int i=0;i<d->nsat;i++)if(t>=d->sat[i].start&&t<d->sat[i].start+d->sat[i].span)return &d->sat[i];return NULL;}
static void pass_for(void *ctx,int64_t t,char out[24]){
  Days *d=ctx;
  for(int i=0;i<2;i++)if(d->pass_len[i]>=5&&t>=le32(d->pass[i])&&t<le32(d->pass[i])+PASS_BLOCK_SECONDS){pass_line_from(d->pass[i],(size_t)d->pass_len[i],t,out);return;}
  memset(out,0,24);
}
static size_t resource_read(void *source,uint32_t at,uint8_t *out,size_t n){
  const ResHandle h=*(ResHandle *)source;const size_t size=resource_size(h);
  if(at>=size)return 0;
  if(at+n>size)n=size-at;
  return resource_load_byte_range(h,at,out,n);
}

static Days *s_days;
void local_chart_done(void){free(s_days);s_days=NULL;}
ChartBuild *local_chart(time_t now,const WatchSettings *s){
  if(s->body>BODY_SATELLITE||(s->body==BODY_SATELLITE&&s->view==VIEW_DAY))return NULL;
  const struct tm *lt=localtime(&now);
  ChartInput in;memset(&in,0,sizeof in);
  const bool sat=s->body==BODY_SATELLITE;
  in.body=sat&&s->station?3:s->body;in.view=sat&&s->view==VIEW_WORLD;memcpy(in.code,s->code,sizeof in.code);in.plate=s->plate;in.flag=s->flag;in.clock24=s->clock24;
  in.start=(int64_t)now-(lt->tm_min*60+lt->tm_sec);in.local_hour=lt->tm_hour;
  in.day=lt->tm_mday;in.month=lt->tm_mon+1;in.year=lt->tm_year+1900;in.day_of_year=lt->tm_yday+1;
  in.home=s->home;in.home_lat=s->lat100/100.0;in.home_lon=s->lon100/100.0;
  if(s->home&&s->body!=BODY_SATELLITE){
    uint8_t r[RISE_SET_BYTES];const int32_t date=civil_date(in.year,in.month,in.day);
    if(persist_read_data(RISE_SET_KEY+ring(date),r,sizeof r)==(int)sizeof r&&le32(r)==date)rise_text(r,s->body==BODY_MOON,in.rise_left,in.rise_right);
  }
  // Held on the heap while the build runs (local_chart_done frees it).
  local_chart_done();
  s_days=malloc(sizeof(Days));if(!s_days)return NULL;
  Days *const d_=s_days;
  #define days (*d_)
  days.n=days.nsat=0;days.pass_len[0]=days.pass_len[1]=0;
  for(int64_t d=(in.start-2400)/86400;d<=(in.start+6000)/86400&&days.n<3;d++)if(segment_load((int32_t)d,&days.seg[days.n]))days.n++;else {local_chart_done();return NULL;}
  if(sat){
    // A satellite: its segments over the track, and home's passes for the
    // hour.
    const int lead=in.view?1200:2400;
    for(int64_t t=in.start-lead;t<=in.start+3600+lead&&days.nsat<4;){
      if(!sat_segment_load(s->norad,t,&days.sat[days.nsat])){local_chart_done();return NULL;}
      t=days.sat[days.nsat].start+(int64_t)days.sat[days.nsat].span;days.nsat++;
    }
    for(int k=0;k<2;k++){
      const int64_t block=(in.start+k*3599)/PASS_BLOCK_SECONDS*PASS_BLOCK_SECONDS;
      if(k&&block==le32(days.pass[0]))break;
      const int n=persist_read_data(PASS_KEY+(uint32_t)((block/PASS_BLOCK_SECONDS)%8),days.pass[k],256);
      if(n>=5&&le32(days.pass[k])==block)days.pass_len[k]=n;
    }
  }
  // The sources stay valid while the build runs.
  static ResHandle map,figures;map=resource_get_handle(RESOURCE_ID_MAP_PACK);figures=resource_get_handle(RESOURCE_ID_FIGURES);
  const ChartSources src={.map=resource_read,.map_source=&map,.figures=resource_read,.figure_source=&figures,
    .segment=segment_for,.segment_context=d_,.satellite=sat_for,.satellite_context=d_,
    .pass_line=pass_for,.pass_context=d_,.alloc=malloc,.release=free,.resize=realloc};
  #undef days
  ChartBuild *build=chart_begin(&in,&src);
  if(!build){APP_LOG(APP_LOG_LEVEL_ERROR,"No chart started (%u bytes free)",(unsigned)heap_bytes_free());local_chart_done();}
  return build;
}
