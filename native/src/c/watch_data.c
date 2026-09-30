// See watch_data.h.
#include "watch_data.h"
#include "chart.h"
#include "segments.h"
#include "map_pack.h"

#define SETTINGS_KEY 1
#define SEGMENT_KEY 100        // + UTC day % 64
#define RISE_SET_KEY 200       // + local date % 64
#define RING 64
#define RISE_SET_BYTES 12

void settings_load(WatchSettings *s){
  // The defaults the phone's settings also start from, without a home until
  // the phone sends one.
  const WatchSettings defaults={1,BODY_SUN,0,1,1,0,0,0};
  if(persist_read_data(SETTINGS_KEY,s,sizeof *s)!=(int)sizeof *s||s->version!=1)*s=defaults;
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

// The segments a build needs, read once from storage.
typedef struct {Segment seg[3];int n;} Days;
static const Segment *segment_for(void *ctx,int32_t day){Days *d=ctx;for(int i=0;i<d->n;i++)if(d->seg[i].day==day)return &d->seg[i];return NULL;}
static size_t resource_read(void *source,uint32_t at,uint8_t *out,size_t n){
  const ResHandle h=*(ResHandle *)source;const size_t size=resource_size(h);
  if(at>=size)return 0;
  if(at+n>size)n=size-at;
  return resource_load_byte_range(h,at,out,n);
}

ChartBuild *local_chart(time_t now,const WatchSettings *s){
  if(s->body>BODY_MOON)return NULL;
  const struct tm *lt=localtime(&now);
  ChartInput in;memset(&in,0,sizeof in);
  in.body=s->body;in.plate=s->plate;in.flag=s->flag;in.clock24=s->clock24;
  in.start=(int64_t)now-(lt->tm_min*60+lt->tm_sec);in.local_hour=lt->tm_hour;
  in.day=lt->tm_mday;in.month=lt->tm_mon+1;in.year=lt->tm_year+1900;in.day_of_year=lt->tm_yday+1;
  in.home=s->home;in.home_lat=s->lat100/100.0;in.home_lon=s->lon100/100.0;
  if(s->home){
    uint8_t r[RISE_SET_BYTES];const int32_t date=civil_date(in.year,in.month,in.day);
    if(persist_read_data(RISE_SET_KEY+ring(date),r,sizeof r)==(int)sizeof r&&le32(r)==date)rise_text(r,s->body==BODY_MOON,in.rise_left,in.rise_right);
  }
  static Days days;days.n=0;
  for(int64_t d=(in.start-2400)/86400;d<=(in.start+6000)/86400&&days.n<3;d++)if(segment_load((int32_t)d,&days.seg[days.n]))days.n++;else return NULL;
  // The sources stay valid while the build runs.
  static ResHandle map,figures;map=resource_get_handle(RESOURCE_ID_MAP_PACK);figures=resource_get_handle(RESOURCE_ID_FIGURES);
  const ChartSources src={resource_read,&map,resource_read,&figures,segment_for,&days,malloc,free};
  ChartBuild *build=chart_begin(&in,&src);
  if(!build)APP_LOG(APP_LOG_LEVEL_ERROR,"No chart started (%u bytes free)",(unsigned)heap_bytes_free());
  return build;
}
