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
// Whether home's rise and set are kept for a local date.
bool rise_set_known(int32_t date);
// The local day holding t: its midnight and the next (Unix seconds).
void local_day(time_t t,int64_t *start,int64_t *end);
// The local calendar date as days since 1970-01-01.
int32_t civil_date(int year,int month,int day);

// Starts building the local hour holding `now` for the Sun or Moon (see
// chart.h: step it, then finish it). NULL without the segments or memory.
struct ChartBuild *local_chart(time_t now,const WatchSettings *s);
// Frees what a build read (once it has finished or been abandoned).
void local_chart_done(void);
