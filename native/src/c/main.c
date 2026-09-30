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
static uint32_t s_build_ms;        // time spent building it
static time_t s_quiet_until;       // no requests before this, after a status

static bool local(void){return s_settings.body<=BODY_MOON;}
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
// Segments from the first missing day, at most once a RETRY_SECONDS.
static void request_data(time_t now,int32_t day){
  if(s_data_asked_at&&now-s_data_asked_at<RETRY_SECONDS)return;
  if(send_int(MESSAGE_KEY_DataRequest,day))s_data_asked_at=now;
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
  else if(s_settings.home&&!rise_set_known(civil_date(lt->tm_year+1900,lt->tm_mon+1,lt->tm_mday)))request_data(now,today);
  else s_data_ok_until=now-now%3600+3600;
}
static uint32_t now_ms(void){time_t t;uint16_t ms;time_ms(&t,&ms);return (uint32_t)t*1000+ms;}
static void build_step(void *data);
static void build_abort(void){if(s_build){chart_abort(s_build);s_build=NULL;}}
// The Sun or Moon chart for this hour, built here a slice at a time, so the
// watch keeps answering its events: about 80 ms of work, then a pause.
static void build(time_t now){
  if(s_build)return;
  chart_free(&s_now);chart_free(&s_next);
  s_build=local_chart(now,&s_settings);s_build_ms=0;
  if(s_build)app_timer_register(1,build_step,NULL);
  else{set_status("AWAITING EPHEMERIS");layer_mark_dirty(s_layer);}
  need_data(now);
}
static void build_step(void *data){
  if(!s_build)return;
  const uint32_t t0=now_ms();int r;
  do r=chart_step(s_build);while(r>0&&now_ms()-t0<80);
  s_build_ms+=now_ms()-t0;
  if(r>0){app_timer_register(10,build_step,NULL);return;}
  if(r<0){build_abort();set_status("NO MAP");layer_mark_dirty(s_layer);return;}
  const uint32_t t1=now_ms();
  EnrScene *scene=chart_finish(s_build);s_build=NULL;
  s_build_ms+=now_ms()-t1;
  if(scene){s_now.scene=scene;s_status[0]=0;APP_LOG(APP_LOG_LEVEL_INFO,"Chart built: %lu ms of work, the last step %lu ms; heap free %u",(unsigned long)s_build_ms,(unsigned long)(now_ms()-t1),(unsigned)heap_bytes_free());}
  else set_status("NO ROOM FOR THE CHART");
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

static int32_t le32(const uint8_t *p){return (int32_t)((uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24);}
// Settings as the phone packs them: body, plate, flag, clock24, home, then
// home's latitude and longitude in hundredths of a degree (i32 each).
static void take_settings(const uint8_t *b,size_t n){
  if(n<13)return;
  const WatchSettings s={1,b[0],b[1],b[2],b[3],b[4],le32(b+5),le32(b+9)};
  if(!memcmp(&s,&s_settings,sizeof s))return;
  s_settings=s;settings_save(&s);s_data_ok_until=0;
  // Drawn again in the new settings.
  build_abort();chart_free(&s_now);chart_free(&s_next);s_asked_at=0;s_quiet_until=0;s_status[0]=0;
  check(time(NULL));layer_mark_dirty(s_layer);
}

static void inbox(DictionaryIterator *in,void *context){
  Tuple *t;
  if((t=dict_find(in,MESSAGE_KEY_Settings)))take_settings(t->value->data,t->length);
  if((t=dict_find(in,MESSAGE_KEY_Segments))){
    segments_store(t->value->data,t->length);s_data_asked_at=0;s_data_ok_until=0;
    if(local()&&!covers(&s_now,time(NULL))){check(time(NULL));layer_mark_dirty(s_layer);}
  }
  if((t=dict_find(in,MESSAGE_KEY_RiseSets))){
    rise_sets_store(t->value->data,t->length);s_data_ok_until=0;
    // Home's rise and set may have changed: draw the hour again.
    if(local()&&(s_now.scene||s_build)){build_abort();chart_free(&s_now);check(time(NULL));}
  }
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
