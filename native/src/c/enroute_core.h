// Groundtrack Enroute, native core. Portable C with no Pebble dependency: the
// same code draws on the watch and in the host test harness.
//
// The phone renders an hour of the chart once, as a class plane: for each
// pixel, the ground under it (low nibble) and what, if anything, was drawn
// over it (high nibble), sent and kept as runs along each row. The watch colors it with the plate each minute, and
// adds what changes by the minute: night, the bold route behind the body,
// the body, the minute flag and Zulu time.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define ENR_W 200
#define ENR_H 228

// Arithmetic for night. Doubles match the browser renderer exactly; the
// watch can build with ENR_FLOAT to use its single-precision FPU instead.
#ifdef ENR_FLOAT
typedef float enr_real;
#else
typedef double enr_real;
#endif

enum {ENR_NIGHT_ZONES=1,ENR_SCAN=2,ENR_TERMINATOR=4,ENR_NIGHT_DOTS=8,ENR_MINUTE_FLAG=16};
enum {ENR_SUN,ENR_MOON,ENR_SATELLITE,ENR_STATION};
// Keys of the zoned palette, each with a day, dusk and night color.
enum {ENR_WATER,ENR_LAND,ENR_COAST,ENR_CONTOUR,ENR_SHELF,ENR_GRID,ENR_ROUTE,ENR_INK,ENR_MARK,ENR_ZONED};

typedef struct {
  enr_real sun[3];
  enr_real mx,my;
  enr_real moon_fraction;
  uint8_t waxing;
  char zulu[5];
  char minute[2];
  // A satellite's pass line over the chart, which can change within the
  // hour; empty when the phone drew the line into the hour's layer.
  char top[24];
} EnrMinute;

typedef struct {
  enr_real x,y;
  int32_t seconds;
  uint8_t hour;
} EnrPoint;

typedef struct {
  uint8_t flags,body;
  int8_t forward;
  // The hour the scene draws, in Unix seconds.
  int32_t hour_start;
  // Pebble GColor8 values: 0b11rrggbb.
  uint8_t zoned[ENR_ZONED][3];
  uint8_t space,space_ink,screen,waterline,terminator,night_dots,tints[5],depths[2];
  enr_real row_cos[ENR_H],row_sin[ENR_H],col_cos[ENR_W],col_sin[ENR_W];
  enr_real c1x,normal_x,normal_y;
  int16_t zulu_x,zulu_baseline;
  EnrMinute minutes[60];
  uint16_t track_count;
  EnrPoint *track;
  // The class plane as row runs of (count, class) byte pairs; row y's runs
  // are runs[row_offset[y]] up to runs[row_offset[y+1]].
  uint16_t row_offset[ENR_H+1];
  const uint8_t *runs;
  bool owns_runs;
} EnrScene;

// Parse a scene blob as the phone sends it. Allocates the track with the
// given allocator. With borrow, the class plane's runs stay in the blob,
// which must then outlive the scene; otherwise they are copied. Returns
// false on a malformed blob.
bool enr_parse(const uint8_t *blob,size_t length,EnrScene *scene,void *(*alloc)(size_t),bool borrow);
void enr_free(EnrScene *scene,void (*release)(void *));

// Draw minute 0-59 of the scene's hour into a 200x228 GColor8 frame buffer.
// row_stride is the frame buffer's bytes per row.
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride);
