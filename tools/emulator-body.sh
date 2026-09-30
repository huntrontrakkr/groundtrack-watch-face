#!/bin/sh
# Sets the emulator's phone to a body and plate (its stored settings), for
# checks: stops the phone simulator, writes its localStorage, and installs
# the app again, which starts it. Usage: tools/emulator-body.sh sat:25544 crt
# [readout] (off, flag, callout; default flag). NUMERALS, MARGIN, SPAN,
# CLOCK24, TAPE and TRANSFER set the rest, as tools/emulator-check.mjs reads them; EVENTS_STORED
# the phone's events as it keeps them (JSON [{epoch, title, label}]).
set -e
# FACE=plotboard for Groundtrack Plotboard (default Enroute).
if [ "${FACE:-enroute}" = plotboard ]; then project=native-plotboard; else project=native; fi
uuid=$(python3 -c "import json;print(json.load(open('$(dirname "$0")/../$project/package.json'))['pebble']['uuid'])")
store="$HOME/.local/share/pebble-sdk/4.33.1/emery/localstorage/$uuid"
# The emulator too: pebble-tool starts a fresh one when the phone
# simulator has gone, and the old one would be left running.
for p in $(ps -eo pid,args | awk '/toolchain\/bin\/qemu-pebble |python -m pypkjs/ && !/awk/ {print $1}'); do kill "$p"; done
sleep 2
readout="${3:-flag}";[ "$readout" = noflag ] && readout=off
python3 - "$store" "$1" "${2:-crt}" "$readout" "${NUMERALS:-even}" "${MARGIN:-utc}" "${SPAN:-day}" "${CLOCK24:-1}" "${TAPE:-fixed}" "${TRANSFER:-off}" <<'PY'
import dbm.dumb,sys
d=dbm.dumb.open(sys.argv[1],'w')
for k,v in zip(['body','plate','readout','numerals','margin','span','clock24','tape','transfer'],sys.argv[2:]):d[k.encode()]=v.encode()
import os
if os.environ.get('EVENTS_STORED'):d[b'events']=os.environ['EVENTS_STORED'].encode()
d.close()
PY
cd "$(dirname "$0")/.."
PATH="$HOME/.local/bin:$PATH" timeout 150 pb install --emulator emery $project/build/$project.pbw
