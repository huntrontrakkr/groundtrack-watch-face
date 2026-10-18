// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The watch draws each hour's chart itself, from its own map (a resource)
// and the Sun, Moon and satellite segments the phone sends days or weeks
// ahead: the phone isn't needed hour to hour. Each minute it draws what
// changed with the native core. Its animations (effects.c) are drawn over
// the minute on the screen and leave it as it was. Until a chart covers the
// current hour, the face says so plainly rather than showing a stale one.
#include "build_size.h"
#include <pebble.h>
#include "enroute_core.h"
#include "departure_font.h"
#include "fmath.h"
#include "watch_data.h"
#include "chart.h"
#include "generated/plates.h"

// Ask again when a request has gone unanswered this long, and twice as
// long after each that didn't bring what was missing (to 27 minutes: the
// phone may have no orbit to give for a while). Requests are only made on
// the minute tick, so this also bounds them to one a minute.
#define RETRY_SECONDS 50
// Keep segments this many days ahead; ask for more when fewer are left.
#define SEGMENT_DAYS 10
// A message carries at most 2,000 bytes of payload; this leaves room for the
// dictionary's own framing.
#define INBOX_SIZE 2100

// An animation running (its frames drawn over the minute on the screen),
// and the face going to the next satellite (below).
static bool s_fx_on,s_switching;
static void switch_end(void);
#if GT_BLOBS
// The chart builder and the minute renderer are code blobs (blob.h; GT_BLOBS
// is the watch app's build, not the host's), loaded while each is wanted: the builder for a build (the
// renderer let go first), the renderer the rest of the time. The core's
// calls below go through them; what the renderer is told (its status and
// the battery) is kept here for it, and told again when it is loaded.
#include "blob.h"
static const GtBuilderApi *s_builder;static uint8_t *s_builder_mem;
static const GtRendererApi *s_renderer;static uint8_t *s_renderer_mem;
static const uint8_t *s_font;static char s_enr_status[16];static int s_enr_power[2]={100,0};
static unsigned s_chart_failed;
static const void *blob_load(uint32_t id,uint8_t **mem){
  const ResHandle h=resource_get_handle(id);GtBlobHeader hd;*mem=NULL;
  if(resource_load_byte_range(h,0,(uint8_t *)&hd,sizeof hd)!=sizeof hd||hd.magic!=GT_BLOB_MAGIC)return NULL;
  const uint32_t n=hd.image+hd.bss;
  *mem=malloc(n+4);if(!*mem)return NULL;                 // (the heap gives 4-byte alignment; the code was linked for 8)
  uint8_t *code=(uint8_t *)(((uintptr_t)*mem+7)&~(uintptr_t)7);
  if(resource_load_byte_range(h,sizeof hd,code,hd.image)!=hd.image)goto fail;
  memset(code+hd.image,0,hd.bss);
  uint16_t at[32];                                       // (the relocations, a few at a time: the stack is small)
  for(uint32_t i=0;i<hd.relocs;i+=32){
    const uint32_t k=hd.relocs-i<32?hd.relocs-i:32;
    if(resource_load_byte_range(h,sizeof hd+hd.image+2*i,(uint8_t *)at,2*k)!=2*k)goto fail;
    for(uint32_t j=0;j<k;j++)((uint32_t *)code)[at[j]]+=(uint32_t)(uintptr_t)code;
  }
  memory_cache_flush(code,n);
  {const uint32_t *api=(const uint32_t *)(code+hd.api);if(api[0]==GT_BLOB_MAGIC&&api[1]==GT_BLOB_LAYOUT)return api;}
fail:
  free(*mem);*mem=NULL;return NULL;
}
static bool renderer_load(void){
  if(s_renderer)return true;
  if(!(s_renderer=blob_load(RESOURCE_ID_RENDERER_CODE,&s_renderer_mem)))return false;
  s_renderer->init(malloc,free,s_font);s_renderer->status(s_enr_status);s_renderer->power(s_enr_power[0],s_enr_power[1]);
  return true;
}
static void renderer_let_go(void){free(s_renderer_mem);s_renderer_mem=NULL;s_renderer=NULL;}
static void builder_let_go(void){free(s_builder_mem);s_builder_mem=NULL;s_builder=NULL;}
ChartBuild *gt_chart_begin(const ChartInput *in,const ChartSources *src){
  // (An animation's memory is the renderer's: let go with it, the minute
  // drawn whole after.)
  if(s_fx_on&&s_renderer){s_renderer->fx_end(NULL,0);s_fx_on=false;}
  renderer_let_go();
  if(!s_builder&&(s_builder=blob_load(RESOURCE_ID_BUILDER_CODE,&s_builder_mem)))s_builder->init(malloc,free,s_font);
  if(!s_builder){s_chart_failed=1;return NULL;}
  ChartBuild *b=s_builder->begin(in,src);
  if(!b){s_chart_failed=*s_builder->failed_at;builder_let_go();}
  return b;
}
static int gt_chart_step(ChartBuild *b){const int r=s_builder->step(b);if(r<0)s_chart_failed=*s_builder->failed_at;return r;}
static EnrScene *gt_chart_finish(ChartBuild *b){EnrScene *s=s_builder->finish(b);s_chart_failed=*s_builder->failed_at;builder_let_go();return s;}
static void gt_chart_abort(ChartBuild *b){s_builder->abort(b);builder_let_go();}
#define enr_render_update(...) (renderer_load()?s_renderer->render_update(__VA_ARGS__):-1)
#define enr_free(s,r) do{if(renderer_load())s_renderer->free(s,r);}while(0)
#define enr_fx_begin(...) (renderer_load()&&s_renderer->fx_begin(__VA_ARGS__))
#define enr_fx_frame(f,st) (s_renderer?s_renderer->fx_frame((f),(st)):0)
#define enr_fx_end(f,st) do{if(s_renderer)s_renderer->fx_end((f),(st));}while(0)
#define enr_fx_aos(...) (renderer_load()&&s_renderer->fx_aos(__VA_ARGS__))
#define enr_status(t) do{strncpy(s_enr_status,(t),sizeof s_enr_status-1);if(s_renderer)s_renderer->status(s_enr_status);}while(0)
#define enr_power(p,st) do{s_enr_power[0]=(p);s_enr_power[1]=(st);if(s_renderer)s_renderer->power((p),(st));}while(0)
#define enr_font_load(f) (s_font=(f))
#define chart_step(b) gt_chart_step(b)
#define chart_finish(b) gt_chart_finish(b)
#define chart_abort(b) gt_chart_abort(b)
#define chart_failed_at s_chart_failed
#endif

