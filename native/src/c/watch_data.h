// What the watch keeps to draw the Sun and Moon charts itself, and the
// build. Watch-only (Pebble SDK): settings, the Sun and Moon segments per
// UTC day and home's rise and set per local date, in persistent storage,
// sent by the phone.
#pragma once
#include <pebble.h>
#include "enroute_core.h"

enum {BODY_SUN,BODY_MOON,BODY_SATELLITE};
// A satellite's view: the hour chart (GPS), the world band (the fast ones)
// or the whole day (QZSS, not yet drawn here).
enum {VIEW_HOUR,VIEW_WORLD,VIEW_DAY};
typedef struct {
  // readout: 0 none, 1 the minute flag, 2 a time callout.
  uint8_t version,body,plate,readout,clock24,home;
  int32_t lat100,lon100;         // home in hundredths of a degree
  // A satellite: its catalog number, whether it is a crewed station (its
  // symbol), its view and its code ("ISS").
  int32_t norad;
  uint8_t station,view;
  char code[4];
  // The callout's figures (ENR_COLON ... ENR_ACCENT), and the margin's time
  // in the nautical zone under the body rather than Zulu.
  uint8_t numerals,zone_body;
  // The world band's time scale: 0 fixed, 1 a sliding tape, 2 the world too.
  uint8_t tape;
  // On the fixed tape, how its minutes fall on the route: 0 off, 1 a
  // vernier, 2 a comb, 3 chevrons.
  uint8_t transfer;
  // The figure set (FIGURE_SETS in src/plates.js: 0 Jost, 2 Michroma, the
  // default).
  uint8_t figures;
  // The margins' corner: 0 the day of the year (Plotboard: the height), 1
  // the body's ground point, 2 the Moon's light.
  uint8_t corner;
  // The Sun (1) and the Moon (2) marked beside the body.
  uint8_t also;
} WatchSettings;

void settings_load(WatchSettings *s);
void settings_save(const WatchSettings *s);
// Stores segments (228 bytes each) and rise-and-set records (12 bytes each)
// as the phone sends them.
void segments_store(const uint8_t *bytes,size_t length);
void rise_sets_store(const uint8_t *bytes,size_t length);
// The first UTC day from `from` within `days` with no segment, or -1.
int32_t segments_missing(int32_t from,int days);
// A satellite's segments (160 bytes each) and home's pass blocks, as the
// phone sends them.
void sat_segments_store(const uint8_t *bytes,size_t length);
void pass_blocks_store(const uint8_t *bytes,size_t length,const WatchSettings *s);
// The first second from `from` within `seconds` with no segment of the
// satellite, or -1; and whether the pass block holding t is kept.
int64_t sat_segments_missing(int32_t norad,int64_t from,int32_t seconds);
bool pass_block_known(int64_t t,const WatchSettings *s);
// Events, as the phone sends them (9 bytes each).
void events_store(const uint8_t *bytes,size_t length);
// Whether home's rise and set are kept for a local date.
bool rise_set_known(int32_t date);
// The local day holding t: its midnight and the next (Unix seconds).
void local_day(time_t t,int64_t *start,int64_t *end);
// The local calendar date as days since 1970-01-01.
int32_t civil_date(int year,int month,int day);

// What the chart of the local hour holding `now` reads: the hour's start,
// the whole day's bounds (0 unless it is the day's chart), the UTC days of
// Sun and Moon segments (first to last) and, for a satellite, the seconds
// its segments must cover (first to last). The build and the watch's asking
// for data both go by it.
typedef struct {int64_t start,day_start,day_end,sat0,sat1;int32_t day0,day1;uint8_t view;} ChartNeeds;
void chart_needs(time_t now,const WatchSettings *s,ChartNeeds *n);
// The app's log (main.c).
void app_note(const char *what,unsigned n);

// Starts building the local hour holding `now` for the Sun or Moon (see
// chart.h: step it, then finish it). NULL without the segments or memory.
struct ChartBuild *local_chart(time_t now,const WatchSettings *s);
// Frees what a build read (once it has finished or been abandoned).
void local_chart_done(void);
