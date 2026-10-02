// The watch app itself (main.c, watch_data.c and the core) on the host, over
// a stand-in for the Pebble SDK with a clock that is told the time: storage,
// timers, messages, resources and a frame to draw in. tests/watch.test.mjs
// plays the phone to it. It reads commands, a line each, in place of the
// SDK's event loop, and answers each with lines of JSON and then a ".":
//
//   run <seconds>        the clock on, minute ticks and timers firing
//   msg <Key> <hex>      a message from the phone (bytes)
//   text <Key> <text>    the same, a string
//   body <Key> <hex> <norad>   bytes with whose they are (DataBody)
//   link <0|1>           the phone out of reach, or back
//   battery <percent>    the battery (not charging)
//   focus                back from a notification
//   frame <file>         the frame as drawn, to a file (GColor8 bytes)
//
// {"request":day,"body":norad} is a request for data the watch sent;
// {"t":...,"note":...,"chart":...,"minute":...} what its screen holds: a
// note (no chart) or the chart's hour and the minute drawn.
// Built with -Dtime=sim_time and the allocator's names likewise (see the
// Makefile): SIM_HEAP is the heap's size in bytes (the watch's, about
// 62000), modelled as the watch's is (heap_model.h).
#undef malloc
#undef free
#undef realloc
#undef time
#undef main
#include <pebble.h>
#include <stdio.h>
#include "../src/c/enroute_core.h"

// ---- the clock
static int64_t s_ms;
time_t sim_time(time_t *out){const time_t t=(time_t)(s_ms/1000);if(out)*out=t;return t;}
// (Work takes time: each look at the milliseconds finds 7 more gone, so a
// build runs in slices as the watch's does.)
uint16_t time_ms(time_t *t,uint16_t *ms){s_ms+=7;if(t)*t=(time_t)(s_ms/1000);if(ms)*ms=(uint16_t)(s_ms%1000);return (uint16_t)(s_ms%1000);}

// ---- the heap, modelled (heap_model.h: first fit, as the watch's)
#include "heap_model.h"
void *sim_malloc(size_t n){return hm_malloc(n);}
void sim_free(void *q){hm_release(q);}
void *sim_realloc(void *q,size_t n){return hm_realloc(q,n);}
size_t heap_bytes_free(void){return hm_free_bytes();}

// ---- storage
typedef struct {uint32_t key;int n;uint8_t *data;} Kept;
static Kept s_kept[512];static int s_kept_n;
static Kept *kept(uint32_t key){for(int i=0;i<s_kept_n;i++)if(s_kept[i].key==key)return &s_kept[i];return NULL;}
int persist_read_data(const uint32_t key,void *buffer,const size_t size){Kept *k=kept(key);if(!k)return -1;const int n=k->n<(int)size?k->n:(int)size;memcpy(buffer,k->data,n);return n;}
int persist_write_data(const uint32_t key,const void *data,const size_t size){
  Kept *k=kept(key);if(!k){if(s_kept_n==512)return -1;k=&s_kept[s_kept_n++];k->key=key;k->data=NULL;}
  // (The watch keeps at most 256 bytes under a key.)
  const size_t n=size<256?size:256;k->data=realloc(k->data,n?n:1);memcpy(k->data,data,n);k->n=(int)n;return (int)n;
}
int persist_delete(uint32_t key){Kept *k=kept(key);if(!k)return -1;free(k->data);*k=s_kept[--s_kept_n];return 0;}

// ---- resources
static struct {uint8_t *bytes;size_t n;} s_res[8];
static void resource(int id,const char *path){FILE *f=fopen(path,"rb");if(!f)return;fseek(f,0,SEEK_END);const long n=ftell(f);rewind(f);s_res[id].bytes=malloc(n);s_res[id].n=fread(s_res[id].bytes,1,n,f);fclose(f);}
ResHandle resource_get_handle(uint32_t id){return (ResHandle)(uintptr_t)id;}
size_t resource_size(ResHandle h){return s_res[(uintptr_t)h].n;}
size_t resource_load_byte_range(ResHandle h,uint32_t at,uint8_t *out,size_t n){const size_t size=s_res[(uintptr_t)h].n;if(at>=size)return 0;if(at+n>size)n=size-at;memcpy(out,s_res[(uintptr_t)h].bytes+at,n);return n;}
size_t resource_load(ResHandle h,uint8_t *out,size_t n){return resource_load_byte_range(h,0,out,n);}