typedef struct {EnrScene *scene;} Chart;

static Window *s_window;
static Layer *s_layer;
static WatchSettings s_settings;
static Chart s_now;                // this hour's chart
static time_t s_data_asked_at;     // when segments were last asked for
static uint8_t s_data_tries;       // requests since the data was last whole
static char s_status[24];          // why there is no chart, if known
static bool s_status_phone;        // the phone's word (it stands until data comes)
static ChartBuild *s_build;        // a chart being built
static AppTimer *s_build_timer;    // its next slice
static int s_zone;                 // the time zone the chart was built in
// What the screen holds, so a minute tick can draw only what changed (as
// Dymaxion's minute_redraw): the chart and minute last drawn, and whether
// this redraw is the tick's. Any other redraw paints the whole face: after a
// notification, say, the screen holds something else.
// Charts are numbered as they are made: a new chart can take the memory of
// the one before, so its address doesn't tell them apart.
static uint32_t s_chart_serial,s_drawn_serial;
static int s_drawn_minute=-1;
static bool s_tick_redraw;
// Whether the screen holds a chart: while the next is built, it stays.
static bool s_painted;
static uint32_t s_build_ms;        // time spent building it

static void chart_free(Chart *c){
  if(c->scene){enr_free(c->scene,free);free(c->scene);}
  c->scene=NULL;
}
// A chart covers its hour.
static bool covers(const Chart *c,time_t t){
  if(!c->scene)return false;
  const EnrScene *s=c->scene;
  return t>=s->hour_start&&t<s->hour_start+3600;
}
static void set_status(const char *text){strncpy(s_status,text,sizeof s_status-1);s_status[sizeof s_status-1]=0;}

// The local clock's minutes ahead of UTC's (within a day).
static int zone_minutes(time_t now){const struct tm *lt=localtime(&now);return (lt->tm_hour*60+lt->tm_min-(int)(now/60%1440)+1440)%1440;}

// Segments from the first missing day (-1: none), and home's rise and set
// or, for a satellite, its own segments and passes.
static void request_data(time_t now,int32_t day,int32_t norad){
  if(s_data_asked_at&&now-s_data_asked_at<(RETRY_SECONDS<<(s_data_tries>6?5:s_data_tries?s_data_tries-1:0)))return;
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return;
  dict_write_int32(out,MESSAGE_KEY_DataRequest,day);
  if(norad)dict_write_int32(out,MESSAGE_KEY_DataBody,norad);
  if(app_message_outbox_send()==APP_MSG_OK){s_data_asked_at=now;if(s_data_tries<255)s_data_tries++;}
}

