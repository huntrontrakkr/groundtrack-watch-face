#!/bin/sh
# Sets the emulator's phone to a body and plate (its stored settings), for
# checks: stops the phone simulator, writes its localStorage, and installs
# the app again, which starts it. Usage: tools/emulator-body.sh sat:25544 crt
# [readout] (off, flag, callout; default flag). NUMERALS, MARGIN, SPAN and
# CLOCK24 set the rest, as tools/emulator-check.mjs reads them.
set -e
store="$HOME/.local/share/pebble-sdk/4.33.1/emery/localstorage/a0f61ba3-4580-4bf9-a71c-0a83f3d35600"
# The emulator too: pebble-tool starts a fresh one when the phone
# simulator has gone, and the old one would be left running.
for p in $(ps -eo pid,args | awk '/toolchain\/bin\/qemu-pebble |python -m pypkjs/ && !/awk/ {print $1}'); do kill "$p"; done
sleep 2
python3 - "$store" "$1" "${2:-crt}" "${3:-flag}" "${NUMERALS:-even}" "${MARGIN:-utc}" "${SPAN:-day}" "${CLOCK24:-1}" <<'PY'
import dbm.dumb,sys
d=dbm.dumb.open(sys.argv[1],'w')
for k,v in zip(['body','plate','readout','numerals','margin','span','clock24'],sys.argv[2:]):d[k.encode()]=v.encode()
d.close()
PY
cd "$(dirname "$0")/.."
PATH="$HOME/.local/bin:$PATH" timeout 150 pb install --emulator emery native/build/native.pbw
