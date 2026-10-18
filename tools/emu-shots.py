"""Screenshots of the running emulator, one after another over a single connection, for as long as asked: each a
frame of raw RGB (the screen's width by height, three bytes a pixel) appended to one file. Run with pebble-tool's
own Python (it holds libpebble2): tools/capture-switch.mjs runs it.

    <pebble-tool python> tools/emu-shots.py <emery|gabbro> <seconds> <out.rgb>

(`pebble screenshot` connects anew for each, a few seconds apiece, and the emulator falls behind.)
"""
import sys
import time

from libpebble2.communication import PebbleConnection
from libpebble2.communication.transports.websocket import WebsocketTransport
from libpebble2.services.screenshot import Screenshot
from pebble_tool.sdk.emulator import get_emulator_info


def main():
    platform, seconds, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    info = get_emulator_info(platform)
    if not info:
        sys.exit(f"emu-shots: no {platform} emulator running")
    pebble = PebbleConnection(WebsocketTransport(f"ws://localhost:{info['pypkjs']['port']}/"))
    pebble.connect()
    pebble.run_async()
    shots, n, end = Screenshot(pebble), 0, time.time() + seconds
    with open(out, "wb") as f:
        while time.time() < end:
            try:
                rows = shots.grab_image()
            except Exception:
                continue
            for row in rows:
                f.write(bytes(row))
            n += 1
    print(f"{n} screenshots")


if __name__ == "__main__":
    main()