// Segments a few days ahead and home's rise and set for today, asked for
// until they arrive (at most once a RETRY_SECONDS); once all are here,
// checked again only at the next hour.
static time_t s_data_ok_until;
// What the hour's chart reads (chart_needs) and some way ahead: the Sun's
// and Moon's days from the chart's first (yesterday's, for a while after
// midnight UTC: a new watch has nothing of it), a satellite's segments to
// the chart's end and six hours from its start, home's passes for now.
static void need_data(time_t now){
  if(now<s_data_ok_until)return;
  ChartNeeds n;chart_needs(now,&s_settings,&n);
  const int32_t today=(int32_t)(now/86400),from=n.day0<today?today-1:today,missing=segments_missing(from,SEGMENT_DAYS+today-from);
  const bool sat=s_settings.body==BODY_SATELLITE;bool more;
  if(sat){
    const int64_t to=n.sat1+1>n.sat0+6*3600?n.sat1+1:n.sat0+6*3600;
    more=sat_segments_missing(s_settings.norad,n.sat0,(int32_t)(to-n.sat0))>=0||(s_settings.home&&!pass_block_known(now,&s_settings));
  }else{
    const struct tm *lt=localtime(&now);
    more=s_settings.home&&!rise_set_known(civil_date(lt->tm_year+1900,lt->tm_mon+1,lt->tm_mday));
  }
  int32_t wanted=sat?s_settings.norad:0;
  if(!more)for(int k=0;k<2;k++)if(s_settings.extra[k]&&sat_segments_missing(s_settings.extra[k],n.start,6*3600)>=0){wanted=s_settings.extra[k];more=true;break;}
  if(missing>=0||more)request_data(now,missing,wanted);
  else{s_data_ok_until=n.start+3600;s_data_tries=0;}
}
// How deep the stack has been, in bytes. PebbleOS gives an app 2 KB of it
// less a 32-byte guard (APP_STACK_NORMAL_SIZE in its app_manager.c), just
// below the app itself, whose header leads it; and the system's own calls
// run on it too. Past the guard a watch stops the app; the emulator does
// not, so the app marks what it has not yet used as it starts, and the
// build's log says how much of that has since been written over.
#define STACK_BYTES (2048-32)
#ifdef NO_STACK
// (Off the watch, the simulator's stack is the host's.)
static void stack_mark(void){}
static unsigned stack_deepest(void){return 0;}
#else
extern const uint8_t __pbl_app_info[];
#define STACK_MARK 0xA5
// (The addresses as numbers: the stack is no part of the header's object.)
static void stack_mark(void){
  volatile uint8_t here=0;const uintptr_t top=(uintptr_t)__pbl_app_info;
  for(uintptr_t a=top-STACK_BYTES;a<(uintptr_t)&here-96;a++)*(volatile uint8_t *)a=STACK_MARK;
}
static unsigned stack_deepest(void){
  const uintptr_t top=(uintptr_t)__pbl_app_info;uintptr_t a=top-STACK_BYTES;
  while(a<top&&*(volatile const uint8_t *)a==STACK_MARK)a++;
  return (unsigned)(top-a);
}
#endif
// The app's log, one line's worth of text for all of it (every byte of the
// app is a byte of its heap): what happened, a number that goes with it,
// the heap free and the stack's deepest. "build", "built" (milliseconds of
// work), "chart.c line" (a failure's place), "no room to draw", "stack".
void app_note(const char *what,unsigned n){APP_LOG(APP_LOG_LEVEL_INFO,"%s %u H%u S%u/%u",what,n,(unsigned)heap_bytes_free(),stack_deepest(),(unsigned)STACK_BYTES);}
static uint32_t now_ms(void){time_t t;uint16_t ms;time_ms(&t,&ms);return (uint32_t)t*1000+ms;}
static void build_step(void *data);
static void build_abort(void){
  if(s_build_timer){app_timer_cancel(s_build_timer);s_build_timer=NULL;}
  if(s_build){chart_abort(s_build);s_build=NULL;}
  local_chart_done();
}
// This hour's chart, built here a slice at a time (the ground, the drawing,
// the minutes), so the watch keeps answering its events: about 80 ms of
// work, then a pause.
static void build(time_t now){
  if(s_build)return;
  chart_free(&s_now);
  app_note("build",0);
  s_build=local_chart(now,&s_settings);s_build_ms=0;s_zone=zone_minutes(now);
  if(s_build)s_build_timer=app_timer_register(1,build_step,NULL);
  else{if(!s_status_phone)set_status("AWAITING EPHEMERIS");layer_mark_dirty(s_layer);}
  need_data(now);
}
static void check(time_t now);
static void build_step(void *data){
  s_build_timer=NULL;
  if(!s_build)return;
  const uint32_t t0=now_ms();int r;
  do r=chart_step(s_build);while(r>0&&now_ms()-t0<80);
  s_build_ms+=now_ms()-t0;
  if(r>0){s_build_timer=app_timer_register(10,build_step,NULL);return;}
  if(r<0){app_note("chart",chart_failed_at);switch_end();build_abort();s_status_phone=false;set_status("NO ROOM FOR THE CHART");layer_mark_dirty(s_layer);return;}
  const uint32_t t1=now_ms();
  EnrScene *scene=chart_finish(s_build);s_build=NULL;local_chart_done();
  s_build_ms+=now_ms()-t1;
  if(scene){s_now.scene=scene;s_chart_serial++;s_status[0]=0;s_status_phone=false;app_note("built",(unsigned)s_build_ms);}
  else{s_status_phone=false;set_status("NO ROOM FOR THE CHART");app_note("chart",chart_failed_at);}
  layer_mark_dirty(s_layer);
  // A build that ran over the hour's end made the last hour's chart.
  if(scene)check(time(NULL));
}

// What the watch still needs. A chart built in another time zone (the
// clock set anew mid-hour) is another hour's.
static void check(time_t now){
  if(s_now.scene&&zone_minutes(now)!=s_zone)chart_free(&s_now);
  if(!covers(&s_now,now))build(now);else need_data(now);
}

