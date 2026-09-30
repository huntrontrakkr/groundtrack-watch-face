// The watch's map: the land atlas and the relief grid, packed losslessly by
// tools/relief-pack.mjs (see there for the format). Portable C: the watch
// reads the pack from its resources, the host harness from a file.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define MAP_WIDTH 1440
#define MAP_MAX_ERROR_LEVELS 12
#define MAP_MAX_ALPHABET 96

// Reads length bytes at offset from the pack; returns the bytes read.
typedef size_t (*MapReadFn)(void *source,uint32_t offset,uint8_t *out,size_t length);

typedef struct {
  MapReadFn read;
  void *source;
  uint16_t first,rows;
  uint8_t strip,radius,levels;
  uint8_t thresholds[MAP_MAX_ERROR_LEVELS];
  int16_t weights[2][6];
  uint16_t land_freq[64];
  // Cumulative relief frequencies, per context: cum[c][s] .. cum[c][s+1].
  uint16_t cum[2*MAP_MAX_ERROR_LEVELS][MAP_MAX_ALPHABET+1];
  uint32_t data;              // where strip data begins
  uint16_t strips;
  uint32_t offsets_at;        // where the strip offsets begin
} MapPack;

// Called for each decoded row: its relief codes and land bits (0 or 1),
// MAP_WIDTH of each, for world row `row` (90 - row/4 degrees).
typedef void (*MapRowFn)(void *context,int row,const uint8_t *relief,const uint8_t *land);

// The working rows the decoder needs: three rows of relief and land, two of
// differences. Kept by the caller so nothing is allocated.
typedef struct {
  uint8_t relief[3][MAP_WIDTH],land[3][MAP_WIDTH],err[2][MAP_WIDTH];
  uint8_t buffer[256];
} MapWork;

// A position in the pack, decoding forward one row at a time.
typedef struct {
  const MapPack *pack;
  MapWork *work;
  uint32_t at,filled_from,filled;   // the read buffer's window
  uint32_t state;                   // rANS state
  int y,y0,end;                     // next row (pack-relative), its strip's first row and end
} MapCursor;

bool map_pack_open(MapPack *pack,MapReadFn read,void *source);
// Starts decoding at the strip holding world row `row`; map_cursor_next then
// returns rows from the strip's first row onward.
bool map_cursor_start(MapCursor *cursor,const MapPack *pack,MapWork *work,int row);
// Decodes the next row: its world row, and its relief codes and land bits
// (valid until the next call). Returns -1 past the pack's last row.
int map_cursor_next(MapCursor *cursor,const uint8_t **relief,const uint8_t **land);
// Decodes world rows row0 up to row1 (clamped to the pack's rows), calling
// fn for each. Starts at the beginning of the strip holding row0.
bool map_pack_rows(const MapPack *pack,MapWork *work,int row0,int row1,MapRowFn fn,void *context);
