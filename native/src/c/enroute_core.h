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
#include "face.h"

#define ENR_W 200
#define ENR_H 228
// The pieces a scene's runs are kept in (see EnrScene): their size, and
// how many the class plane and a Fuller sheet's tiles may take.
#define ENR_RUN_PIECE 2048
#define ENR_RUN_PIECES 32
#define ENR_TILE_PIECES 16

// Arithmetic for night and the body. Doubles match the browser renderer
// exactly, and the watch uses them; ENR_FLOAT (single precision) remains
// for comparison, and moves a pixel now and then.
#ifdef ENR_FLOAT
typedef float enr_real;
#else
typedef double enr_real;
#endif

enum {ENR_NIGHT_ZONES=1,ENR_SCAN=2,ENR_TERMINATOR=4,ENR_NIGHT_DOTS=8,ENR_MINUTE_FLAG=16,ENR_CALLOUT=32,ENR_SLIDING_TAPE=64,ENR_SLIDING_WORLD=128};
// The time callout's figures: the hour, then a colon and smaller minutes;
// smaller minutes; four figures, the minutes outlined; the minutes in
// Departure Mono at double size; smaller minutes in the route's ink.
enum {ENR_COLON,ENR_PLAIN,ENR_EVEN,ENR_MONO,ENR_ACCENT};
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
  // The world band's tape index, and home's acquisition circle (an index
  // into the scene's, or 255).
  int16_t index;
  // The margins' corner, set right to (height_right, height_baseline): the
  // day of the year, the body's ground point or the Moon's light ("DAY
  // 270", "23N 045E", "87% WAX"; the world band: "ISS 412 KM", "ISS 12S
  // 140W"), or for old elements "EL OLD" ("EL OLD 412 KM").
  char corner[14];
  uint8_t circle;
} EnrMinute;

// A point of the route, rounded to the pixel, with the step from the one
// before (steep: more down than across; a jump across the band's seam) and
// whether it lies within the hour. Point k is at track_t0 + k*track_step
// seconds from the hour.
enum {ENR_STEEP=1,ENR_JUMP=2,ENR_HOUR=4};
typedef struct {
  int16_t x,y;
  uint8_t flags;
} EnrPoint;