// ------------------------------------------------------- the animations
// What runs (s_settings.fx, GT_FX_*): at each new minute drawn, the body's
// blink; home's pulse at the minute the satellite rises into view; a scan
// (one of those chosen, at random) as the hour's chart first appears and at
// minutes chosen at random for the chart, once to four times an hour, on
// the screens' plates (or every plate); and a scan at a flick of the wrist.
// A frame each 66 ms (some 15 a second), drawn by update().
static AppTimer *s_fx_timer;
static uint32_t s_fx_planned,s_fx_shown;   // the chart the scans are chosen for; the chart last shown
static uint8_t s_fx_plan[4];
static void fx_step(void *data){s_fx_timer=NULL;if(s_fx_on)layer_mark_dirty(s_layer);}
static void fx_next(void){if(!s_fx_timer)s_fx_timer=app_timer_register(66,fx_step,NULL);}
// One of the scans chosen, at random; -1 for none (or, but at a flick, none
// on this plate).
static int fx_scan(bool any_plate){
  const uint16_t f=s_settings.fx;
  if(!any_plate&&!(f&GT_FX_EVERY_PLATE)&&!((DIGITAL_PLATES>>s_settings.plate)&1))return -1;
  static const uint8_t kinds[4]={ENR_FX_REFRESH,ENR_FX_SORT,ENR_FX_REACQUIRE,ENR_FX_TEAR};
  static const uint16_t bits[4]={GT_FX_REFRESH,GT_FX_SORT,GT_FX_REACQUIRE,GT_FX_TEAR};
  int n=0,on[4];for(int k=0;k<4;k++)if(f&bits[k])on[n++]=kinds[k];
  return n?on[rand()%n]:-1;
}
static void fx_start(int kind,int minute){
  #ifdef GT_NO_FX
  return;                                  // (the host's simulator: frames as the minute's alone)
  #endif
  if(kind<0||s_fx_on||s_build||!s_now.scene)return;
  if((s_settings.watch&32)&&quiet_time_is_active())return;
  if(enr_fx_begin(s_now.scene,kind,minute,(uint32_t)rand())){s_fx_on=true;fx_next();}
}
static void fx_minute(int minute){
  const uint16_t f=s_settings.fx;
  if(!s_now.scene)return;
  // (The scans' minutes, chosen when a chart is first shown: 3 to 57.)
  if(s_fx_planned!=s_chart_serial){
    s_fx_planned=s_chart_serial;
    static const uint8_t count[4]={0,1,2,4};
    for(int k=0;k<4;k++)s_fx_plan[k]=k<count[s_settings.fx_rate&3]?(uint8_t)(3+rand()%55):255;
  }
  int kind=-1;
  if(s_fx_shown!=s_chart_serial){s_fx_shown=s_chart_serial;if(s_switching){switch_end();kind=ENR_FX_ACQUIRED;}else if(f&GT_FX_HOUR)kind=fx_scan(false);}
  for(int k=0;k<4&&kind<0;k++)if(s_fx_plan[k]==minute)kind=fx_scan(false);
  // (A rise into home's view: home's pulse, and the watch's if asked.)
  const bool rise=((f&GT_FX_RISE)||(s_settings.watch&16))&&enr_fx_aos(s_now.scene,minute);
  if(rise&&(s_settings.watch&16)&&!quiet_time_is_active())vibes_double_pulse();
  if(kind<0&&rise&&(f&GT_FX_RISE))kind=ENR_FX_PULSE_HOME;
  if(kind<0&&(f&GT_FX_BODY))kind=ENR_FX_PULSE_BODY;
  fx_start(kind,minute);
}
// ---- a flick to the next satellite
// With more than one satellite followed (the body and its companions), a
// flick makes the next the body: the body and companions turned round as a
// ring (the Sun or Moon as the body gives way to the first companion, and
// is marked beside it), the phone told (Primary), the hour built again.
// While it is built a box says so over the last chart, which breaks up
// behind it (it is going: nothing is kept); the new one comes in under the
// reacquiring's sweep (ENR_FX_ACQUIRED).
// (GT_HUD_SLOW: the list four times slower, for screenshots.)
#ifdef GT_HUD_SLOW
#define HUD_MS 264
#else
#define HUD_MS 66
#endif
// The track list (below): the ring as it stood, the body first, and the
// chart's colours.
static struct {int n;char code[3][4];uint8_t kind[3];uint8_t ground,ink,accent;} s_list;
#define LIST_SUN 0x80
#define LIST_MOON 0x81
static uint8_t s_switch_step;static AppTimer *s_switch_timer;static time_t s_switch_since;static uint32_t s_switch_ms;
static int satellites(const WatchSettings *s){int n=s->body==BODY_SATELLITE;for(int k=0;k<2;k++)n+=s->extra[k]!=0;return n;}
static void switch_step(void *data){s_switch_timer=NULL;if(s_switching){s_switch_step++;layer_mark_dirty(s_layer);s_switch_timer=app_timer_register(HUD_MS,switch_step,NULL);}}
static void switch_end(void){s_switching=false;if(s_switch_timer){app_timer_cancel(s_switch_timer);s_switch_timer=NULL;}}
static void send_primary(int32_t norad){
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return;
  dict_write_int32(out,MESSAGE_KEY_Primary,norad);app_message_outbox_send();
}
static void next_satellite(void){
  WatchSettings s=s_settings;
  // (The track list as the ring stands, the body first; in the chart's
  // colours, before it goes.)
  {int n=0;
  if(s.body!=BODY_SATELLITE){memcpy(s_list.code[n],s.body==BODY_SUN?"SUN":"MOON",4);s_list.code[n][3]=s.body==BODY_SUN?0:'N';s_list.kind[n++]=s.body==BODY_SUN?LIST_SUN:LIST_MOON;}
  else{memcpy(s_list.code[n],s.code,3);s_list.code[n][3]=0;s_list.kind[n++]=(uint8_t)(s.station|s.view<<1);}
  for(int k=0;k<2;k++)if(s.extra[k]){memcpy(s_list.code[n],s.extra_code[k],3);s_list.code[n][3]=0;s_list.kind[n++]=s.extra_kind[k];}
  s_list.n=n;
  const EnrScene *sc=s_now.scene;s_list.ground=sc?sc->space:0xC0;s_list.ink=sc?sc->space_ink:0xFF;s_list.accent=sc?sc->zoned[ENR_ROUTE][0]:0xDC;}
  int32_t sat[3];char code[3][3];uint8_t kind[3],track[3];int n=0;
  if(s.body==BODY_SATELLITE){sat[n]=s.norad;memcpy(code[n],s.code,3);kind[n]=(uint8_t)(s.station|s.view<<1);track[n]=0;n++;}
  else s.also|=s.body==BODY_SUN?1:2;
  for(int k=0;k<2;k++)if(s.extra[k]){sat[n]=s.extra[k];memcpy(code[n],s.extra_code[k],3);kind[n]=s.extra_kind[k];track[n]=(s.legend>>(2+k))&1;n++;}
  if(n<2)return;
  // (The first after the body: the ring turned once; or, the Sun's or the
  // Moon's, the first companion.)
  const int first=s.body==BODY_SATELLITE?1:0;
  s.body=BODY_SATELLITE;s.norad=sat[first];memcpy(s.code,code[first],3);s.code[3]=0;s.station=kind[first]&1;s.view=kind[first]>>1;
  memset(s.extra,0,sizeof s.extra);memset(s.extra_code,0,sizeof s.extra_code);memset(s.extra_kind,0,sizeof s.extra_kind);
  // (The companions: those after it, then, from a satellite body, that one.)
  int order[2],m=0;for(int i=first+1;i<n;i++)order[m++]=i;
  if(first==1)order[m++]=0;
  // (Each companion's dotted track goes with it; the body's had none.)
  s.legend&=(uint8_t)~12;
  for(int k=0;k<m;k++){const int i=order[k];s.extra[k]=sat[i];memcpy(s.extra_code[k],code[i],3);s.extra_kind[k]=kind[i];s.legend|=(uint8_t)(track[i]<<(2+k));}
  s_settings=s;settings_save(&s);send_primary(s.norad);
  // (What the new body lacks, its passes over home, asked for at once.)
  s_data_ok_until=0;s_data_asked_at=0;s_data_tries=0;
  if(s_fx_on){enr_fx_end(NULL,0);s_fx_on=false;}
  s_switching=true;s_switch_step=0;s_switch_since=time(NULL);s_switch_ms=now_ms();if(!s_switch_timer)s_switch_timer=app_timer_register(HUD_MS,switch_step,NULL);
  build_abort();chart_free(&s_now);s_status[0]=0;s_status_phone=false;
  check(time(NULL));layer_mark_dirty(s_layer);
}
// The track list over the last chart, which breaks up behind it: a row for
// each of the satellites (or the Sun or Moon) in the ring's order before
// the flick, each a square with its symbol, its code in the chart's
// lettering and its view in small type; the highlight on the body drops to
// the next, and the list scrolls up under it, round, till the next is at
// the top. The header says ACQUIRING, blinking, till the chart comes. In
// the plate's own colours (taken from the chart as it went).
// The symbols, 9 wide (a station's arrays and modules; a satellite's
// body and panels; the Sun; the Moon).
static const char *const ICONS[4][7]={
  {"#.#...#.#","###...###","#.#.#.#.#","#########","#.#.#.#.#","###...###","#.#...#.#"},
  {".........","##.....##","##.###.##","#########","##.###.##","##.....##","........."},
  {"...###...","..#...#..",".#..#..#.",".#.###.#.",".#..#..#.","..#...#..","...###..."},
  {"...###...","..##.....",".##......",".##......",".##......","..##.....","...###..."}};
