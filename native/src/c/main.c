// Groundtrack Enroute for Pebble Time 2 (emery, 200x228, 64 colors).
//
// The phone sends the hour's scene once an hour; the watch draws each
// minute from it with the native core. There is no animation, no sensor
// and no timer but the minute tick. Until a scene arrives, or once it no
// longer covers the current hour, the face says so plainly rather than
// showing a stale chart.
#include <pebble.h>
#include "enroute_core.h"

static Window *s_window;
static Layer *s_layer;
static EnrScene *s_scene;          // parsed scene, or NULL
static uint8_t *s_blob;            // the scene as received; its class plane is borrowed
static uint32_t s_blob_size,s_received;
static bool s_requested;

static void request_scene(void){
  if(s_requested)return;
  DictionaryIterator *out;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK)return;
  dict_write_int32(out,MESSAGE_KEY_SceneRequest,(int32_t)time(NULL));
  if(app_message_outbox_send()==APP_MSG_OK)s_requested=true;
}

static void drop_scene(void){
  if(s_scene){enr_free(s_scene,free);free(s_scene);s_scene=NULL;}
  if(s_blob){free(s_blob);s_blob=NULL;}
  s_blob_size=s_received=0;
}

static void update(Layer *layer,GContext *ctx){
  const time_t now=time(NULL);
  if(!s_scene||now<s_scene->hour_start||now>=s_scene->hour_start+3600){
    // No chart for this hour: an honest blank with a note, and a request.
    graphics_context_set_fill_color(ctx,GColorBlack);
    graphics_fill_rect(ctx,layer_get_bounds(layer),0,GCornerNone);
    graphics_context_set_text_color(ctx,GColorWhite);
    graphics_draw_text(ctx,s_blob?"RECEIVING CHART":"AWAITING CHART",fonts_get_system_font(FONT_KEY_GOTHIC_14),
      GRect(0,100,ENR_W,20),GTextOverflowModeTrailingEllipsis,GTextAlignmentCenter,NULL);
    request_scene();
    return;
  }
  GBitmap *frame=graphics_capture_frame_buffer(ctx);
  if(!frame)return;
  // emery is rectangular: every row is a full row of GColor8 bytes.
  enr_render(s_scene,(int)((now-s_scene->hour_start)/60),gbitmap_get_data(frame),gbitmap_get_bytes_per_row(frame));
  graphics_release_frame_buffer(ctx,frame);
}

static void tick(struct tm *when,TimeUnits changed){layer_mark_dirty(s_layer);}

// The scene arrives in chunks: its total size first, then each chunk with
// its offset. A new total starts a new scene.
static void inbox(DictionaryIterator *in,void *context){
  Tuple *total=dict_find(in,MESSAGE_KEY_SceneTotal),*offset=dict_find(in,MESSAGE_KEY_SceneOffset),*chunk=dict_find(in,MESSAGE_KEY_SceneChunk);
  if(total){
    drop_scene();
    s_blob_size=total->value->uint32;
    s_blob=malloc(s_blob_size);
    if(!s_blob){APP_LOG(APP_LOG_LEVEL_ERROR,"No room for a %lu byte scene",(unsigned long)s_blob_size);s_blob_size=0;}
  }
  if(chunk&&offset&&s_blob){
    const uint32_t at=offset->value->uint32,n=chunk->length;
    if(at+n<=s_blob_size){memcpy(s_blob+at,chunk->value->data,n);s_received+=n;}
    if(s_received==s_blob_size){
      s_scene=malloc(sizeof *s_scene);
      if(!s_scene||!enr_parse(s_blob,s_blob_size,s_scene,malloc,true)){
        APP_LOG(APP_LOG_LEVEL_ERROR,"Malformed scene");
        if(s_scene){enr_free(s_scene,free);free(s_scene);s_scene=NULL;}
        free(s_blob);s_blob=NULL;
      }
      s_requested=false;
      layer_mark_dirty(s_layer);
    }
  }
}
static void outbox_failed(DictionaryIterator *it,AppMessageResult reason,void *context){s_requested=false;}

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
  app_message_open(app_message_inbox_size_maximum(),64);
  tick_timer_service_subscribe(MINUTE_UNIT,tick);
}
static void deinit(void){
  tick_timer_service_unsubscribe();
  drop_scene();
  window_destroy(s_window);
}

int main(void){
  init();
  app_event_loop();
  deinit();
}
