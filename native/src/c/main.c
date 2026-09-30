// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The phone sends an hour's scene; the watch draws each minute from it with
// the native core. There is no animation, no sensor and no timer but the
// minute tick. Near the end of each hour the watch asks for the next hour's
// scene and keeps it until the hour turns, so the face never waits at the
// hour. Until a scene covers the current hour, the face says so plainly
// rather than showing a stale chart.
#include <pebble.h>
#include "enroute_core.h"

// Ask for the next hour this many minutes before it begins.
#define PREFETCH_MINUTES 5
// Ask again when a request has gone unanswered this long. Requests are only
// made on the minute tick, so this also bounds them to one a minute.
#define RETRY_SECONDS 50
// After the phone says it can't draw the hour, wait this long to ask again.
#define STATUS_QUIET_SECONDS 600
// A scene arrives in chunks of at most 2,000 bytes; this leaves room for
// the chunk's offset and the dictionary's own framing.
#define INBOX_SIZE 2100

typedef struct {
  EnrScene *scene;      // parsed, or NULL
  uint8_t *blob;        // the scene as received; its class plane is borrowed
} Chart;

static Window *s_window;
static Layer *s_layer;
static Chart s_now,s_next;         // this hour's chart and, once asked for, the next
static uint8_t *s_incoming;        // a scene being received
static uint32_t s_incoming_size,s_received;
static time_t s_asked_at;          // when a request was last sent, 0 if none is pending
static int32_t s_asked_for;        // the time whose hour it asked for
static char s_status[32];          // why the phone has no chart, if it said
static time_t s_quiet_until;       // no requests before this, after a status

static void chart_free(Chart *c){
  if(c->scene){enr_free(c->scene,free);free(c->scene);}
  free(c->blob);
  c->scene=NULL;c->blob=NULL;
}
static bool covers(const Chart *c,time_t t){
  return c->scene&&t>=c->scene->hour_start&&t<c->scene->hour_start+3600;
}

// At the hour, the prefetched chart takes over.
static void advance(time_t now){
  if(!covers(&s_now,now)&&covers(&s_next,now)){
    chart_free(&s_now);
    s_now=s_next;s_next=(Chart){NULL,NULL};
  }
}

// One request at a time, for the hour holding `when`; a new one only when
// the last has been answered or has waited RETRY_SECONDS.
static void request(time_t now,time_t when){
  if(s_asked_at&&now-s_asked_at<RETRY_SECONDS)return;
  if(now<s_quiet_until)return;
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return;
  dict_write_int32(out,MESSAGE_KEY_SceneRequest,(int32_t)when);
  if(app_message_outbox_send()==APP_MSG_OK){s_asked_at=now;s_asked_for=(int32_t)when;}
}

// What the watch still needs: this hour's chart, then near the hour's end
// the next one.
static void check(time_t now){
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
    graphics_draw_text(ctx,s_incoming?"RECEIVING CHART":s_status[0]?s_status:"AWAITING CHART",fonts_get_system_font(FONT_KEY_GOTHIC_14),
      GRect(0,100,ENR_W,20),GTextOverflowModeTrailingEllipsis,GTextAlignmentCenter,NULL);
    return;
  }
  GBitmap *frame=graphics_capture_frame_buffer(ctx);
  if(!frame)return;
  // emery is rectangular: every row is a full row of GColor8 bytes.
  enr_render(s_now.scene,(int)((now-s_now.scene->hour_start)/60),gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  graphics_release_frame_buffer(ctx,frame);
}

static void tick(struct tm *when,TimeUnits changed){
  check(time(NULL));
  layer_mark_dirty(s_layer);
}

// A received scene becomes this hour's chart or the next; one for any other
// hour is dropped. A new chart for this hour (new settings, say) also drops
// the next hour's, drawn as it was: it is asked for again.
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
  APP_LOG(APP_LOG_LEVEL_INFO,"Scene for %ld: %lu bytes",(long)c.scene->hour_start,(unsigned long)size);
  if(covers(&c,now)){chart_free(&s_now);chart_free(&s_next);s_now=c;}
  else if(c.scene->hour_start>now&&c.scene->hour_start<=now+3600){chart_free(&s_next);s_next=c;}
  else{APP_LOG(APP_LOG_LEVEL_WARNING,"Scene for another hour");chart_free(&c);}
  // The request is answered when its hour has arrived.
  if(s_asked_at&&c.scene&&s_asked_for>=c.scene->hour_start&&s_asked_for<c.scene->hour_start+3600)s_asked_at=0;
  advance(now);
  APP_LOG(APP_LOG_LEVEL_INFO,"Heap free: %u bytes",(unsigned)heap_bytes_free());
  layer_mark_dirty(s_layer);
}

// The scene arrives in order: its total size first, then each chunk with
// its offset. A new total starts a new scene. A chunk sent again (its
// acknowledgement lost) is ignored; one out of order abandons the scene,
// and the next request starts over.
static void inbox(DictionaryIterator *in,void *context){
  Tuple *total=dict_find(in,MESSAGE_KEY_SceneTotal),*offset=dict_find(in,MESSAGE_KEY_SceneOffset),*chunk=dict_find(in,MESSAGE_KEY_SceneChunk);
  Tuple *status=dict_find(in,MESSAGE_KEY_SceneStatus);
  if(status){
    strncpy(s_status,status->value->cstring,sizeof s_status-1);s_status[sizeof s_status-1]=0;
    s_asked_at=0;s_quiet_until=time(NULL)+STATUS_QUIET_SECONDS;
    layer_mark_dirty(s_layer);
  }
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
static void outbox_failed(DictionaryIterator *it,AppMessageResult reason,void *context){s_asked_at=0;}

static void window_load(Window *window){
  Layer *root=window_get_root_layer(window);
  s_layer=layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer,update);
  layer_add_child(root,s_layer);
}
static void window_unload(Window *window){layer_destroy(s_layer);}

static void init(void){
  s_window=window_create();
  window_set_window_handlers(s_window,(WindowHandlers){.load=window_load,.unload=window_unload});
  window_stack_push(s_window,false);
  app_message_register_inbox_received(inbox);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(INBOX_SIZE,64);
  tick_timer_service_subscribe(MINUTE_UNIT,tick);
  // The phone also sends this hour's scene when its side starts; asking
  // covers a phone side that is already running.
  check(time(NULL));
}
static void deinit(void){
  tick_timer_service_unsubscribe();
  chart_free(&s_now);chart_free(&s_next);
  free(s_incoming);
  window_destroy(s_window);
}

int main(void){
  init();
  app_event_loop();
  deinit();
}