typedef struct {uint8_t *row[ENR_H];int16_t x0[ENR_H],x1[ENR_H];} Rows;
static void put(const Rows *f,int x,int y,int y0,int y1,uint8_t c){if(y<y0||y>y1||y<0||y>=ENR_H||x<f->x0[y]||x>f->x1[y])return;f->row[y][x]=c;}
// The chart's lettering (font.bin's glyphs, as the core draws them).
static void letters(const Rows *f,const char *t,int x,int baseline,int y0,int y1,uint8_t c){
  #if GT_BLOBS
  if(!s_font)return;
  const EnrGlyph *glyphs=(const EnrGlyph *)s_font;const EnrRun *runs=(const EnrRun *)(s_font+8*ENR_FONT_GLYPH_COUNT);
  #else
  const EnrGlyph *glyphs=ENR_FONT_GLYPHS;const EnrRun *runs=ENR_FONT_RUNS;
  #endif
  for(;*t;t++){
    const char ch=*t;const int k=ch>='0'&&ch<='9'?ch-'0':ch>='A'&&ch<='Z'?ch-'A'+10:ch=='-'?38:-1;
    if(k<0){x+=7;continue;}
    const EnrGlyph *g=&glyphs[k];
    for(int r=0;r<g->count;r++){const EnrRun *run=&runs[g->first+r];for(int i=0;i<run->n;i++)put(f,x+g->left+run->x+i,baseline-g->top+run->y,y0,y1,c);}
    x+=g->advance;
  }
}
static void switch_frame(GContext *ctx,GRect box){
  (void)box;
  GBitmap *frame=graphics_capture_frame_buffer(ctx);
  if(!frame)return;
  static Rows f;for(int y=0;y<ENR_H;y++){const GBitmapDataRowInfo ri=gbitmap_get_data_row_info(frame,y);f.row[y]=ri.data;f.x0[y]=ri.min_x;f.x1[y]=ri.max_x;}
  const int ROW=16,w=150,x0=ENR_W/2-w/2,top=ENR_H/2-34,h=12+3*ROW+3,wy0=top+12,wy1=top+12+3*ROW-1;
  // The last chart breaking up: rows thrown sideways, their red apart (the
  // panel's left alone).
  {static uint8_t row[ENR_W];
  for(int k=0;k<6;k++){
    const int y0=rand()%(ENR_H-8),hh=2+rand()%7,shift=(rand()%25)-12;
    for(int y=y0;y<y0+hh;y++){
      if(y>=top-2&&y<top+h+2)continue;
      uint8_t *r=f.row[y];const int a0=f.x0[y],a1=f.x1[y];if(a1<=a0)continue;
      memcpy(row+a0,r+a0,(size_t)(a1-a0+1));
      for(int x=a0;x<=a1;x++){int a=x-shift,b=a-2;a=a<a0?a0:a>a1?a1:a;b=b<a0?a0:b>a1?a1:b;r[x]=(uint8_t)((row[a]&0xCF)|(row[b]&0x30));}
    }
  }}
  const uint8_t G=s_list.ground,I=s_list.ink,A=s_list.accent;
  for(int y=top;y<top+h;y++)for(int x=x0;x<x0+w;x++)put(&f,x,y,0,ENR_H-1,(y==top||y==top+h-1||x==x0||x==x0+w-1||y==top+11)?A:G);
  // Where the rows stand: the highlight on the body (row 0), dropping to the
  // next (steps 4-8), then the list scrolling up a row (9-15), round.
  const int st=s_switch_step,n=s_list.n>0?s_list.n:1;
  const int drop=st<4?0:st<9?(st-3)*ROW/5:ROW,scroll=st<9?0:st<16?(st-8)*ROW/7:ROW;
  const int hl=wy0+drop-scroll;
  for(int y=hl;y<hl+ROW;y++)for(int x=x0+1;x<x0+w-1;x++)put(&f,x,y,wy0,wy1,A);
  for(int i=0;i<n+1;i++){
    const int item=i%n,y=wy0+i*ROW-scroll;if(i==n&&scroll==0)continue;
    if(y+ROW<=wy0||y>wy1)continue;
    const bool lit=y+ROW/2>=hl&&y+ROW/2<hl+ROW;const uint8_t fg=lit?G:I,sq=lit?G:A;
    // (The square, and its symbol.)
    for(int yy=0;yy<13;yy++)for(int xx=0;xx<13;xx++)if(yy==0||yy==12||xx==0||xx==12)put(&f,x0+4+xx,y+1+yy,wy0,wy1,sq);
    const int icon=s_list.kind[item]==LIST_SUN?2:s_list.kind[item]==LIST_MOON?3:(s_list.kind[item]&1)?0:1;
    for(int yy=0;yy<7;yy++)for(int xx=0;xx<9;xx++)if(ICONS[icon][yy][xx]=='#')put(&f,x0+6+xx,y+4+yy,wy0,wy1,fg);
    letters(&f,s_list.code[item],x0+22,y+11,wy0,wy1,fg);
  }
  graphics_release_frame_buffer(ctx,frame);
  // The small type: the header, and each row's view (rows wholly in view).
  static const char *const VIEWS[4]={"HOUR CHART","WORLD BAND","WHOLE DAY","WORLD DAY"};
  const GFont small=fonts_get_system_font(FONT_KEY_GOTHIC_09);
  graphics_context_set_text_color(ctx,(GColor){.argb=A});
  graphics_draw_text(ctx,"TRACK",small,GRect(x0+4,top-1,60,11),GTextOverflowModeFill,GTextAlignmentLeft,NULL);
  if((st/4)%2==0||st<16)graphics_draw_text(ctx,st<16?"NEXT":"ACQUIRING",small,GRect(x0+w-70,top-1,66,11),GTextOverflowModeFill,GTextAlignmentRight,NULL);
  for(int i=0;i<n+1;i++){
    const int item=i%n,y=wy0+i*ROW-scroll;if(i==n&&scroll==0)continue;
    if(y<wy0||y+ROW-1>wy1)continue;
    const bool lit=y+ROW/2>=hl&&y+ROW/2<hl+ROW;
    graphics_context_set_text_color(ctx,(GColor){.argb=lit?G:I});
    const uint8_t k=s_list.kind[item];
    graphics_draw_text(ctx,k==LIST_SUN||k==LIST_MOON?"BODY":VIEWS[(k>>1)&3],small,GRect(x0+50,y+2,w-54,11),GTextOverflowModeFill,GTextAlignmentRight,NULL);
  }
}
// A flick (or two within a second and a half, if asked): to the next
// satellite, or a scan.
static void flick(AccelAxisType axis,int32_t direction){
  if(s_settings.fx&GT_FX_TWO_FLICKS){
    static uint32_t last;const uint32_t t=now_ms();
    if(!last||t-last>1500){last=t;return;}
    last=0;
  }
  if(s_switching||s_build)return;
  if(satellites(&s_settings)>1){next_satellite();return;}
  if(s_painted&&s_drawn_minute>=0)fx_start(fx_scan(true),s_drawn_minute);
}
// The settings' animations taken: the flick listened for or not, the scans
// chosen again.
static void fx_settings(void){
  static bool flicking;const bool want=(s_settings.fx&GT_FX_FLICK)!=0;
  if(want!=flicking){if(want)accel_tap_service_subscribe(flick);else accel_tap_service_unsubscribe();flicking=want;}
  s_fx_planned=0;
}

