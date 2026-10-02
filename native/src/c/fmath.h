// Sine and cosine to the same bits as src/fmath.js.
#pragma once
#include <stdint.h>
// 64-bit time arithmetic without the 64-bit divider (754 bytes the watch
// can spare as heap): C's quotient (towards zero) and remainder, in the
// Cortex-M's 32-bit hardware divide when the value is a positive time that
// fits, else in doubles (exact for |v| < 2^52).
static inline int64_t q64(int64_t v,int32_t d){return v>=0&&v<=(int64_t)0xFFFFFFFF&&d>0?(int64_t)((uint32_t)v/(uint32_t)d):(int64_t)((double)v/d);}
static inline int64_t r64(int64_t v,int32_t d){return v-q64(v,d)*d;}
double f_sin(double x);
double f_cos(double x);
// The square root, correctly rounded (Math.sqrt), and the exact remainder
// (JavaScript's %): the watch's libm has neither.
double f_sqrt(double x);
// floor and ceil (exact for any double: past 2^53 every double is whole),
// a fraction of the library's size.
double f_floor(double x);
double f_ceil(double x);
double f_fmod(double x,double y);
// Arcsine, arccosine and arctangents, to the same bits as src/fmath.js.
double f_asin(double x);
double f_acos(double x);
double f_atan(double x);
double f_atan2(double y,double x);
