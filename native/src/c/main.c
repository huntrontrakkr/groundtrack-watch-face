// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The Sun and Moon charts are drawn by the watch itself, each hour, from
// its own map (a resource) and the Sun and Moon segments the phone sends a
// couple of months at a time: the phone isn't needed hour to hour. A
// satellite's chart comes from the phone, an hour at a time, the next hour's
// fetched five minutes ahead. Each minute the watch draws the hour's chart
// with the native core. There is no animation, no sensor and no timer but
// the minute tick. Until a chart covers the current hour, the face says so
// plainly rather than showing a stale one.
#include <pebble.h>
#include "enroute_core.h"
#include "watch_data.h"
#include "chart.h"

// Ask for a satellite's next hour this many minutes before it begins.
#define PREFETCH_MINUTES 5
// Ask again when a request has gone unanswered this long. Requests are only
// made on the minute tick, so this also bounds them to one a minute.
#define RETRY_SECONDS 50
// After the phone says it can't draw the hour, wait this long to ask again.
#define STATUS_QUIET_SECONDS 600
// Keep segments this many days ahead; ask for more when fewer are left.
#define SEGMENT_DAYS 10
// A message carries at most 2,000 bytes of payload; this leaves room for the
// dictionary's own framing.
#define INBOX_SIZE 2100

typedef struct {
  EnrScene *scene;      // parsed or built, or NULL
  uint8_t *blob;        // a phone scene as received (its class plane is borrowed), or NULL
} Chart;

static Window *s_window;
static Layer *s_layer;
static WatchSettings s_settings;
static Chart s_now,s_next;         // this hour's chart and, for a satellite, the next
static uint8_t *s_incoming;        // a scene being received
static uint32_t s_incoming_size,s_received;
static time_t s_asked_at;          // when a scene request was last sent, 0 if none is pending
static int32_t s_asked_for;        // the time whose hour it asked for
static time_t s_data_asked_at;     // when segments were last asked for
static char s_status[32];          // why there is no chart, if known
static ChartBuild *s_build;        // a Sun or Moon chart being built
// What the screen holds, so a minute tick can draw only what changed (as
// Dymaxion's minute_redraw): the chart and minute last drawn, and whether
// this redraw is the tick's. Any other redraw paints the whole face: after a
// notification, say, the screen holds something else.
static const EnrScene *s_drawn_scene;
static int s_drawn_minute=-1;
static bool s_tick_redraw;
static uint32_t s_build_ms,s_step_ms;  // time spent building it, and the longest step
static time_t s_quiet_until;       // no requests before this, after a status

// The Sun, the Moon, GPS and the fast satellites are drawn here; QZSS's
// whole day (not yet native) would come from the phone.
static bool local(void){return s_settings.body<BODY_SATELLITE||(s_settings.body==BODY_SATELLITE&&s_settings.view!=VIEW_DAY);}
static void chart_free(Chart *c){
  if(c->scene){enr_free(c->scene,free);free(c->scene);}
  free(c->blob);
  c->scene=NULL;c->blob=NULL;
}
static bool covers(const Chart *c,time_t t){
  return c->scene&&t>=c->scene->hour_start&&t<c->scene->hour_start+3600;
}
static void set_status(const char *text){strncpy(s_status,text,sizeof s_status-1);s_status[sizeof s_status-1]=0;}

// At the hour, a prefetched satellite chart takes over.
static void advance(time_t now){
  if(!covers(&s_now,now)&&covers(&s_next,now)){
    chart_free(&s_now);
    s_now=s_next;s_next=(Chart){NULL,NULL};
  }
}

static bool send_int(uint32_t key,int32_t value){
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return false;
  dict_write_int32(out,key,value);
  return app_message_outbox_send()==APP_MSG_OK;
}
// One scene request at a time, for the hour holding `when`; a new one only
// when the last has been answered or has waited RETRY_SECONDS.
static void request(time_t now,time_t when){
  if(s_asked_at&&now-s_asked_at<RETRY_SECONDS)return;
  if(now<s_quiet_until)return;
  if(send_int(MESSAGE_KEY_SceneRequest,(int32_t)when)){s_asked_at=now;s_asked_for=(int32_t)when;}
}
// Segments from the first missing day (and, for a satellite, its own
// segments and passes), at most once a RETRY_SECONDS.
static void request_data(time_t now,int32_t day){
  if(s_data_asked_at&&now-s_data_asked_at<RETRY_SECONDS)return;
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return;
  dict_write_int32(out,MESSAGE_KEY_DataRequest,day);
  if(s_settings.body==BODY_SATELLITE)dict_write_int32(out,MESSAGE_KEY_DataBody,s_settings.norad);
  if(app_message_outbox_send()==APP_MSG_OK)s_data_asked_at=now;
}

