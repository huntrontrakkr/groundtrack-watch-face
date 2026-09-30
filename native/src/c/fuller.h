// Rolling Fuller on the watch: the icosahedron rolled along the route and
// its floating net (src/roll.js, src/unfold.js, src/fuller.js), to the
// same bits. The constants and faces' frames come from the faces' grid pack
// (tools/fuller-pack.mjs), as the study computed them.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "map_pack.h"

// The pack's header: fuller.js's constants, the faces' frames (n, u, v),
// their vertices (F) and neighbours across each edge (NEIGHBORS).
typedef struct {
  double S3,Z,EL,DVE,RAW_EDGE;
  double bases[20][9];
  uint8_t F[20][3],NB[20][3];
} FullerConst;
#define FULLER_HEADER (8+5*8+20*9*8+120)
bool fuller_const_read(MapReadFn read,void *source,FullerConst *g);

// A lattice cell of the plane: a face printed on a triangle, and its key
// (its centre, to the millionth).
typedef struct {double tri[3][2];int64_t key[2];uint8_t face;bool route;} FullerCell;
// The plane's cells while the net is made (a scratch array the caller
// gives), and the tiles kept: the cells on the screen, in the net's order,
// each with its box on the screen and its edges (0 a fold, 1 a cut, 2 the
// outline).
#define FULLER_CELLS 96
#define FULLER_TILES 24
typedef struct {double tri[3][2],box[4];uint8_t face,edge[3];} FullerTile;
typedef struct {
  const FullerConst *g;
  double ux,uy,scale,mid[2];
  int tile_count;FullerTile tiles[FULLER_TILES];
} FullerCam;

// geometry.js direction() and fuller.js faceOf(), forwardFace().
void fuller_direction(double lat,double lon,double d[3]);
int fuller_face_of(const FullerConst *g,const double d[3]);
void fuller_forward(const FullerConst *g,int face,const double d[3],double w[3]);
// rollCamera()'s rolling and net. dirs: the track's directions, count of
// them; i0 and i1 the hour's stations (the day's first and last for day);
// cells, FULLER_CELLS of scratch.
// span as the study's (180, or 192 for a day). Writes each point's screen
// position to xs, ys. False if the net does not fit.
bool fuller_roll(FullerCam *cam,FullerCell *cells,const FullerConst *g,const double (*dirs)[3],int count,int i0,int i1,bool day,double span,double *xs,double *ys);
void fuller_to_plane(const FullerCam *cam,double x,double y,double p[2]);
void fuller_to_screen(const FullerCam *cam,const double p[2],double *x,double *y);
// The tile holding a screen point, or -1; with its weights.
int fuller_locate(const FullerCam *cam,double x,double y,double w[3]);
// The copy of a place nearest the route's middle, or (-999, -999).
void fuller_project(const FullerCam *cam,double lat,double lon,double *x,double *y);
// fuller-ground.js tileGrid(): a tile's place on its face's grid (N steps
// an edge) as integers.
void fuller_tile_grid(const FullerCam *cam,int tile,int n,int32_t out[6]);
