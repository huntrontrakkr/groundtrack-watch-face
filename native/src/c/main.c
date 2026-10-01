// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The watch draws each hour's chart itself, from its own map (a resource)
// and the Sun, Moon and satellite segments the phone sends days or weeks
// ahead: the phone isn't needed hour to hour. Each minute it draws what
// changed with the native core. There is no animation, no sensor and no
// timer but the minute tick. Until a chart covers the current hour, the
// face says so plainly rather than showing a stale one.
#include <pebble.h>
#include "enroute_core.h"
#include "watch_data.h"
#include "chart.h"

// Ask again when a request has gone unanswered this long. Requests are only
// made on the minute tick, so this also bounds them to one a minute.
#define RETRY_SECONDS 50
// Keep segments this many days ahead; ask for more when fewer are left.
#define SEGMENT_DAYS 10
// A message carries at most 2,000 bytes of payload; this leaves room for the
// dictionary's own framing.
#define INBOX_SIZE 2100

typedef struct {EnrScene *scene;} Chart;

static Window *s_window;
static Layer *s_layer;
static WatchSettings s_settings;
static Chart s_now;                // this hour's chart
static time_t s_data_asked_at;     // when segments were last asked for
static char s_status[32];          // why there is no chart, if known
static ChartBuild *s_build;        // a Sun or Moon chart being built
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
// A satellite's segments the hour needs (six hours from before it; for the
// whole day, from its midnight to the next).
static bool sat_missing(time_t now){
  int64_t from=now-now%3600-2400,to=from+6*3600;
  if(s_settings.view==VIEW_DAY){int64_t a,b;local_day(now,&a,&b);if(a<from)from=a;if(b>to)to=b;}
  return sat_segments_missing(s_settings.norad,from,(int32_t)(to-from))>=0;
}
static void need_data(time_t now){
  if(now<s_data_ok_until)return;
  const int32_t today=(int32_t)(now/86400),missing=segments_missing(today,SEGMENT_DAYS);
  const struct tm *lt=localtime(&now);
  if(missing>=0)request_data(now,missing);
  else if(s_settings.body!=BODY_SATELLITE&&s_settings.home&&!rise_set_known(civil_date(lt->tm_year+1900,lt->tm_mon+1,lt->tm_mday)))request_data(now,today);
  // A satellite: its segments six hours ahead, and home's passes for now.
  else if(s_settings.body==BODY_SATELLITE&&(sat_missing(now)||(s_settings.home&&!pass_block_known(now,&s_settings))))request_data(now,today);
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
  chart_free(&s_now);
  APP_LOG(APP_LOG_LEVEL_INFO,"Building the chart; heap free %u",(unsigned)heap_bytes_free());
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
  if(r<0){APP_LOG(APP_LOG_LEVEL_ERROR,"Chart failed: %s; heap free %u",chart_failure(),(unsigned)heap_bytes_free());build_abort();set_status("NO ROOM FOR THE CHART");layer_mark_dirty(s_layer);return;}
  const uint32_t t1=now_ms();
  EnrScene *scene=chart_finish(s_build);s_build=NULL;local_chart_done();
  s_build_ms+=now_ms()-t1;
  if(scene){s_now.scene=scene;s_chart_serial++;s_status[0]=0;APP_LOG(APP_LOG_LEVEL_INFO,"Chart built: about %lu ms of work; heap free %u",(unsigned long)s_build_ms,(unsigned)heap_bytes_free());}
  else{set_status("NO ROOM FOR THE CHART");APP_LOG(APP_LOG_LEVEL_ERROR,"Chart not finished: %s; heap free %u",chart_failure(),(unsigned)heap_bytes_free());}
  layer_mark_dirty(s_layer);
}

// What the watch still needs.
static void check(time_t now){if(!covers(&s_now,now))build(now);else need_data(now);}

