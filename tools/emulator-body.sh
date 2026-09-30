#!/bin/sh
# Sets the emulator's phone to a body and plate (its stored settings), for
# checks: stops the phone simulator, writes its localStorage, and installs
# the app again, which starts it. Usage: tools/emulator-body.sh sat:25544 crt
set -e
store="$HOME/.local/share/pebble-sdk/4.33.1/emery/localstorage/a0f61ba3-4580-4bf9-a71c-0a83f3d35600"
pkill -f "[p]ypkjs --qemu" || true
sleep 1
python3 - "$store" "$1" "${2:-crt}" <<'PY'
import dbm.dumb,sys
d=dbm.dumb.open(sys.argv[1],'w');d[b'body']=sys.argv[2].encode();d[b'plate']=sys.argv[3].encode();d.close()
PY
cd "$(dirname "$0")/.."
PATH="$HOME/.local/bin:$PATH" timeout 150 pb install --emulator emery native/build/native.pbw
