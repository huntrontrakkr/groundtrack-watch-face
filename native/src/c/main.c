// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The watch draws each hour's chart itself, from its own map (a resource)
// and the Sun, Moon and satellite segments the phone sends days or weeks
// ahead: the phone isn't needed hour to hour. Each minute it draws what
// changed with the native core. There is no animation, no sensor and no
// timer but the minute tick. Until a chart covers the current hour, the
// face says so plainly rather than showing a stale one.
#include "build_size.h"
#include <pebble.h>
#include "enroute_core.h"
#include "departure_font.h"
#include "fmath.h"
#include "watch_data.h"
#include "chart.h"

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
void app_note(const char *what,unsigned n){APP_LOG(APP_LOG_LEVEL_INFO,"%s %u; heap %u; stack %u of %u",what,n,(unsigned)heap_bytes_free(),stack_deepest(),(unsigned)STACK_BYTES);}
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
  if(r<0){app_note("chart",chart_failed_at);build_abort();s_status_phone=false;set_status("NO ROOM FOR THE CHART");layer_mark_dirty(s_layer);return;}
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
  int drawn=enr_render_update(s_now.scene,partial?s_drawn_minute:-1,minute,gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  // (Drawing over the last minute takes more memory than drawing the minute
  // whole: without it, the whole.)
  if(drawn<0&&partial)drawn=enr_render_update(s_now.scene,-1,minute,gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  graphics_release_frame_buffer(ctx,frame);
  // Without the memory to draw, the next tick tries the whole minute again.
  if(drawn<0){app_note("draw",0);s_drawn_minute=-1;s_tick_redraw=false;return;}
  s_drawn_serial=s_chart_serial;s_drawn_minute=minute;s_tick_redraw=false;s_painted=true;
}

static void tick(struct tm *when,TimeUnits changed){
  // (The stack's deepest, logged when it has grown: a minute's drawing too.)
  {static unsigned logged;const unsigned d=stack_deepest();if(d>logged){logged=d;app_note("stack",d);}}
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
  s.version=12;s.figures=2;
  // Wire bytes are little-endian on both Pebble and the host; the three
  // coordinate/catalog fields and the option bytes are contiguous.
  memcpy(&s.body,b,5);memcpy(&s.lat100,b+5,12);
  s.station=b[17]&1;s.view=b[17]>>1;memcpy(s.code,b+18,3);
  memcpy(&s.numerals,b+21,n>=39?18:n-21<10?n-21:10);
  // The phone sends its settings as it starts: the moment to ask for what
  // is missing (a request made before it was listening is lost).
  s_data_ok_until=0;s_data_asked_at=0;s_data_tries=0;
  if(!memcmp(&s,&s_settings,sizeof s)){check_soon();return;}
  s_settings=s;settings_save(&s);show_state();
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
  const int state=(b.is_charging?ENR_CHARGING:0)|(linked?0:ENR_NO_LINK)|(s_settings.watch&2?ENR_NO_FUEL:0);
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
