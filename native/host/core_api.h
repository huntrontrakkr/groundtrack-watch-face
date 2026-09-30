// The core (the watch's chart builder and minute renderer) behind a flat
// interface: for the host tools, and compiled to WebAssembly for the study
// (tools/build-core.sh, src/core.js). Everything is ints, pointers and
// bytes in the core's own memory.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include "../src/c/enroute_core.h"

// Memory the caller fills (resources, the input text) and frees.
void *core_alloc(size_t n);
void core_free(void *p);
// A resource: 0 the map pack, 1 the figures, 2 the tables, 3 the Fuller
// grids, 4 the coastline bits. The bytes stay the caller's until replaced.
enum {CORE_MAP,CORE_FIGURES,CORE_TABLES,CORE_GRIDS,CORE_LAND};
void core_source(int kind,const uint8_t *data,size_t length);
// Builds the hour from the input text (tools/chart-input.mjs: key value
// lines, segments as hex), freeing the last scene. 1 on success.
int core_build(const char *text,size_t length);
// Why the last build failed.
const char *core_failure(void);
// The scene built (NULL without one), and the offsets JavaScript reads it
// by: core_layout fills out with sizeof(EnrScene), sizeof(EnrPoint),
// sizeof(EnrMinute) and the offsets listed in core_api.c.
const EnrScene *core_scene(void);
int core_layout(int32_t *out,int max);
// A minute's frame (200x228 GColor8, row stride 200) drawn whole, or over
// the frame as minute `from` left it. Returns the base pixels drawn.
int core_render(int minute,uint8_t *frame);
int core_render_update(int from,int minute,uint8_t *frame);
