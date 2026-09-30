// Home's pass line for a satellite, from the pass lists the phone sends
// (src/home.js encodePassBlock): nextPass() and passText() in C.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define PASS_BLOCK_SECONDS (12*3600)
#define PASS_AHEAD_SECONDS (24*3600)
#define PASS_BYTES 14
// A block's passes as the phone packs them: returns false if malformed.
typedef struct {int32_t aos,los;int16_t peak;uint16_t aos_local,los_local;} Pass;
// The line at t into out (24 characters, NUL-padded, '°' as 0x7f), from the
// block holding t: "HOM NO PASS", "HOM IN VIEW LOS 1440" or "HOM AOS 1434 6M 78°".
void pass_line_from(const uint8_t *block,size_t length,int64_t t,char out[24]);