static void update(Layer *layer,GContext *ctx){
  const time_t now=time(NULL);
  // (The list stays 1.6 seconds at the least, its highlight dropped and
  // scrolled up and its new top read, though the chart may be ready before.)
  if(s_switching&&s_painted&&now_ms()-s_switch_ms<(uint32_t)HUD_MS*24&&covers(&s_now,now)){const GRect b=layer_get_bounds(layer);switch_frame(ctx,GRect(b.size.w/2-58,b.size.h/2-28,116,56));return;}
  if(!covers(&s_now,now)){
    // Going to the next satellite, the last chart breaks up behind its box
    // while the next is built, or its data asked for (45 seconds at most).
    if(s_switching&&s_painted&&now-s_switch_since<45){const GRect b=layer_get_bounds(layer);switch_frame(ctx,GRect(b.size.w/2-58,b.size.h/2-28,116,56));return;}
    switch_end();
    // While the next chart is built, the last stays on the screen.
    if(s_build&&s_painted)return;
    // No chart for this hour: an honest blank with a note.
    graphics_context_set_fill_color(ctx,GColorBlack);
    graphics_fill_rect(ctx,layer_get_bounds(layer),0,GCornerNone);
    graphics_context_set_text_color(ctx,GColorWhite);
    graphics_draw_text(ctx,s_build?"DRAWING CHART":s_status[0]?s_status:"AWAITING CHART",fonts_get_system_font(FONT_KEY_GOTHIC_14),
      GRect(0,100,ENR_W,20),GTextOverflowModeTrailingEllipsis,GTextAlignmentCenter,NULL);
    s_drawn_serial=0;s_drawn_minute=-1;s_tick_redraw=false;s_painted=false;
    return;
  }
  GBitmap *frame=graphics_capture_frame_buffer(ctx);
  if(!frame)return;
  // The Time 2's is rectangular: every row is a full row of GColor8 bytes.
  // The Round 2's keeps each row's pixels on the glass alone: the renderer
  // is told where each row lies and how far it runs.
#if ENR_ROUND
  static EnrFrame rows;
  for(int y=0;y<ENR_H;y++){const GBitmapDataRowInfo ri=gbitmap_get_data_row_info(frame,y);rows.row[y]=ri.data;rows.x0[y]=ri.min_x;rows.x1[y]=ri.max_x;}
  uint8_t *const pixels=(uint8_t *)&rows;const int stride=0;
#else
  uint8_t *const pixels=gbitmap_get_data(frame);const int stride=gbitmap_get_bytes_per_row(frame);
#endif
  const int minute=(int)((now-s_now.scene->hour_start)/60);
  // An animation's next frame over the minute on the screen; anything else
  // drawn, it is ended first, the screen as it was.
  if(s_fx_on){
    if(!s_tick_redraw&&s_painted&&s_drawn_serial==s_chart_serial&&s_drawn_minute==minute){
      s_fx_on=enr_fx_frame(pixels,stride)!=0;
      graphics_release_frame_buffer(ctx,frame);
      if(s_fx_on)fx_next();
      return;
    }
    enr_fx_end(pixels,stride);s_fx_on=false;
  }
  const bool partial=s_tick_redraw&&s_drawn_serial==s_chart_serial&&s_drawn_minute>=0&&s_drawn_minute<=minute;
  int drawn=enr_render_update(s_now.scene,partial?s_drawn_minute:-1,minute,pixels,stride);
  // (Drawing over the last minute takes more memory than drawing the minute
  // whole: without it, the whole.)
  if(drawn<0&&partial)drawn=enr_render_update(s_now.scene,-1,minute,pixels,stride);
  graphics_release_frame_buffer(ctx,frame);
  // Without the memory to draw, the next tick tries the whole minute again.
  if(drawn<0){app_note("draw",0);s_drawn_minute=-1;s_tick_redraw=false;return;}
  const bool fresh=minute!=s_drawn_minute||s_drawn_serial!=s_chart_serial;
  s_drawn_serial=s_chart_serial;s_drawn_minute=minute;s_tick_redraw=false;s_painted=true;
  if(fresh)fx_minute(minute);
}

