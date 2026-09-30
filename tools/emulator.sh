#!/bin/sh
# pebble-tool for the emulator, with its phone simulator able to run the
# app's phone side. Use it in place of `pebble` for emulator commands:
#
#   tools/emulator.sh install --emulator emery native/build/native.pbw
#   tools/emulator.sh screenshot --emulator emery --no-open shot.png
#
# The phone simulator, pypkjs, runs JavaScript on STPyV8 13.1, whose ICU
# data loading is broken: when it finds icudtl.dat in ~/.local/share/stpyv8
# (where STPyV8 itself copies it), it hands V8 a pointer to a string it has
# already freed, V8 starts without ICU, and the first Intl.DateTimeFormat
# (the renderer makes one for every time zone) aborts the simulator. With
# no file there, V8 falls back to ./icudtl.dat. So this moves the copy
# aside (keeping STPyV8's version stamp, so it isn't copied back) and runs
# pebble from a directory holding icudtl.dat, where the simulator starts.
#
# The emulator has no window here (SDL's dummy driver; screenshots read
# its frame buffer) unless SDL_VIDEODRIVER says otherwise. Relative file
# arguments (a .pbw, .png or .bin, or KEY=file) are made absolute.
set -e
pebble_bin=$(command -v pebble) || { echo "pebble-tool is not installed" >&2; exit 1; }
python=$(sed -n '1s/^#! *//p' "$pebble_bin")
icu=$("$python" -c 'import os,STPyV8;print(os.path.join(os.path.dirname(STPyV8.__file__),"stpyv8-icu","icudtl.dat"))')
[ -f "$icu" ] || { echo "No ICU data at $icu" >&2; exit 1; }
user_copy="$HOME/.local/share/stpyv8/icudtl.dat"
[ -f "$user_copy" ] && mv "$user_copy" "$user_copy.moved-aside"
dir="${XDG_CACHE_HOME:-$HOME/.cache}/groundtrack-emulator"
mkdir -p "$dir"
ln -sf "$icu" "$dir/icudtl.dat"

export SDL_VIDEODRIVER="${SDL_VIDEODRIVER:-dummy}" PYTHONUNBUFFERED=1
here=$(pwd)
n=$#
while [ $n -gt 0 ]; do
  a=$1; shift; n=$((n-1))
  case "$a" in
    -*|/*) ;;
    *=*) v=${a#*=}; case "$v" in /*) ;; *) [ -e "$here/$v" ] && a="${a%%=*}=$here/$v";; esac;;
    *.pbw|*.png|*.bin|*.ppm) a="$here/$a";;
  esac
  set -- "$@" "$a"
done
cd "$dir"
exec pebble "$@"
