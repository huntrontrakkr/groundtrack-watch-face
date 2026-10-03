#!/bin/sh
# Compiles the core (the watch's chart builder and minute renderer, behind
# native/host/core_api.c) to WebAssembly for the study: public/core.wasm.
# Needs wasi-sdk (WASI_SDK, or ~/.local/wasi/wasi-sdk-*). Arithmetic as the
# watch's: no fused multiply-adds; doubles throughout.
set -e
cd "$(dirname "$0")/.."
sdk="${WASI_SDK:-$(ls -d "$HOME"/.local/wasi/wasi-sdk-* 2>/dev/null | tail -1)}"
[ -x "$sdk/bin/clang" ] || { echo "wasi-sdk not found: set WASI_SDK" >&2; exit 1; }
exports="core_alloc core_free core_source core_build core_failure core_scene core_layout core_render core_render_update core_measure core_text_box core_text_width core_class core_zone core_status core_power"
flags=""
for e in $exports; do flags="$flags -Wl,--export=$e"; done
"$sdk/bin/clang" --target=wasm32-wasi -std=gnu11 -Oz -ffp-contract=off -mexec-model=reactor \
  -Wl,--no-entry -Wl,--strip-all -Wl,--export-memory -Wl,--initial-memory=4194304 $flags \
  -o public/core.wasm native/host/core_api.c native/src/c/chart.c native/src/c/fuller.c native/src/c/enroute_core.c \
  native/src/c/departure_font.c native/src/c/map_pack.c native/src/c/segments.c native/src/c/fmath.c native/src/c/passes.c
ls -l public/core.wasm