static void tick(struct tm *when,TimeUnits changed){
  // (The stack's deepest, logged when it has grown: a minute's drawing too.)
  {static unsigned logged;const unsigned d=stack_deepest();if(d>logged){logged=d;app_note("stack",d);}}
  check(time(NULL));
  s_tick_redraw=true;
  layer_mark_dirty(s_layer);
}
// Back from a notification or a menu: the screen holds something else.
static void focus_changed(bool focused){
  // (Away, an animation is let go: the screen is drawn whole on the return.)
  if(!focused&&s_fx_on){enr_fx_end(NULL,0);s_fx_on=false;}
  if(focused){s_drawn_minute=-1;s_painted=false;layer_mark_dirty(s_layer);}
}

// After data arrives: once the messages stop for a moment, check what is
// still missing and draw the hour again if it needs it (or, with `changed`,
// because the data changes what is drawn).
static AppTimer *s_data_timer;static bool s_data_changed;
static void data_settled(void *data){
  s_data_timer=NULL;s_data_ok_until=0;
  const time_t now=time(NULL);
  if(s_data_changed&&(s_now.scene||s_build)){build_abort();chart_free(&s_now);}
  s_data_changed=false;
  check(now);layer_mark_dirty(s_layer);
}
static void data_arrived(bool changed){
  s_data_changed|=changed;
  if(s_data_timer)app_timer_reschedule(s_data_timer,1500);else s_data_timer=app_timer_register(1500,data_settled,NULL);
}
// A check a moment on, from the event loop: a message's handler is already
// a quarter of the stack down, and a build starts deep.
static void check_now(void *data){check(time(NULL));layer_mark_dirty(s_layer);}
static void check_soon(void){app_timer_register(1,check_now,NULL);}
// Settings as the phone packs them: body, plate, flag, clock24, home, then
// home's latitude and longitude in hundredths of a degree (i32 each), then
// a satellite's catalog number (i32), its kind (1 a station, plus its view
// times 2) and its code (3 characters), then the callout's figures and the
// margin's time, the world band's time scale and how its minutes fall on
// the route, the figure set and the margins' corner (see
// native/pkjs/main.js; an older phone app sends 25 or 26 bytes).
static void show_state(void);
static void take_settings(const uint8_t *b,size_t n){
  if(n<25)return;
  WatchSettings s;memset(&s,0,sizeof s);
  _Static_assert(offsetof(WatchSettings,extra)-offsetof(WatchSettings,numerals)==10,"contiguous settings options");
  _Static_assert(offsetof(WatchSettings,norad)-offsetof(WatchSettings,lat100)==8,"contiguous coordinate fields");
  _Static_assert(offsetof(WatchSettings,extra_code)-offsetof(WatchSettings,numerals)==18,"contiguous identifier bytes");
  s.version=15;s.figures=2;s.fx=GT_FX_DEFAULT;s.fx_rate=GT_FX_RATE_DEFAULT;
  // Wire bytes are little-endian on both Pebble and the host; the three
  // coordinate/catalog fields and the option bytes are contiguous.
  memcpy(&s.body,b,5);memcpy(&s.lat100,b+5,12);
  s.station=b[17]&1;s.view=b[17]>>1;memcpy(s.code,b+18,3);
  memcpy(&s.numerals,b+21,n>=45?24:n>=39?18:n-21<10?n-21:10);
  if(n>=48){s.fx=(uint16_t)(b[45]|b[46]<<8);s.fx_rate=b[47];}
  if(n>=50){s.extra_kind[0]=b[48];s.extra_kind[1]=b[49];}
  // The phone sends its settings as it starts: the moment to ask for what
  // is missing (a request made before it was listening is lost).
  s_data_ok_until=0;s_data_asked_at=0;s_data_tries=0;
  // (The animations alone changed: kept, the chart as it is.)
  {WatchSettings same=s;same.fx=s_settings.fx;same.fx_rate=s_settings.fx_rate;
  if(!memcmp(&same,&s_settings,sizeof s)){if(s.fx!=s_settings.fx||s.fx_rate!=s_settings.fx_rate){s_settings=s;settings_save(&s);fx_settings();}check_soon();return;}}
  s_settings=s;settings_save(&s);show_state();fx_settings();
  // Drawn again in the new settings.
  build_abort();chart_free(&s_now);s_status[0]=0;s_status_phone=false;
  check_soon();layer_mark_dirty(s_layer);
}

