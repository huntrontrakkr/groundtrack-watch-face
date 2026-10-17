// The Round 2's code blobs (tools/build-blobs.py): the chart builder and the
// minute renderer, each kept in a resource and loaded into the heap only
// while it is wanted, so that neither counts against PebbleOS's 64 KB cap on
// an app (its size is kept in 16 bits), and a build has the renderer's
// memory, a minute's drawing the builder's. main.c loads the builder for a
// build and lets it go after; the renderer the rest of the time. The Time 2
// builds them into the app as ever.
//
// A blob is linked at address 0, its entry table first: the image, its
// zeroed memory, and the words holding absolute addresses (main.c adds the
// load address to each). It carries no library but libgcc's arithmetic and
// a few functions of its own (native/blob/blob_libc.c); its memory comes
// from the app's allocator, handed it by init.
#pragma once
#include "chart.h"

#define GT_BLOB_MAGIC 0x42435447u        // "GTCB"
// The structures the app and a blob share, by size: a blob built against
// others is refused.
#define GT_BLOB_LAYOUT ((uint32_t)(sizeof(EnrScene)^sizeof(EnrMinute)<<12^sizeof(ChartInput)<<20^sizeof(ChartSources)<<26))

typedef struct {
  uint32_t magic,image,bss,relocs,api;   // the resource's header
} GtBlobHeader;

typedef struct {
  uint32_t magic,layout;
  // The allocator the blob's malloc and free call, and the lettering's
  // glyphs (font.bin, kept by the app).
  void (*init)(void *(*alloc)(size_t),void (*release)(void *),const uint8_t *font);
  ChartBuild *(*begin)(const ChartInput *in,const ChartSources *src);
  int (*step)(ChartBuild *build);
  EnrScene *(*finish)(ChartBuild *build);
  void (*abort)(ChartBuild *build);
  const unsigned *failed_at;             // where a build last failed (chart.c chart_failed_at)
} GtBuilderApi;

typedef struct {
  uint32_t magic,layout;
  void (*init)(void *(*alloc)(size_t),void (*release)(void *),const uint8_t *font);
  int (*render_update)(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride);
  void (*free)(EnrScene *scene,void (*release)(void *));
  void (*status)(const char *text);
  void (*power)(int percent,int state);
} GtRendererApi;