// ---- the window, its layer and the frame
struct Layer {LayerUpdateProc update;bool dirty;};
struct GBitmap {uint8_t data[ENR_W*ENR_H];};
static struct Layer s_layer_;static struct GBitmap s_frame;static WindowHandlers s_handlers;
static char s_note[64];static bool s_captured;
Window *window_create(void){return (Window *)&s_handlers;}
void window_destroy(Window *w){if(s_handlers.unload)s_handlers.unload(w);}
void window_set_window_handlers(Window *w,WindowHandlers h){s_handlers=h;}
void window_stack_push(Window *w,bool animated){if(s_handlers.load)s_handlers.load(w);}
void window_set_background_color(Window *w,GColor c){}
Layer *window_get_root_layer(const Window *w){return &s_layer_;}
Layer *layer_create(GRect frame){return &s_layer_;}
void layer_destroy(Layer *l){}
GRect layer_get_bounds(const Layer *l){return GRect(0,0,ENR_W,ENR_H);}
void layer_set_update_proc(Layer *l,LayerUpdateProc u){l->update=u;}
void layer_add_child(Layer *parent,Layer *child){}
void layer_mark_dirty(Layer *l){if(l)l->dirty=true;}
GBitmap *graphics_capture_frame_buffer(GContext *ctx){s_captured=true;return &s_frame;}
bool graphics_release_frame_buffer(GContext *ctx,GBitmap *b){return true;}
uint8_t *gbitmap_get_data(const GBitmap *b){return (uint8_t *)b->data;}
uint16_t gbitmap_get_bytes_per_row(const GBitmap *b){return ENR_W;}
void graphics_context_set_fill_color(GContext *ctx,GColor c){}
void graphics_context_set_text_color(GContext *ctx,GColor c){}
void graphics_fill_rect(GContext *ctx,GRect r,uint16_t radius,GCornerMask m){memset(s_frame.data,0xC0,sizeof s_frame.data);}
void graphics_draw_text(GContext *ctx,const char *text,GFont font,GRect box,GTextOverflowMode o,GTextAlignment a,GTextAttributes *t){snprintf(s_note,sizeof s_note,"%s",text);}
GFont fonts_get_system_font(const char *key){return NULL;}
// What the screen holds after a redraw: a note, or the frame the app drew.
static int s_drawn=-1;        // 1 a chart, 0 a note, -1 nothing yet
static void redraw(void){
  while(s_layer_.dirty&&s_layer_.update){s_layer_.dirty=false;s_note[0]=0;s_captured=false;s_layer_.update(&s_layer_,NULL);if(s_captured)s_drawn=1;else if(s_note[0])s_drawn=0;}
}

// ---- services
static TickHandler s_tick;static AppFocusHandler s_focus;static BatteryStateHandler s_battery;static ConnectionHandlers s_connection;
static BatteryChargeState s_charge={80,false,false};static bool s_linked=true;
void tick_timer_service_subscribe(TimeUnits u,TickHandler h){s_tick=h;}
void tick_timer_service_unsubscribe(void){s_tick=NULL;}
void app_focus_service_subscribe(AppFocusHandler h){s_focus=h;}
void app_focus_service_unsubscribe(void){s_focus=NULL;}
BatteryChargeState battery_state_service_peek(void){return s_charge;}
void battery_state_service_subscribe(BatteryStateHandler h){s_battery=h;}
void battery_state_service_unsubscribe(void){s_battery=NULL;}
bool connection_service_peek_pebble_app_connection(void){return s_linked;}
void connection_service_subscribe(ConnectionHandlers h){s_connection=h;}
void connection_service_unsubscribe(void){}
void app_log(uint8_t level,const char *file,int line,const char *fmt,...){}

// ---- timers
struct AppTimer {int64_t due;AppTimerCallback cb;void *data;bool live;};
static struct AppTimer s_timers[16];
AppTimer *app_timer_register(uint32_t ms,AppTimerCallback cb,void *data){for(int i=0;i<16;i++)if(!s_timers[i].live){s_timers[i]=(struct AppTimer){s_ms+ms,cb,data,true};return &s_timers[i];}fprintf(stderr,"out of timers\n");exit(3);}
bool app_timer_reschedule(AppTimer *t,uint32_t ms){if(!t->live)return false;t->due=s_ms+ms;return true;}
void app_timer_cancel(AppTimer *t){t->live=false;}

