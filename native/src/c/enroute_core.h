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

// Arithmetic for night and the body. Doubles match the browser renderer
// exactly, and the watch uses them; ENR_FLOAT (single precision) remains
// for comparison, and moves a pixel now and then.
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
  // A satellite's pass line (over the hour chart, under the world band),
  // which can change within the hour; empty for none.
  char top[24];
  // The world band: the tape's index, the satellite's height ("412 KM") and
  // home's acquisition circle (an index into the scene's, or 255).
  int16_t index;
  char height[8];
  uint8_t circle;
} EnrMinute;

// A point of the route, rounded to the pixel, with the step from the one
// before: steep (more down than across) or a jump across the band's seam.
enum {ENR_STEEP=1,ENR_JUMP=2};
typedef struct {
  int16_t x,y;
  int32_t seconds;
  uint8_t hour,step;
} EnrPoint;

enum {ENR_VIEW_HOUR,ENR_VIEW_WORLD};
typedef struct {
  uint8_t flags,body,view;
  int8_t forward;
  // The hour the scene draws, in Unix seconds.
  int32_t hour_start;
  // Pebble GColor8 values: 0b11rrggbb.
  uint8_t zoned[ENR_ZONED][3];
  uint8_t space,space_ink,screen,waterline,terminator,night_dots,tints[5],depths[2];
  enr_real row_cos[ENR_H],row_sin[ENR_H],col_cos[ENR_W],col_sin[ENR_W];
  enr_real c1x,normal_x,normal_y;
  int16_t zulu_x,zulu_baseline,top_x,top_baseline,height_right,height_baseline;
  // The world band's tape: its ends, baseline, and where the minutes may go.
  int16_t tape_x0,tape_x1,tape_baseline,tape_lo,tape_hi;
  // Home, whose mark is drawn over the body (x -1000 without), and its box.
  int16_t home_x,home_y,home_box[4];
  EnrMinute minutes[60];
  // Home's acquisition circles, each allocated on its own: circle k has
  // circle_n[k] points, (x, y) bytes at circle_px[k].
  uint8_t circle_count,circle_n[60];
  uint8_t *circle_px[60];
  uint16_t track_count;
  EnrPoint *track;
  // The class plane as row runs of (count, class) byte pairs; row y's runs
  // are runs[row_offset[y]] up to runs[row_offset[y+1]].
  uint16_t row_offset[ENR_H+1];
  const uint8_t *runs;
  bool owns_runs;
  // Rows with ground under them (bit y&7 of byte y>>3), where night can
  // change; set by enr_ready.
  uint8_t ground_rows[(ENR_H+7)/8];
} EnrScene;

// Parse a scene blob as the phone sends it. Allocates the track and circles
// with the given allocator. With borrow, the class plane's runs stay in the blob,
// which must then outlive the scene; otherwise they are copied. Returns
// false on a malformed blob.
bool enr_parse(const uint8_t *blob,size_t length,EnrScene *scene,void *(*alloc)(size_t),bool borrow);
void enr_free(EnrScene *scene,void (*release)(void *));
// Notes what the minute renderer needs from the class plane, once its runs
// are in place (enr_parse does it itself).
void enr_ready(EnrScene *scene);

// Draw minute 0-59 of the scene's hour into a 200x228 GColor8 frame buffer.
// row_stride is the frame buffer's bytes per row.
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride);
// The same minute, drawn over the frame as minute `from` of the same scene
// left it: only what can have changed is drawn again. With from outside
// 0-59, the whole frame. Returns the pixels of the base drawn.
int enr_render_update(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride);