enum {ENR_VIEW_HOUR,ENR_VIEW_WORLD,ENR_VIEW_DAY};
// A Fuller sheet (the scene's view byte has ENR_FULLER over the hour or the
// day): its pixels are lit from its faces' pre-projected grids
// (src/fuller-ground.js). tile_grid gives a tile's place on its face's grid
// as a = g[0] + g[1]*qx + g[2]*qy, b likewise from g[3], in 1/65536 of a
// grid step, for quarter-pixel qx = 4x + k, qy = 4y + j.
#define ENR_FULLER 16
// On a one-ink plate a Fuller sheet's route is heavier: two pixels ahead
// of the body, three behind.
#define ENR_HEAVY 32
#define ENR_FULLER_N 64
#define ENR_GRID_POINTS ((ENR_FULLER_N+1)*(ENR_FULLER_N+2)/2)
// Night is lit from every other point of the grid each way (the Sun's
// height is smooth: 2-degree cells are ample, at a quarter of the memory).
#define ENR_NIGHT_N 32
#define ENR_NIGHT_POINTS ((ENR_NIGHT_N+1)*(ENR_NIGHT_N+2)/2)
#define ENR_TILES 32
typedef struct {
  double net_top;                   // the net's top edge (the day's callout hangs above it)
  double bases[20][9];              // each face's frame: n, u, v
  uint8_t tile_count,tile_face[ENR_TILES];
  int32_t tile_grid[ENR_TILES][6];
  // Which tile each pixel lies on, as row runs of (count, tile + 1; 0 none).
  // Kept in pieces as the scene's class plane is (ENR_RUN_PIECE): row y's
  // start at tile_offset[y].
  uint16_t tile_offset[ENR_H+1];
  uint8_t *tile_piece[ENR_TILE_PIECES];
  // Each night grid point's direction in its face's frame (n, u, v), x
  // 16384: ENR_NIGHT_POINTS of them.
  int16_t *dirs;
  // How far (Q30) a height along a row's run on one tile can lie beyond
  // the run's end pixels' heights (enr_ready).
  int32_t slack;
} EnrFuller;
// Figures of one size for the day's time callout (Jost digits: 20, 28 and
// 40 px): per digit its width, height and first byte in the scene's
// fig_bits, rows of (width+7)/8 bytes, the leftmost pixel the high bit.
typedef struct {uint8_t width[10],height[10];uint16_t first[10];} EnrFigures;
typedef struct {
  uint8_t flags,body,view;
  // A Fuller sheet's grids (NULL for the other charts).
  EnrFuller *fuller;
  bool heavy;
  // The ground drawn as a lattice of dots (the Dot matrix plate): 4-pixel
  // cells, a dot in each whose size is the height's tint; water a single
  // dim point; by day the tints' colours, at dusk and night the land's.
  bool lattice;
  // The Sun drawn as HAL 9000's eye (the Odyssey plate).
  bool hal;
  // The world band's panel a clock, not a tape: the time in the callout's
  // figures (numerals, hour_text), centred.
  bool clock;
  // Under a sliding tape, how its minutes fall on the route (as under the
  // fixed ruler, where the builder draws it): 0 nothing, 1 a vernier, 2 a
  // comb, 3 chevrons.
  uint8_t transfer;
  int8_t forward;
  // The hour the scene draws, in Unix seconds.
  int32_t hour_start;
  // Pebble GColor8 values: 0b11rrggbb.
  uint8_t zoned[ENR_ZONED][3];
  uint8_t space,space_ink,screen,waterline,terminator,night_dots,tints[5],depths[2];
  // The rows' and columns' cosines and sines (not a Fuller sheet's): the
  // rows' in rows_block, the columns' after the minutes in theirs.
  enr_real *row_cos,*row_sin,*col_cos,*col_sin;
  enr_real c1x,normal_x,normal_y;
  int16_t zulu_x,zulu_baseline,top_x,top_baseline,height_right,height_baseline;
  // The world band's tape: its ends, baseline, and where the minutes may go.
  int16_t tape_x0,tape_x1,tape_baseline,tape_lo,tape_hi;
  // Home, whose mark is drawn over the body (x -1000 without), and its box.
  int16_t home_x,home_y,home_box[4];
  // Home's mark: the pixels drawn after the body in its ink, in order.
  uint8_t mark_count,marks[128][2];
  // The day's time callout: the track's least x less 8, the top and bottom
  // it keeps within, the hour's figures, the lettering its leader breaks
  // for, and its figures (loaded apart from the scene's blob).
  int16_t callout_left,callout_top,callout_bottom;
  char hour_text[3];
  uint8_t numerals,avoid_count;
  int16_t avoid[24][4];
  // Their sizes in px: the callout's 20, 28 and 40, or the panel clock's
  // 28, 40 and 72.
  EnrFigures figures[3];uint8_t figure_px[3];
  uint8_t *fig_bits;
  // Symbols inked by one point's night (renderEnroute's col(anchor)): the
  // rose and hexagon by this hour's station, the reporting point by the
  // next's, each network station's ring by its centre.
  int16_t c0[2],c1[2];
  uint8_t station_count;
  int16_t stations[32][2];
  // Which network stations those are (their table indices), and the hour
  // figures' boxes (x, y, w, h; empty on a day chart), for the study.
  uint8_t station_table[32];
  int16_t fig_box[2][4];
  // The world band's sliding tape: this hour's figures and the next's.
  char tape_hour[3],tape_next[3];
  // With the world sliding (ENR_SLIDING_WORLD), the band is the whole
  // world round, W columns to 360 degrees, turned under the index each
  // minute by enr_render; its source line, lettered over it then.
  char source[24];
  // Events: each fix, its name's x (baseline the fix's y - 7) and box, and
  // whether the name is clear of what stays all hour; each minute it also
  // gives way to that minute's flag, callout or tape, and to the names
  // before it.
  uint8_t event_count;
  struct {int16_t x,y,lx,box[4];uint8_t clear;char name[5];} events[16];
  // The hour's minutes, sixty, in a block of their own.
  EnrMinute *minutes;
  void *rows_block;
  // Home's acquisition circles, each allocated on its own: circle k has
  // circle_n[k] points, (x, y) bytes at circle_px[k].
  uint8_t circle_count,circle_n[60];
  uint8_t *circle_px[60];
  uint16_t track_count;
  int32_t track_t0;
  int16_t track_step;
  EnrPoint *track;
  // The class plane as row runs of (count, class) byte pairs, each row's
  // making up its ENR_W pixels. A count past ENR_RUN_MAX is a stretch of
  // bare ground told pixel by pixel (a shaded plate's dither): count -
  // ENR_RUN_MAX bytes follow, two pixels' ground classes each, the first in
  // the low nibble.
  // The runs are kept in pieces of ENR_RUN_PIECE bytes, a row's all in one
  // piece: row y's start at byte row_offset[y] % ENR_RUN_PIECE of piece
  // row_offset[y] / ENR_RUN_PIECE. (A build leaves the watch's heap in
  // pieces: there is room for these where there is none for the whole, nor
  // for the scene as one block, so its minutes and tables lie apart too.)
  // row_offset[ENR_H] is the last row's end.
  #define ENR_RUN_MAX 200
  uint16_t row_offset[ENR_H+1];
  uint8_t *run_piece[ENR_RUN_PIECES];
  // Rows with ground under them (bit y&7 of byte y>>3), where night can
  // change; set by enr_ready.
  uint8_t ground_rows[(ENR_H+7)/8];
  // The rows' cosines and sines, and night's thresholds, in 2^30 fixed
  // point, for the minute renderer's fast night.
  int32_t (*row_q)[2],night_q[34];
  // Whether a class's colour differs between night's zones (enr_ready).
  uint8_t zone_matters[256];
} EnrScene;