static void update(Layer *layer,GContext *ctx){
  const time_t now=time(NULL);
  if(!covers(&s_now,now)){
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
  // emery is rectangular: every row is a full row of GColor8 bytes.
  const int minute=(int)((now-s_now.scene->hour_start)/60);
  const bool partial=s_tick_redraw&&s_drawn_serial==s_chart_serial&&s_drawn_minute>=0&&s_drawn_minute<=minute;
  const int drawn=enr_render_update(s_now.scene,partial?s_drawn_minute:-1,minute,gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  graphics_release_frame_buffer(ctx,frame);
  // Without the memory to draw, the next tick tries the whole minute again.
  if(drawn<0){APP_LOG(APP_LOG_LEVEL_WARNING,"No room to draw; heap free %u",(unsigned)heap_bytes_free());s_drawn_minute=-1;s_tick_redraw=false;return;}
  s_drawn_serial=s_chart_serial;s_drawn_minute=minute;s_tick_redraw=false;s_painted=true;
}

static void tick(struct tm *when,TimeUnits changed){
  check(time(NULL));
  s_tick_redraw=true;
  layer_mark_dirty(s_layer);
}
// Back from a notification or a menu: the screen holds something else.
static void focus_changed(bool focused){if(focused){s_drawn_minute=-1;s_painted=false;layer_mark_dirty(s_layer);}}

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
static int32_t le32(const uint8_t *p){return (int32_t)((uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24);}
// Settings as the phone packs them: body, plate, flag, clock24, home, then
// home's latitude and longitude in hundredths of a degree (i32 each), then
// a satellite's catalog number (i32), its kind (1 a station, plus its view
// times 2) and its code (3 characters), then the callout's figures and the
// margin's time, the world band's time scale and how its minutes fall on
// the route, the figure set and the margins' corner (see
// native/pkjs/main.js; an older phone app sends 25 or 26 bytes).
static void take_settings(const uint8_t *b,size_t n){
  if(n<25)return;
  WatchSettings s;memset(&s,0,sizeof s);
  s.version=7;s.body=b[0];s.plate=b[1];s.readout=b[2];s.clock24=b[3];s.home=b[4];s.lat100=le32(b+5);s.lon100=le32(b+9);
  s.norad=le32(b+13);s.station=b[17]&1;s.view=b[17]>>1;memcpy(s.code,b+18,3);s.numerals=b[21];s.zone_body=b[22];s.tape=b[23];s.transfer=b[24];s.figures=n>25?b[25]:2;s.corner=n>26?b[26]:0;
  // The phone sends its settings as it starts: the moment to ask for what
  // is missing (a request made before it was listening is lost).
  if(!memcmp(&s,&s_settings,sizeof s)){s_data_ok_until=0;s_data_asked_at=0;check(time(NULL));return;}
  s_settings=s;settings_save(&s);s_data_ok_until=0;
  // Drawn again in the new settings.
  build_abort();chart_free(&s_now);s_status[0]=0;
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
  if((t=dict_find(in,MESSAGE_KEY_Events))){events_store(t->value->data,t->length);data_arrived(true);}
  if((t=dict_find(in,MESSAGE_KEY_Passes))){pass_blocks_store(t->value->data,t->length,&s_settings);data_arrived(true);}
  // Why the phone can't give what the watch asked for (no orbit, say).
  if((t=dict_find(in,MESSAGE_KEY_Status))){set_status(t->value->cstring);layer_mark_dirty(s_layer);}
}
static void outbox_failed(DictionaryIterator *it,AppMessageResult reason,void *context){s_data_asked_at=0;}

// The watch's own state in the margins' corner: the phone out of reach,
// then a low battery (at most 20%, not charging); the minute drawn whole
// again when it changes.
static void show_state(void){
  static char shown[8];char text[8]={0};
  const BatteryChargeState b=battery_state_service_peek();const int c=b.charge_percent;
  if(!connection_service_peek_pebble_app_connection())memcpy(text,"NO LINK",7);
  else if(c<=20&&!b.is_charging){memcpy(text,"BAT ",4);text[4]=(char)('0'+c/10);text[5]=(char)('0'+c%10);}
  if(!memcmp(text,shown,8))return;
  memcpy(shown,text,8);enr_status(text);s_drawn_minute=-1;if(s_layer)layer_mark_dirty(s_layer);
}
static void battery_changed(BatteryChargeState state){show_state();}
static void connection_changed(bool connected){show_state();}
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
  battery_state_service_subscribe(battery_changed);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler=connection_changed});
  show_state();
  check(time(NULL));
}
static void deinit(void){
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
