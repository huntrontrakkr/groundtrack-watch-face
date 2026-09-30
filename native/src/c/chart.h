// The hour chart drawn on the watch: the camera, the ground (land, coast,
// relief, contours) and every symbol fixed for the hour, as the class plane
// the minute renderer (enroute_core.c) colours. It mirrors buildScene in
// src/native-scene.js and the base layer of src/enroute-render.js step for
// step, so the scene it builds is the phone's to the byte.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "map_pack.h"
#include "segments.h"
#include "enroute_core.h"

enum {PLATE_ZONES=1,PLATE_SCAN=2,PLATE_TERMINATOR=4,PLATE_NIGHT_DOTS=8,PLATE_MONO=16,PLATE_DOTS=32,PLATE_WATERLINE=64};
typedef struct {
  uint16_t flags;
  uint8_t zoned[9][3];     // water land coast contour shelf grid route ink mark, by zone
  uint8_t space,space_ink,screen,waterline,terminator,night_dots;
  uint8_t tint_count,tints[5];double tint_limits[5];
  uint8_t depth_count,depths[2];double depth_limits[2];
} Plate;
typedef struct {char code[4];double lat,lon;} Station;
typedef struct {uint8_t width,height;uint16_t first;} FigureGlyph;

#define CHART_TRACK_MAX 141
typedef struct {
  int body;                  // 0 the Sun, 1 the Moon
  int plate;                 // index into PLATES (src/enroute-render.js order)
  bool flag;                 // the minute flag
  bool clock24;
  int64_t start;             // the hour's first second (Unix time)
  int local_hour;            // the local clock's hour at start, 0-23
  int day,month,year,day_of_year;   // the local date at start
  bool home;double home_lat,home_lon;
  char rise_left[24],rise_right[24];  // home's rise and set line ("HOM SR 0650", "SS 1841"), or empty
} ChartInput;

// The Sun and Moon segment for a UTC day, or NULL.
typedef const Segment *(*SegmentFn)(void *context,int32_t day);

// Where a build reads from and how it takes memory: the map pack, the
// figures' bits (native/resources/figures.bin), the Sun and Moon segments,
// and an allocator. A build holds about 80 KB at its peak, freed as it goes.
typedef struct {
  MapReadFn map;void *map_source;
  MapReadFn figures;void *figure_source;
  SegmentFn segment;void *segment_context;
  void *(*alloc)(size_t);void (*release)(void *);
} ChartSources;

// Builds the hour's scene: the minute renderer's own (enr_real values:
// floats on the watch, doubles on the host, computed in double either way),
// its track and its class plane as runs allocated with src->alloc. Free it
// with enr_free(scene, release) and release(scene). Returns NULL if a
// segment, the map or memory is missing.
EnrScene *chart_build(const ChartInput *in,const ChartSources *src);
// The same in steps, so the watch keeps answering its events: chart_begin
// (the track and camera), chart_step until it returns 0 (the ground, a slice
// of CHART_STEP_ROWS rows each; -1 on failure), then chart_finish (the
// drawing and the scene; frees the build). chart_abort frees an unfinished
// build.
#define CHART_STEP_ROWS 12
typedef struct ChartBuild ChartBuild;
ChartBuild *chart_begin(const ChartInput *in,const ChartSources *src);
int chart_step(ChartBuild *build);
EnrScene *chart_finish(ChartBuild *build);
void chart_abort(ChartBuild *build);
// The class plane (200x228 bytes) as row runs of (count, class), as the
// phone packs them; allocated with alloc and owned by the scene.
bool chart_runs(const uint8_t *classes,EnrScene *scene,void *(*alloc)(size_t));
