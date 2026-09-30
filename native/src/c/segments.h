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
// A series at a time in whole Unix seconds within the segment's day.
double seg_value(const Segment *seg,int series,int64_t seconds);
// Longitude wrapped to -180..180, as the JavaScript's wrap().
double seg_wrap(double lon);
// Latitude and longitude of the Sun (moon false) or the Moon.
void seg_position(const Segment *seg,bool moon,int64_t seconds,double *lat,double *lon);
// The Moon's lit fraction, and whether it is waxing.
void seg_moon_light(const Segment *seg,int64_t seconds,double *fraction,bool *waxing);
