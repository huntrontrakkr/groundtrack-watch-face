// What the watch keeps to draw the Sun and Moon charts itself, and the
// build. Watch-only (Pebble SDK): settings, the Sun and Moon segments per
// UTC day and home's rise and set per local date, in persistent storage,
// sent by the phone.
#pragma once
#include <pebble.h>
#include "enroute_core.h"

enum {BODY_SUN,BODY_MOON,BODY_SATELLITE};
typedef struct {
  uint8_t version,body,plate,flag,clock24,home;
  int32_t lat100,lon100;         // home in hundredths of a degree
} WatchSettings;

void settings_load(WatchSettings *s);
void settings_save(const WatchSettings *s);
// Stores segments (228 bytes each) and rise-and-set records (12 bytes each)
// as the phone sends them.
void segments_store(const uint8_t *bytes,size_t length);
void rise_sets_store(const uint8_t *bytes,size_t length);
// The first UTC day from `from` within `days` with no segment, or -1.
int32_t segments_missing(int32_t from,int days);
// Whether home's rise and set are kept for a local date.
bool rise_set_known(int32_t date);
// The local calendar date as days since 1970-01-01.
int32_t civil_date(int year,int month,int day);

// Starts building the local hour holding `now` for the Sun or Moon (see
// chart.h: step it, then finish it). NULL without the segments or memory.
struct ChartBuild *local_chart(time_t now,const WatchSettings *s);
