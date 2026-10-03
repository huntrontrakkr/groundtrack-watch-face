// The watch's map: land bits and relief levels in tiles, at three
// resolutions, packed by tools/map-pack.mjs (see there for the format).
// Portable C: the watch reads the pack from its resources, the host tools
// from a file.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define MAP_TILE 32
#define MAP_LEVELS 10
// The world's three resolutions, then each polar cap's (the north's, the
// south's): CAP degrees of the polar plane each way from the pole
// (tools/generate-map-pack.mjs capOf()).
#define MAP_MIPS 9
#define MAP_CAP 72
#define MAP_CONTEXTS (2*MAP_LEVELS*MAP_LEVELS)

// Reads length bytes at offset from the pack; returns the bytes read.
typedef size_t (*MapReadFn)(void *source,uint32_t offset,uint8_t *out,size_t length);

typedef struct {uint8_t resolution;uint16_t width,first,rows,cols,trows;uint32_t offsets_at,data;} MapMip;
typedef struct {
  MapReadFn read;
  void *source;
  uint8_t mips,levels;
  int16_t height[MAP_LEVELS];         // metres each level stands for
  uint16_t land_freq[16];
  // Each level context's cumulative frequencies (levels+1 entries), or
  // NULL for a context the pack never meets; allocated by map_pack_open.
  uint16_t *cum[MAP_CONTEXTS];
  uint16_t *tables;
  MapMip mip[MAP_MIPS];
} MapPack;

bool map_pack_open(MapPack *pack,MapReadFn read,void *source,void *(*alloc)(size_t));
void map_pack_close(MapPack *pack,void (*release)(void *));
// A mip's cell size in degrees: 0.25 * 2^resolution.
double map_cell_degrees(int resolution);
// A tile decoded a row at a time, in order (the coder is sequential): the
// chart's ground streams down the map, so a strip of these, one a tile
// across the chart, gives every cell row once with no tile held whole.
#define MAP_STREAM_BUFFER 64
typedef struct {
  uint32_t x,at,end,from,filled;
  uint8_t row,flat,value;
  uint8_t prev[MAP_TILE];        // the row before (the coder's contexts)
  uint8_t buf[MAP_STREAM_BUFFER];
} MapTileStream;
bool map_tile_open(const MapPack *pack,int m,int tx,int ty,MapTileStream *s);
// The next row's MAP_TILE cells (land bit << 4 | level; 0 beyond the mip's
// edge); false past the tile's rows.
bool map_tile_row(const MapPack *pack,int m,int tx,int ty,MapTileStream *s,uint8_t *out);
// The whole tile (tx, ty) of mip m into out (MAP_TILE*MAP_TILE cells, row
// by row), through a stream of its own.
bool map_tile(const MapPack *pack,int m,int tx,int ty,uint8_t *out,MapTileStream *s);
