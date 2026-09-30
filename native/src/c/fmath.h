// Sine and cosine to the same bits as src/fmath.js.
#pragma once
double f_sin(double x);
double f_cos(double x);
// The square root, correctly rounded (Math.sqrt), and the exact remainder
// (JavaScript's %): the watch's libm has neither.
double f_sqrt(double x);
double f_fmod(double x,double y);