// ---- messages
uint32_t MESSAGE_KEY_Status=1,MESSAGE_KEY_Settings=2,MESSAGE_KEY_Segments=3,MESSAGE_KEY_RiseSets=4,MESSAGE_KEY_DataRequest=5,MESSAGE_KEY_DataBody=6,MESSAGE_KEY_SatSegments=7,MESSAGE_KEY_Passes=8,MESSAGE_KEY_Events=9;
static const char *const KEYS[]={"","Status","Settings","Segments","RiseSets","DataRequest","DataBody","SatSegments","Passes","Events"};
struct DictionaryIterator {int n;Tuple *t[4];};
static struct DictionaryIterator s_out;static int32_t s_out_values[4];static uint32_t s_out_keys[4];
static AppMessageInboxReceived s_inbox;static AppMessageOutboxFailed s_outbox_failed;static uint32_t s_inbox_size;
AppMessageResult app_message_open(uint32_t in,uint32_t out){s_inbox_size=in;return APP_MSG_OK;}
uint32_t app_message_inbox_size_maximum(void){return 8200;}
AppMessageInboxReceived app_message_register_inbox_received(AppMessageInboxReceived f){s_inbox=f;return NULL;}
AppMessageOutboxFailed app_message_register_outbox_failed(AppMessageOutboxFailed f){s_outbox_failed=f;return NULL;}
AppMessageResult app_message_outbox_begin(DictionaryIterator **it){s_out.n=0;*it=&s_out;return APP_MSG_OK;}
DictionaryResult dict_write_int32(DictionaryIterator *it,const uint32_t key,const int32_t v){s_out_keys[it->n]=key;s_out_values[it->n++]=v;return DICT_OK;}
AppMessageResult app_message_outbox_send(void){
  int32_t day=-2,body=0;for(int i=0;i<s_out.n;i++){if(s_out_keys[i]==MESSAGE_KEY_DataRequest)day=s_out_values[i];if(s_out_keys[i]==MESSAGE_KEY_DataBody)body=s_out_values[i];}
  printf("{\"request\":%d,\"body\":%d,\"t\":%lld}\n",(int)day,(int)body,(long long)(s_ms/1000));
  // (Out of reach, the message fails a moment later.)
  if(!s_linked&&s_outbox_failed)s_outbox_failed(&s_out,(AppMessageResult)1,NULL);
  return APP_MSG_OK;
}
Tuple *dict_find(const DictionaryIterator *it,const uint32_t key){for(int i=0;i<it->n;i++)if(it->t[i]->key==key)return it->t[i];return NULL;}
static Tuple *tuple(uint32_t key,const uint8_t *bytes,size_t n){Tuple *t=malloc(sizeof(Tuple)+n+4);t->key=key;t->type=0;t->length=(uint16_t)n;memcpy((uint8_t *)t->value,bytes,n);return t;}
static void deliver(struct DictionaryIterator *in){if(s_inbox)s_inbox(in,NULL);for(int i=0;i<in->n;i++)free(in->t[i]);}
static uint32_t key_of(const char *name){for(uint32_t k=1;k<10;k++)if(!strcmp(KEYS[k],name))return k;fprintf(stderr,"no key %s\n",name);exit(3);}
static size_t unhex(const char *hex,uint8_t *out){size_t n=0;for(;hex[0]&&hex[1]&&hex[0]!='\n';hex+=2){unsigned v;sscanf(hex,"%2x",&v);out[n++]=(uint8_t)v;}return n;}

