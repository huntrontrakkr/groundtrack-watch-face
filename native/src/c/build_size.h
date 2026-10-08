// Groundtrack's code that builds a chart, takes the phone's data or starts
// the app (not the minute renderer, enroute_core.c, which runs every minute
// and keeps the optimisation the rest of the build gives up) is compiled
// smaller still, for the kept ground's room (about 450 bytes). Each of these
// saves between 8 and 136 bytes; none changes what the code means. tools/energy
// measured the minute renderer's work 14% greater with them.
#pragma once
#if defined(FACE_ENROUTE) || defined(FACE_FULLER)
#pragma GCC optimize("no-schedule-insns2","no-ipa-cp","no-ipa-cp-clone","no-tree-sra","no-forward-propagate","no-delete-null-pointer-checks","no-optimize-sibling-calls","no-shrink-wrap")
#endif
