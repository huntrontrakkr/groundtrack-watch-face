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

// Working memory for a build, the caller's (about 30 KB; the watch
// allocates it for the build and frees it after): nothing is static.
typedef struct ChartWork ChartWork;
unsigned chart_work_size(void);

// Builds the hour's scene into `scene` (the minute renderer's own, with
// enr_real values: floats on the watch, doubles on the host, computed in
// double either way) and its class plane into `classes` (200x228 bytes);
// `track` holds CHART_TRACK_MAX points and becomes scene->track. Needs the
// map pack and its work rows, segments covering 40 minutes either side of
// the hour, and the work memory. Returns false if a segment or the map is
// missing. chart_runs then packs the class plane into the scene's runs.
bool chart_build(const ChartInput *in,const MapPack *pack,MapWork *map_work,SegmentFn segment,void *context,ChartWork *work,EnrScene *scene,uint8_t *classes,EnrPoint *track);
// The class plane as row runs of (count, class), as the phone packs them;
// allocated with alloc and owned by the scene. Returns false without memory.
bool chart_runs(const uint8_t *classes,EnrScene *scene,void *(*alloc)(size_t));