// ---- the event loop: the commands
static void state(void){
  redraw();
  uint32_t h=2166136261u;for(size_t i=0;i<sizeof s_frame.data;i++)h=(h^s_frame.data[i])*16777619u;
  printf("{\"t\":%lld,\"note\":%s%s%s,\"chart\":%s,\"hash\":%u,\"heap\":%u,\"peak\":%u}\n.\n",(long long)(s_ms/1000),s_drawn==0?"\"":"",s_drawn==0?s_note:"null",s_drawn==0?"\"":"",s_drawn==1?"true":"false",(unsigned)h,(unsigned)hm_live,(unsigned)hm_peak);
  fflush(stdout);
}
static void run_to(int64_t to){
  for(;;){
    // The next thing due: a timer, or the minute's tick.
    int64_t next=(s_ms/60000+1)*60000;int which=-1;
    for(int i=0;i<16;i++)if(s_timers[i].live&&s_timers[i].due<next){next=s_timers[i].due;which=i;}
    if(next>to)break;
    if(next>s_ms)s_ms=next;
    if(which>=0){s_timers[which].live=false;s_timers[which].cb(s_timers[which].data);}
    else if(s_tick){time_t t=(time_t)(s_ms/1000);s_tick(localtime(&t),MINUTE_UNIT);}
    redraw();
  }
  if(to>s_ms)s_ms=to;
}
void app_event_loop(void){
  static char line[20000];static uint8_t bytes[9000];
  state();
  while(fgets(line,sizeof line,stdin)){
    char key[32]={0};int at=0;
    if(!strncmp(line,"run ",4))run_to(s_ms+atoll(line+4)*1000);
    else if(!strncmp(line,"msg ",4)){
      sscanf(line+4,"%31s %n",key,&at);const size_t n=unhex(line+4+at,bytes);
      if(n+16>s_inbox_size){fprintf(stderr,"a message of %u bytes is more than the inbox takes\n",(unsigned)n);exit(3);}
      struct DictionaryIterator in={1,{tuple(key_of(key),bytes,n)}};deliver(&in);
    }
    else if(!strncmp(line,"body ",5)){
      int norad=0;char hex[1200]={0};sscanf(line+5,"%31s %1199s %d",key,hex,&norad);const size_t n=unhex(hex,bytes);const int32_t who=norad;
      struct DictionaryIterator in={2,{tuple(key_of(key),bytes,n),tuple(MESSAGE_KEY_DataBody,(const uint8_t *)&who,4)}};deliver(&in);
    }
    else if(!strncmp(line,"text ",5)){
      sscanf(line+5,"%31s %n",key,&at);char *text=line+5+at;text[strcspn(text,"\n")]=0;
      struct DictionaryIterator in={1,{tuple(key_of(key),(const uint8_t *)text,strlen(text)+1)}};deliver(&in);
    }
    else if(!strncmp(line,"link ",5)){s_linked=atoi(line+5)!=0;if(s_connection.pebble_app_connection_handler)s_connection.pebble_app_connection_handler(s_linked);}
    else if(!strncmp(line,"battery ",8)){s_charge.charge_percent=(uint8_t)atoi(line+8);if(s_battery)s_battery(s_charge);}
    else if(!strncmp(line,"focus",5)){if(s_focus)s_focus(true);}
    else if(!strncmp(line,"frame ",6)){line[strcspn(line,"\n")]=0;redraw();FILE *f=fopen(line+6,"wb");fwrite(s_frame.data,1,sizeof s_frame.data,f);fclose(f);}
    else{fprintf(stderr,"no command: %s",line);exit(3);}
    state();
  }
}

// The app, with its main as the simulator's.
int watch_main(void);
int main(int argc,char **argv){
  if(argc<2){fprintf(stderr,"usage: TZ=zone watch_sim <unix seconds>  (commands on stdin)\n");return 2;}
  s_ms=atoll(argv[1])*1000;
  hm_begin(getenv("SIM_HEAP")?(size_t)atol(getenv("SIM_HEAP")):0);
  resource(RESOURCE_ID_MAP_PACK,"native/resources/map.pack");resource(RESOURCE_ID_FIGURES,"native/resources/figures.bin");resource(RESOURCE_ID_TABLES,"native/resources/tables.bin");
  resource(RESOURCE_ID_FONT,"native/resources/font.bin");resource(RESOURCE_ID_FULLER_GRIDS,"native-fuller/resources/fuller.bin");resource(RESOURCE_ID_LAND_BITS,"native-fuller/resources/land.pack");
  watch_main();
  // What the app holds once it has closed (the lettering's glyphs stay for
  // its life: 1,679 bytes and the allocator's 8).
  printf("{\"held\":%u}\n",(unsigned)hm_live);
  return 0;
}