// Segments a few days ahead and home's rise and set for today, asked for
// until they arrive (at most once a RETRY_SECONDS); once all are here,
// checked again only at the next hour.
static time_t s_data_ok_until;
static void need_data(time_t now){
  if(now<s_data_ok_until)return;
  const int32_t today=(int32_t)(now/86400),missing=segments_missing(today,SEGMENT_DAYS);
  const struct tm *lt=localtime(&now);
  if(missing>=0)request_data(now,missing);
  else if(s_settings.body!=BODY_SATELLITE&&s_settings.home&&!rise_set_known(civil_date(lt->tm_year+1900,lt->tm_mon+1,lt->tm_mday)))request_data(now,today);
  // A satellite: its segments six hours ahead, and home's passes for now.
  else if(s_settings.body==BODY_SATELLITE&&(sat_segments_missing(s_settings.norad,now-now%3600-2400,6*3600)>=0||(s_settings.home&&!pass_block_known(now))))request_data(now,today);
  else s_data_ok_until=now-now%3600+3600;
}
static uint32_t now_ms(void){time_t t;uint16_t ms;time_ms(&t,&ms);return (uint32_t)t*1000+ms;}
static void build_step(void *data);
static void build_abort(void){if(s_build){chart_abort(s_build);s_build=NULL;}local_chart_done();}
// This hour's chart, built here a slice at a time (the ground, the drawing,
// the minutes), so the watch keeps answering its events: about 80 ms of
// work, then a pause.
static void build(time_t now){
  if(s_build)return;
  chart_free(&s_now);chart_free(&s_next);
  s_build=local_chart(now,&s_settings);s_build_ms=s_step_ms=0;
  if(s_build)app_timer_register(1,build_step,NULL);
  else{set_status("AWAITING EPHEMERIS");layer_mark_dirty(s_layer);}
  need_data(now);
}
static void build_step(void *data){
  if(!s_build)return;
  const uint32_t t0=now_ms();int r;
  do{const uint32_t a=now_ms();r=chart_step(s_build);const uint32_t d=now_ms()-a;if(d<60000&&d>s_step_ms)s_step_ms=d;}while(r>0&&now_ms()-t0<80);
  s_build_ms+=now_ms()-t0;
  if(r>0){app_timer_register(10,build_step,NULL);return;}
  if(r<0){APP_LOG(APP_LOG_LEVEL_ERROR,"Chart failed: %s; heap free %u",chart_failure(),(unsigned)heap_bytes_free());build_abort();set_status("NO ROOM FOR THE CHART");layer_mark_dirty(s_layer);return;}
  const uint32_t t1=now_ms();
  EnrScene *scene=chart_finish(s_build);s_build=NULL;local_chart_done();
  s_build_ms+=now_ms()-t1;
  if(scene){s_now.scene=scene;s_status[0]=0;APP_LOG(APP_LOG_LEVEL_INFO,"Chart built: %lu ms of work, the longest step %lu ms; heap free %u",(unsigned long)s_build_ms,(unsigned long)s_step_ms,(unsigned)heap_bytes_free());}
  else{set_status("NO ROOM FOR THE CHART");APP_LOG(APP_LOG_LEVEL_ERROR,"Chart not finished: %s; heap free %u",chart_failure(),(unsigned)heap_bytes_free());}
  layer_mark_dirty(s_layer);
}

// What the watch still needs.
static void check(time_t now){
  if(local()){if(!covers(&s_now,now))build(now);else need_data(now);return;}
  build_abort();
  advance(now);
  if(!covers(&s_now,now))request(now,now);
  else if(!s_next.scene&&now>=s_now.scene->hour_start+3600-PREFETCH_MINUTES*60)request(now,s_now.scene->hour_start+3600);
}

