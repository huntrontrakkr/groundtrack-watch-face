// The Sun and Moon from daily Chebyshev segments (src/segments.js fits them
// and writes their bytes). Evaluated exactly as the JavaScript does, so the
// watch and the browser agree to the bit.
#pragma once
#include <stdint.h>
#include <stdbool.h>

// Coefficients per series, in src/segments.js's SERIES order.
enum {SEG_SUN_LAT,SEG_SUN_LON,SEG_MOON_LAT,SEG_MOON_LON,SEG_MOON_FRACTION,SEG_MOON_PHASE,SEG_SUN_DISTANCE,SEG_MOON_DISTANCE,SEG_SERIES};
#define SEG_COEFFICIENTS 68
#define SEG_BYTES (4+4*SEG_COEFFICIENTS)

typedef struct {
  int32_t day;                       // days since 1970-01-01 (UTC)
  float c[SEG_COEFFICIENTS];
} Segment;

bool seg_decode(const uint8_t *bytes,Segment *seg);
// The watch keeps the positions and phase only, not the distances: 228
// bytes, under persistent storage's 256 a value.
#define SEG_WATCH_COEFFICIENTS 56
#define SEG_WATCH_BYTES (4+4*SEG_WATCH_COEFFICIENTS)
bool seg_decode_watch(const uint8_t *bytes,Segment *seg);
// A series at a time in whole Unix seconds within the segment's day.
double seg_value(const Segment *seg,int series,int64_t seconds);
// Longitude wrapped to -180..180, as the JavaScript's wrap().
double seg_wrap(double lon);
// Latitude and longitude of the Sun (moon false) or the Moon.
void seg_position(const Segment *seg,bool moon,int64_t seconds,double *lat,double *lon);
// The Moon's lit fraction, and whether it is waxing.
void seg_moon_light(const Segment *seg,int64_t seconds,double *fraction,bool *waxing);

// A satellite's segment (src/segments.js fitSatelliteSegment): its catalog
// number, first second, span and its elements' epoch, then its latitude and unwrapped longitude
// (14 terms each) and altitude in km (8), as the phone sends them.
#define SAT_TERMS 14
#define SAT_ALT_TERMS 8
#define SAT_SEGMENT_BYTES (16+4*(2*SAT_TERMS+SAT_ALT_TERMS))
typedef struct {
  int32_t norad,start,span,epoch;
  float lat[SAT_TERMS],lon[SAT_TERMS],altitude[SAT_ALT_TERMS];
} SatSegment;
bool sat_segment_decode(const uint8_t *bytes,SatSegment *seg);
// Latitude, longitude (wrapped to -180..180) and altitude at a time in whole
// Unix seconds within the segment.
void sat_segment_position(const SatSegment *seg,int64_t seconds,double *lat,double *lon,double *altitude);
// Full Earth shadow, estimated with a spherical Earth and the Sun at 1 AU.
// solar_dot: radial unit direction dotted with the Sun's direction.
bool sat_eclipsed(double altitude,double solar_dot);
