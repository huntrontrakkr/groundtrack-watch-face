// The minute renderer's entry table, at the start of its code blob
// (tools/build-blobs.py; see src/c/blob.h). Built only into the blob.
#include "blob.h"
#include "departure_font.h"

void blob_allocator(void *(*alloc)(size_t),void (*release)(void *));
static void init(void *(*alloc)(size_t),void (*release)(void *),const uint8_t *font){blob_allocator(alloc,release);enr_font_load(font);}

__attribute__((used,section(".gt_api"))) const GtRendererApi gt_api={
  GT_BLOB_MAGIC,GT_BLOB_LAYOUT,init,enr_render_update,enr_free,enr_status,enr_power,
};
