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

// PLATE_SHADE: land shaded by its slope, lit from the northwest (the tints
// are the light classes); PLATE_LATTICE: the ground as a lattice of dots,
// their size by height (the tints), drawn by the minute renderer.
enum {PLATE_ZONES=1,PLATE_SCAN=2,PLATE_TERMINATOR=4,PLATE_NIGHT_DOTS=8,PLATE_MONO=16,PLATE_DOTS=32,PLATE_WATERLINE=64,PLATE_SHADE=128,PLATE_LATTICE=256,PLATE_HAL=512};
// PLATE_HAL: the Sun drawn as HAL 9000's eye (2001: A Space Odyssey).
typedef struct {
  uint16_t flags;
  uint8_t zoned[9][3];     // water land coast contour shelf grid route ink mark, by zone
  uint8_t space,space_ink,screen,waterline,terminator,night_dots;
  uint8_t tint_count,tints[5];double tint_limits[5];
  uint8_t depth_count,depths[2];double depth_limits[2];
  int32_t tint_q[5],depth_q[2];   // the limits in Q8 metres
} Plate;
typedef struct {char code[4];double lat,lon;} Station;
typedef struct {uint8_t width,height;uint32_t first;} FigureGlyph;

// Track points: 141 on the hour chart, 401 on the world band.
#define CHART_TRACK_MAX 401
// A rolling Fuller sheet's: 321 for a satellite's hour, at most 301 for a
// day (of 25 hours).
#define FULLER_TRACK_MAX 321
typedef struct {
  int body;                  // 0 the Sun, 1 the Moon, 2 a satellite, 3 a space station
  int view;                  // 0 the hour chart, 1 the world band (fast satellites), 2 the whole day (QZSS)
  bool fuller;               // a rolling Fuller sheet of the hour (a satellite) or the day (view 2)
  int64_t day_start,day_end; // the local day (whole-day chart): its midnights
  uint8_t day_hours[27];     // the local clock's hour at day_start + k hours
  char code[4];              // a satellite's code ("ISS"), for the world band's margin
  int plate;                 // index into PLATES (src/enroute-render.js order)
  bool flag;                 // the minute flag (readout 1)
  int readout;               // the minute readout: 0 none, 1 the flag, 2 a time callout
  int numerals;              // the callout's figures (ENR_COLON ... ENR_ACCENT)
  int figures;               // the figure set (FIGURE_SETS in src/plates.js: 0 Jost)
  bool zone_body;            // the margin's time in the nautical zone under the body, not Zulu
  int tape;                  // the world band's time scale: 0 fixed, 1 a sliding tape, 2 the world sliding too, 3 a clock
  int also;                  // the Sun (1) and the Moon (2) marked beside the body
  int transfer;              // on the fixed tape, how its minutes fall on the route: 0 off, 1 vernier, 2 comb, 3 chevrons
  // Events, set on the route as compulsory reporting points: their times
  // (Unix seconds) and five-letter name codes.
  int event_count;
  struct {int64_t t;char name[6];} events[16];
  bool clock24;
  int64_t start;             // the hour's first second (Unix time)
  int local_hour;            // the local clock's hour at start, 0-23
  int day,month,year,day_of_year;   // the local date at start
  int weekday;               // its day of the week, 0 Sunday
  // The corner of the margins (the bottom right; on the world band the
  // right of the line over it): 0 the day of the year (the world band: the
  // satellite's height), 1 the body's ground point, 2 the Moon's light.
  int corner;
  bool home;double home_lat,home_lon;
  char rise_left[24],rise_right[24];  // home's rise and set line ("HOM SR 0650", "SS 1841"), or empty
} ChartInput;

// The Sun and Moon segment for a UTC day, or NULL.
typedef const Segment *(*SegmentFn)(void *context,int32_t day);

// Where a build reads from and how it takes memory: the map pack, the
// figures' bits (native/resources/figures.bin), the Sun and Moon segments,
// and an allocator. A build holds about 50 KB at its peak, freed as it goes.
typedef struct {
  MapReadFn map;void *map_source;
  MapReadFn figures;void *figure_source;
  MapReadFn tables;void *table_source;   // native/resources/tables.bin
  // The Fuller sheets' faces' grids (fuller.bin) and, zoomed in, the
  // quarter-degree coastline (land.pack, tools/land-pack.mjs).
  MapReadFn grids;void *grid_source;
  MapReadFn land;void *land_source;
  SegmentFn segment;void *segment_context;
  // A satellite's segment for a time (in Unix seconds), and home's pass line
  // at a time into out (24 characters, '°' as 0x7f; empty for none).
  const SatSegment *(*satellite)(void *context,int64_t t);void *satellite_context;
  void (*pass_line)(void *context,int64_t t,char out[24]);void *pass_context;
  void *(*alloc)(size_t);void (*release)(void *);
  // Shrinks an allocation in place or moves it (realloc); may be NULL.
  void *(*resize)(void *,size_t);
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
// Why the last build failed, for the log.
const char *chart_failure(void);
// The figures the day's time callout sets each minute (20, 28 and 40 px),
// read from the figures resource into the scene.
bool chart_callout_figures(EnrScene *scene,MapReadFn read,void *source,void *(*alloc)(size_t));
