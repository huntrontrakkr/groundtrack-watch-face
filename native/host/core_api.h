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
// The allocator the builds and scenes use (malloc's family by default).
void core_allocator(void *(*alloc)(size_t),void (*release)(void *),void *(*resize)(void *,size_t));
// A resource: 0 the map pack, 1 the figures, 2 the tables, 3 the Fuller
// grids, 4 the coastline bits. The bytes stay the caller's until replaced.
enum {CORE_MAP,CORE_FIGURES,CORE_TABLES,CORE_GRIDS,CORE_LAND};
void core_source(int kind,const uint8_t *data,size_t length);
// Builds the hour from the input text (src/chart-input.js: key value
// lines, segments as hex) into one of CORE_SLOTS scenes, freeing what that
// slot held. 1 on success.
#define CORE_SLOTS 32
int core_build(const char *text,size_t length,int slot);
// Why the last build failed.
const char *core_failure(void);
// The ground kept between builds, in memory: on or off (off forgets), and how
// many slices of ground have been written to it (a build that took its
// ground from it writes none).
void core_keep(int on);
int core_kept(void);
// A slot's scene (NULL without one), and the offsets JavaScript reads it
// by: core_layout fills out with sizeof(EnrScene), sizeof(EnrPoint),
// sizeof(EnrMinute) and the offsets listed in core_api.c.
const EnrScene *core_scene(int slot);
int core_layout(int32_t *out,int max);
// A minute's frame (200x228 GColor8, row stride 200) drawn whole, or over
// the frame as minute `from` left it. Returns the base pixels drawn.
int core_render(int slot,int minute,uint8_t *frame);
// The study's measures (enr_measure, enr_text_box, enr_text_width,
// enr_class, enr_zone in enroute_core.h), on a slot's scene.
void core_measure(int slot,int minute,int part,int16_t *out);
void core_text_box(const char *text,int n,int x,int baseline,int16_t *out);
int core_text_width(const char *text,int n);
// The watch's state in the margins' corner (enr_status): "NO LINK", "BAT 18", or n 0 for none.
void core_status(const char *text,int n);
// The battery for the fuel line: percent, and ENR_CHARGING | ENR_NO_LINK.
void core_power(int percent,int state);
int core_class(int slot,int x,int y);
int core_zone(int slot,int minute,int x,int y);
int core_render_update(int slot,int from,int minute,uint8_t *frame);
