// Sine and cosine to the same bits as src/fmath.js.
#pragma once
double f_sin(double x);
double f_cos(double x);
// The square root, correctly rounded (Math.sqrt), and the exact remainder
// (JavaScript's %): the watch's libm has neither.
double f_sqrt(double x);
double f_fmod(double x,double y);
// Arcsine, arccosine and arctangents, to the same bits as src/fmath.js.
double f_asin(double x);
double f_acos(double x);
double f_atan(double x);
double f_atan2(double y,double x);