static void update(Layer *layer,GContext *ctx){
  const time_t now=time(NULL);
  advance(now);
  if(!covers(&s_now,now)){
    // No chart for this hour: an honest blank with a note.
    graphics_context_set_fill_color(ctx,GColorBlack);
    graphics_fill_rect(ctx,layer_get_bounds(layer),0,GCornerNone);
    graphics_context_set_text_color(ctx,GColorWhite);
    graphics_draw_text(ctx,s_build?"DRAWING CHART":s_incoming?"RECEIVING CHART":s_status[0]?s_status:"AWAITING CHART",fonts_get_system_font(FONT_KEY_GOTHIC_14),
      GRect(0,100,ENR_W,20),GTextOverflowModeTrailingEllipsis,GTextAlignmentCenter,NULL);
    s_drawn_scene=NULL;s_drawn_minute=-1;s_tick_redraw=false;
    return;
  }
  GBitmap *frame=graphics_capture_frame_buffer(ctx);
  if(!frame)return;
  // emery is rectangular: every row is a full row of GColor8 bytes.
  const int minute=(int)((now-s_now.scene->hour_start)/60);
  const bool partial=s_tick_redraw&&s_drawn_scene==s_now.scene&&s_drawn_minute>=0&&s_drawn_minute<=minute;
  enr_render_update(s_now.scene,partial?s_drawn_minute:-1,minute,gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  graphics_release_frame_buffer(ctx,frame);
  s_drawn_scene=s_now.scene;s_drawn_minute=minute;s_tick_redraw=false;
}

static void tick(struct tm *when,TimeUnits changed){
  check(time(NULL));
  s_tick_redraw=true;
  layer_mark_dirty(s_layer);
}
// Back from a notification or a menu: the screen holds something else.
static void focus_changed(bool focused){if(focused){s_drawn_minute=-1;layer_mark_dirty(s_layer);}}

// A received satellite scene becomes this hour's chart or the next; one for
// any other hour is dropped. A new chart for this hour also drops the next
// hour's, drawn as it was: it is asked for again.
static void accept(uint8_t *blob,uint32_t size){
  Chart c={malloc(sizeof(EnrScene)),blob};
  if(!c.scene||!enr_parse(blob,size,c.scene,malloc,true)){
    APP_LOG(APP_LOG_LEVEL_ERROR,"Malformed scene");
    if(c.scene){enr_free(c.scene,free);free(c.scene);c.scene=NULL;}
    chart_free(&c);
    return;
  }
  const time_t now=time(NULL);
  s_status[0]=0;s_quiet_until=0;
  if(covers(&c,now)){chart_free(&s_now);chart_free(&s_next);s_now=c;}
  else if(c.scene->hour_start>now&&c.scene->hour_start<=now+3600){chart_free(&s_next);s_next=c;}
  else{APP_LOG(APP_LOG_LEVEL_WARNING,"Scene for another hour");chart_free(&c);}
  // The request is answered when its hour has arrived.
  if(s_asked_at&&c.scene&&s_asked_for>=c.scene->hour_start&&s_asked_for<c.scene->hour_start+3600)s_asked_at=0;
  advance(now);
  layer_mark_dirty(s_layer);
}

// After data arrives: once the messages stop for a moment, check what is
// still missing and draw the hour again if it needs it (or, with `changed`,
// because the data changes what is drawn).
static AppTimer *s_data_timer;static bool s_data_changed;
static void data_settled(void *data){
  s_data_timer=NULL;s_data_ok_until=0;
  if(!local())return;
  const time_t now=time(NULL);
  if(s_data_changed&&(s_now.scene||s_build)){build_abort();chart_free(&s_now);}
  s_data_changed=false;
  check(now);layer_mark_dirty(s_layer);
}
static void data_arrived(bool changed){
  s_data_changed|=changed;
  if(s_data_timer)app_timer_reschedule(s_data_timer,1500);else s_data_timer=app_timer_register(1500,data_settled,NULL);
}
static int32_t le32(const uint8_t *p){return (int32_t)((uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24);}
// Settings as the phone packs them: body, plate, flag, clock24, home, then
// home's latitude and longitude in hundredths of a degree (i32 each), then
// a satellite's catalog number (i32), its kind (1 a station, plus its view
// times 2) and its code (3 characters).
static void take_settings(const uint8_t *b,size_t n){
  if(n<21)return;
  WatchSettings s;memset(&s,0,sizeof s);
  s.version=2;s.body=b[0];s.plate=b[1];s.flag=b[2];s.clock24=b[3];s.home=b[4];s.lat100=le32(b+5);s.lon100=le32(b+9);
  s.norad=le32(b+13);s.station=b[17]&1;s.view=b[17]>>1;memcpy(s.code,b+18,3);
  if(!memcmp(&s,&s_settings,sizeof s))return;
  s_settings=s;settings_save(&s);s_data_ok_until=0;
  // Drawn again in the new settings.
  build_abort();chart_free(&s_now);chart_free(&s_next);s_asked_at=0;s_quiet_until=0;s_status[0]=0;
  check(time(NULL));layer_mark_dirty(s_layer);
}

static void inbox(DictionaryIterator *in,void *context){
  Tuple *t;
  if((t=dict_find(in,MESSAGE_KEY_Settings)))take_settings(t->value->data,t->length);
  // Data for the watch's own charts. A reply comes in several messages: the
  // hour is drawn again once, a moment after the last (redraw_soon).
  if((t=dict_find(in,MESSAGE_KEY_Segments))){segments_store(t->value->data,t->length);data_arrived(false);}
  if((t=dict_find(in,MESSAGE_KEY_SatSegments))){sat_segments_store(t->value->data,t->length);data_arrived(false);}
  // Home's rise and set, or its passes, may have changed the hour's chart.
  if((t=dict_find(in,MESSAGE_KEY_RiseSets))){rise_sets_store(t->value->data,t->length);data_arrived(true);}
  if((t=dict_find(in,MESSAGE_KEY_Passes))){pass_blocks_store(t->value->data,t->length);data_arrived(true);}
  if((t=dict_find(in,MESSAGE_KEY_SceneStatus))){
    set_status(t->value->cstring);
    s_asked_at=0;s_quiet_until=time(NULL)+STATUS_QUIET_SECONDS;
    layer_mark_dirty(s_layer);
  }
  // A satellite scene arrives in order: its total size first, then each
  // chunk with its offset. A new total starts a new scene. A chunk sent
  // again (its acknowledgement lost) is ignored; one out of order abandons
  // the scene, and the next request starts over.
  Tuple *total=dict_find(in,MESSAGE_KEY_SceneTotal),*offset=dict_find(in,MESSAGE_KEY_SceneOffset),*chunk=dict_find(in,MESSAGE_KEY_SceneChunk);
  if(total){
    // Room first: a new scene is either the next hour, which the watch asks
    // for only when it holds none, or this hour's, which replaces the next.
    free(s_incoming);chart_free(&s_next);
    s_incoming_size=total->value->uint32;s_received=0;
    s_incoming=malloc(s_incoming_size);
    if(!s_incoming){APP_LOG(APP_LOG_LEVEL_ERROR,"No room for a %lu byte scene",(unsigned long)s_incoming_size);s_incoming_size=0;}
    layer_mark_dirty(s_layer);
  }
  if(!chunk||!offset||!s_incoming)return;
  const uint32_t at=offset->value->uint32,n=chunk->length;
  if(at<s_received)return;
  if(at>s_received||at+n>s_incoming_size){
    APP_LOG(APP_LOG_LEVEL_ERROR,"Scene chunk out of order");
    free(s_incoming);s_incoming=NULL;s_incoming_size=s_received=0;
    return;
  }
  memcpy(s_incoming+at,chunk->value->data,n);s_received+=n;
  if(s_received==s_incoming_size){
    uint8_t *blob=s_incoming;const uint32_t size=s_incoming_size;
    s_incoming=NULL;s_incoming_size=s_received=0;
    accept(blob,size);
  }
}
static void outbox_failed(DictionaryIterator *it,AppMessageResult reason,void *context){s_asked_at=0;s_data_asked_at=0;}

static void window_load(Window *window){
  Layer *root=window_get_root_layer(window);
  s_layer=layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer,update);
  layer_add_child(root,s_layer);
}
static void window_unload(Window *window){layer_destroy(s_layer);}

static void init(void){
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
  check(time(NULL));
}
static void deinit(void){
  tick_timer_service_unsubscribe();
  app_focus_service_unsubscribe();
  build_abort();
  chart_free(&s_now);chart_free(&s_next);
  free(s_incoming);
  window_destroy(s_window);
}

int main(void){
  init();
  app_event_loop();
  deinit();
}
