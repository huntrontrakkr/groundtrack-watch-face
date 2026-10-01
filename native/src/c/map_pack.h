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
#define MAP_MIPS 3
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
// Decodes tile (tx, ty) of mip m into out (MAP_TILE*MAP_TILE cells, row by
// row, land bit << 4 | level), reading through buffer (256 bytes).
bool map_tile(const MapPack *pack,int m,int tx,int ty,uint8_t *out,uint8_t *buffer);