static void inbox(DictionaryIterator *in,void *context){
  Tuple *t;
  if((t=dict_find(in,MESSAGE_KEY_Settings)))take_settings(t->value->data,t->length);
  // Data for the watch's own charts. A reply comes in several messages: the
  // hour is drawn again once, a moment after the last (redraw_soon).
  if((t=dict_find(in,MESSAGE_KEY_Segments))){segments_store(t->value->data,t->length);data_arrived(false);}
  if((t=dict_find(in,MESSAGE_KEY_SatSegments))){sat_segments_store(t->value->data,t->length,&s_settings);s_status_phone=false;data_arrived(s_settings.extra[0]||s_settings.extra[1]);}
  // Home's rise and set, or its passes, may have changed the hour's chart.
  if((t=dict_find(in,MESSAGE_KEY_RiseSets))){rise_sets_store(t->value->data,t->length);data_arrived(true);}
  if((t=dict_find(in,MESSAGE_KEY_Events))){events_store(t->value->data,t->length);data_arrived(true);}
  // (Passes say whose they are: a reply to the satellite chosen before is
  // not this one's.)
  if((t=dict_find(in,MESSAGE_KEY_Passes))){
    const Tuple *whose=dict_find(in,MESSAGE_KEY_DataBody);
    if(!whose||whose->value->int32==s_settings.norad){pass_blocks_store(t->value->data,t->length,&s_settings);data_arrived(true);}
  }
  // Why the phone can't give what the watch asked for (no orbit, say).
  if((t=dict_find(in,MESSAGE_KEY_Status))){set_status(t->value->cstring);s_status_phone=true;layer_mark_dirty(s_layer);}
}
static void outbox_failed(DictionaryIterator *it,AppMessageResult reason,void *context){s_data_asked_at=0;if(s_data_tries)s_data_tries--;}

// The watch's own state: the battery and charging on the fuel line, the
// phone out of reach there (dashed) and in the margins' corner (NO LINK);
// the minute drawn whole again when it changes.
static void show_state(void){
  static uint16_t shown=0xFFFF;
  const BatteryChargeState b=battery_state_service_peek();
  const bool linked=connection_service_peek_pebble_app_connection();
  const int state=(b.is_charging?ENR_CHARGING:0)|(linked?0:ENR_NO_LINK)|(s_settings.watch&2?ENR_NO_FUEL:0)|(s_settings.watch&4?ENR_NO_ANTENNA:0);
  const uint16_t now=(uint16_t)(b.charge_percent|state<<8);
  if(now==shown)return;
  shown=now;enr_status(linked?"":"NO LINK");enr_power(b.charge_percent,state);s_drawn_minute=-1;if(s_layer)layer_mark_dirty(s_layer);
}
static void battery_changed(BatteryChargeState state){show_state();}
// (The phone back in reach is asked at the next tick for what is missing.)
// (Out of reach: a double pulse, if asked for and not in quiet time.)
static void connection_changed(bool connected){
  show_state();
  if(connected){s_data_asked_at=0;s_data_tries=0;s_data_ok_until=0;}
  else if((s_settings.watch&1)&&!quiet_time_is_active())vibes_double_pulse();
}
static void window_load(Window *window){
  Layer *root=window_get_root_layer(window);
  s_layer=layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer,update);
  layer_add_child(root,s_layer);
}
static void window_unload(Window *window){layer_destroy(s_layer);}

static void init(void){
  stack_mark();
  // The chart lettering's glyphs, from font.bin, kept for the app's life
  // (in the heap, not the size-capped code).
  {uint8_t *font=malloc(ENR_FONT_BYTES);if(font){memset(font,0,ENR_FONT_BYTES);resource_load(resource_get_handle(RESOURCE_ID_FONT),font,ENR_FONT_BYTES);enr_font_load(font);}}
  settings_load(&s_settings);
  s_window=window_create();
  // The window keeps what was drawn: a minute tick draws only what changed.
  window_set_background_color(s_window,GColorClear);
  window_set_window_handlers(s_window,(WindowHandlers){.load=window_load,.unload=window_unload});
  window_stack_push(s_window,false);
  app_message_register_inbox_received(inbox);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(INBOX_SIZE,64);
  tick_timer_service_subscribe(MINUTE_UNIT,tick);
  app_focus_service_subscribe(focus_changed);
  battery_state_service_subscribe(battery_changed);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler=connection_changed});
  show_state();
  fx_settings();
  check(time(NULL));
}
static void deinit(void){
  if(s_fx_on){enr_fx_end(NULL,0);s_fx_on=false;}
  if(s_settings.fx&GT_FX_FLICK)accel_tap_service_unsubscribe();
  tick_timer_service_unsubscribe();
  app_focus_service_unsubscribe();
  battery_state_service_unsubscribe();
  connection_service_unsubscribe();
  build_abort();
  chart_free(&s_now);
  window_destroy(s_window);
}

int main(void){
  init();
  app_event_loop();
  deinit();
}
