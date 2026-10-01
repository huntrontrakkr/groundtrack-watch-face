// Which watch face a build is: Groundtrack Enroute (FACE_ENROUTE: the hour
// chart and the whole day), Groundtrack Plotboard (FACE_PLOTBOARD: the
// world band) or Groundtrack Fuller (FACE_FULLER: rolling Fuller sheets of
// the hour and the whole day). Each leaves out the other's code, as constants the compiler
// can see; the host harnesses (neither defined) keep both.
#pragma once
#if defined(FACE_PLOTBOARD)
#define FACE_HOUR 0
#define FACE_WORLD 1
#define FACE_ROLL 0
#define FACE_CHART 1
#elif defined(FACE_ENROUTE)
#define FACE_HOUR 1
#define FACE_WORLD 0
#define FACE_ROLL 0
#define FACE_CHART 1
#elif defined(FACE_FULLER)
#define FACE_HOUR 1
#define FACE_WORLD 0
#define FACE_ROLL 1
#define FACE_CHART 0
#else
#define FACE_HOUR 1
#define FACE_WORLD 1
#define FACE_ROLL 1
#define FACE_CHART 1
#endif
// A scene's view, as far as this face can have it.
#define VIEW_IS_WORLD(v) (FACE_WORLD&&(!FACE_HOUR||(v)==1))
#define VIEW_IS_DAY(v) (FACE_HOUR&&(v)==2)
// (A face without the world band still has the day view: an hour chart is
// view 0 there too, not anything but the world band.)
#define VIEW_IS_HOUR(v) (FACE_HOUR&&(FACE_WORLD?(v)==0:(v)!=2))