// Frees what a scene holds (not the scene itself).
void enr_free(EnrScene *scene,void (*release)(void *));
// Notes what the minute renderer needs from the class plane, once its runs
// are in place.
void enr_ready(EnrScene *scene);

// Draw minute 0-59 of the scene's hour into a 200x228 GColor8 frame buffer.
// row_stride is the frame buffer's bytes per row.
void enr_render(const EnrScene *scene,int minute,uint8_t *frame,int row_stride);
// The same minute, drawn over the frame as minute `from` of the same scene
// left it: only what can have changed is drawn again. With from outside
// 0-59, the whole frame. Returns the pixels of the base drawn, or -1
// without the memory to draw (the frame untouched).
int enr_render_update(const EnrScene *scene,int from,int minute,uint8_t *frame,int row_stride);

// For the study and its tests (the host and the core's WebAssembly): where
// a minute's moving parts fall, as a box (x, y, w, h; w 0 for nothing
// drawn): the body, the minute flag, the time callout, the sliding tape's
// hour figure and next hour's figure, and the tape's index.
enum {ENR_MEASURE_BODY,ENR_MEASURE_FLAG,ENR_MEASURE_CALLOUT,ENR_MEASURE_TAPE_HOUR,ENR_MEASURE_TAPE_NEXT,ENR_MEASURE_INDEX};
void enr_measure(const EnrScene *scene,int minute,int part,int16_t out[4]);
// The watch's own state, shown in the margins' corner in place of its
// text until cleared: "NO LINK", "BAT 18" (at most 7 characters; "" for
// none).
void enr_status(const char *text);
// Lettering's box, set at x on a baseline; its width.
void enr_text_box(const char *text,int n,int x,int baseline,int16_t out[4]);
int enr_text_width(const char *text,int n);
// A pixel's class (ground nibble, layer nibble; with the world sliding, the
// band's own columns, before it is turned) and its night zone (0 day, 1
// dusk, 2 night) at a minute, at the screen's pixel.
int enr_class(const EnrScene *scene,int x,int y);
int enr_zone(const EnrScene *scene,int minute,int x,int y);
