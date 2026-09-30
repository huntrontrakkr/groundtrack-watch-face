# Native: Groundtrack Enroute on the watch

The first step from the browser studies toward an installable Pebble Time 2 watchface. It covers the Enroute face on the hour chart: the Sun, the Moon and slow orbits such as GPS, on every plate, with the minute flag. `native/` is a Pebble SDK project. Its drawing core is portable C, checked pixel for pixel against the browser renderer in this repository's tests, and the whole app, watch and phone side, runs in the SDK's `emery` emulator, where its frames match the browser's exactly.

## How the work is split

The expensive parts of the face hold still for an hour, and only a few pixels change each minute. So the work is split between phone and watch.

- **Phone, once an hour:** renders the hour's chart with the browser renderer, bundled into the app's phone JavaScript, in a *base* mode that leaves out everything that changes by the minute. The result is a **class plane**. For each pixel it holds the ground beneath (water, land, a height tint, space) in the low nibble, and what was drawn over it (contour, coast, shelf, grid, route, ink, mark, or a paper knockout) in the high nibble. The phone sends it with the hour's per-minute data (`src/native-scene.js` writes the format):
  - the Sun's direction
  - the body's position
  - the Moon's phase
  - Zulu time
  - a satellite's pass line, which can change within the hour
- **Watch, each minute:** colours the class plane with the plate and adds what changes (`native/src/c/enroute_core.c`):
  - night: flat zones or the dot screen, the scan lines and the drawn terminator, from the Sun's direction and per-row and per-column tables (the chart is equidistant cylindrical, so a pixel's direction is separable)
  - the bold route behind the body
  - the body on its knockout
  - the minute flag
  - Zulu time and the pass line

The watch never needs the relief grid (1 MB) or the coastline atlas; the phone does all the geography.

## The phone side

`native/pkjs/main.js` is the phone's source. `npm run build:pkjs` (`tools/build-pkjs.mjs`) bundles it with esbuild into `native/src/pkjs/index.js`, which the SDK packages; that file is generated and not committed. The SDK repackages it with webpack 1, which constrains the bundle: its parser takes ES2015 at most (so the bundle targets ES2015), and it indents every line of the file with a tab, which would change any template literal spanning lines (so esbuild emits none; the phone-side test runs the bundle indented the same way). The bundle holds:

- the renderer (`src/native-scene.js` and what it uses), about 225 KB minified
- the coastline atlas and the relief grid, deflated and embedded as base64: about 600 KB of the bundle's 811 KB. The repository is private, so the phone can't download them from it; embedding also means no network is needed at all

On launch the phone inflates the data (once per app run), builds the scene for the current civil hour in the phone's time zone and sends it to the watch. After that it only answers the watch. The watch asks with a time in the hour it wants: this hour's when it has no chart for it, and the next hour's five minutes before the hour, which it keeps until the hour turns, so the face never waits at the hour. The phone sends one scene at a time, keeps the last one so a repeated request (a transfer the watch lost) is sent again without rendering again, and gives up on a message after six failed tries; the watch asks again a minute later. On a desktop in Node a scene takes about 1 second, plus 0.35 seconds the first time to inflate the data; in the emulator's phone simulator (V8) it takes 170–190 ms after the first. A phone will be slower, but it happens once an hour.

`tests/pkjs.test.mjs` builds the bundle, runs it in a sandbox with a stand-in `Pebble` object and checks that the scene it sends, reassembled from its chunks, is byte for byte the one `tools/export-scene.mjs` writes for the same hour. It also checks the requests: the next hour when asked, one scene at launch, a repeated request sent again without rendering, and silence after a watch stops taking messages.

Settings live in the phone's `localStorage`. The app's settings page (`native/pkjs/config.html`, opened offline as a data URL from the Pebble app) sets the body, plate, minute flag and home; saving draws the hour again, and the watch drops any next hour it held and asks for it again. `tests/config-browser.mjs` drives the page in Chromium at 320 px and checks the scene the phone sends after saving.

| Key | Default | |
|---|---|---|
| `body` | `sun` | `sun`, `moon` or a satellite such as `sat:36585` (the page offers GPS on its nominal orbit) |
| `plate` | `enroute` | any Study 06 plate |
| `flag` | `1` | the minute flag, `1` or `0` |
| `timeZone` | the phone's | an IANA zone |
| `home` | the zone's preset home, if any | JSON `{"lat": …, "lon": …}`, rounded to 0.01°, or `{"none": true}` |
| `sceneServer` | none | fetch scenes from `tools/scene-server.mjs` instead, for development |

## What is verified

`tests/native.test.mjs` exports hours with the browser renderer, draws them with the C core on the host, and compares frames:

| Hours | Result |
|---|---|
| Sun over the Indian Ocean (Enroute, Sectional, Plotboard, Hypsometric, Night red, Green CRT, Sunlight) | Pixel-exact at every minute tried |
| Moon at nightfall, night across the chart (Enroute, Sectional, Hypsometric, Night red, Green CRT, Sunlight), with the minute flag | Pixel-exact |
| GPS (Green CRT) with the flag and a changing pass line | Pixel-exact |
| Moon at nightfall and GPS on **Plotboard** | 9–29 pixels differ per frame (≤0.1%) |

The Plotboard difference is a deliberate simplification. Plotboard's inks change with night, and the browser colours a symbol by the zone at its anchor point (a station's centre, a figure's corner), while the C core colours each pixel by the zone under it. They disagree only where a symbol straddles the terminator. On the other plates the inks don't change with night, so the two agree.

The watch app (`native/src/c/main.c`) is type-checked against a stand-in `pebble.h` (`native/host/stub/`) in `npm test`, where the SDK isn't installed. The SDK build and the emulator are the real check:

| In the `emery` emulator (firmware 4.33.2, SDK 4.33.1) | Result |
|---|---|
| The phone side renders the hour in the simulator and sends it in 14 chunks | Received and parsed |
| The watch's frame against the browser's at the same minute (Sun, Enroute, flag, New York) | Pixel-exact |

`npm run check:emulator` (`tools/emulator-check.mjs`) takes that screenshot and makes the comparison, and the *Native watch app* workflow runs it on every change.

## Measured so far

These are measurements of the code and data, not of a watch.

| | |
|---|---|
| App in RAM (code, static data), SDK build | 19.6 KB of the app's 128 KB, leaving 111 KB of heap |
| Heap free with this hour's scene received | 72 KB |
| Core code and read-only data, Cortex-M4, `-Os` | 6.7 KB (float build) |
| Core static buffers | 4.7 KB |
| Scene per hour, as sent | 22–31 KB (the class plane as row runs: 10.7–15.8 KB instead of 45.6 KB) |
| Phone bundle | 811 KB, of which about 600 KB is the embedded map data |
| Scene parsed on the watch (float build) | 6.9 KB, plus the track (about 2.3 KB); the class plane stays in the received scene |
| Bluetooth per hour | one scene, about 15 messages of 2,000 bytes; the watch's inbox is 2,100 bytes, not the 8,200-byte maximum |
| Single- vs double-precision night | at most 1 pixel per frame differs, so the watch can use its single-precision FPU |
| Host CPU time per minute (x86, a proxy only) | 0.6–0.9 ms; 2.5 ms with a drawn terminator (Green CRT, Night red) |

The terminator's cost comes from testing each pixel's neighbours; a row cache of sun-dot values would remove most of it.

## Building

With [pebble-tool](https://pypi.org/project/pebble-tool/) 5.0.40 and SDK 4.33.1 (the versions Dymaxion's release workflow uses):

```sh
uv tool install --python 3.11 pebble-tool==5.0.40   # or pip
pebble sdk install 4.33.1
npm run build:native                  # the phone bundle, then native/build/native.pbw for emery
tools/emulator.sh install --emulator emery native/build/native.pbw
npm run check:emulator                # screenshot, compared with the browser renderer
```

`tools/emulator.sh` stands in for `pebble` for emulator commands (`install`, `screenshot`, `logs`, `emu-app-config`). The phone simulator runs JavaScript on STPyV8 13.1, whose ICU loading is broken: when it finds its own copy of `icudtl.dat` in `~/.local/share/stpyv8` it passes V8 a freed string, V8 starts without ICU, and the first `Intl.DateTimeFormat` aborts the simulator. That is why a full phone bundle stopped the simulator before. The script moves that copy aside and runs pebble from a directory holding `icudtl.dat`, where V8 falls back to looking. It also runs the emulator without a window. The emulator needs `libsdl2-2.0-0`, `libpixman-1-0` and `libfdt1`; where they can't be installed, unpack them and point `PEBBLE_QEMU_PATH` at a wrapper for `qemu-pebble` that sets `LD_LIBRARY_PATH`.

To try renderer changes without rebuilding the app, run the scene server and set the phone's `sceneServer` setting to its address:

```sh
node tools/scene-server.mjs 5199   # GET /scene?body=sun&plate=enroute&flag=1&zone=America/New_York&at=<ms>
```

Without the SDK, these still work:

```sh
make -C native/host harness        # host harness: draw a scene, compare with reference frames
make -C native/host arm            # cross-compile the core for the Cortex-M4 and print its size
make -C native/host shim-check     # type-check main.c against the stand-in pebble.h
node tools/export-scene.mjs out sun-enroute sun 2026-09-27T08:00:00Z enroute flag 0 24 59
native/host/harness out/sun-enroute.scene out/sun-enroute 0 24 59
```

## Open questions and next steps

1. **The chart is lost when the face restarts.** A watchface is closed whenever another app or the menu opens, and the app's persistent storage (4 KB) can't hold a scene, so every return asks the phone for the hour again: a blank of a few seconds and a phone render. Keeping the class plane smaller (deflated, or the base drawn on the watch from a compact atlas in flash resources) would let it persist.
2. **The phone's JavaScript engine.** The bundle is ES2015 and needs `Intl.DateTimeFormat` with time zones, typed arrays and `DataView`; the emulator's V8 has all of them. The Pebble app's engines on iOS and Android, the bundle size they accept (811 KB) and a phone's render time are unchecked, as is the store's upload limit for the 1.7 MB `.pbw` (Dymaxion compresses its package for that). If the bundle is too large, the relief grid could be cut to the chart's latitudes, or downloaded once from a public host and cached.
3. **Quick View.** Timeline peeks cover the bottom of the screen; the face draws the whole frame regardless. Emery's unobstructed area isn't handled yet.
4. **Not yet native:**
   - the world band (fast satellites) and its tape
   - Rolling Fuller
   - the whole-day chart (QZSS)
   - the time callout
   - events (whose labels give way to the minute flag, so they change by the minute)
   - Plotboard's per-anchor zones
   - live satellite elements (GPS is the nominal orbit)
5. **Energy.** Profile a day of minute updates in the emulator (Dymaxion's `tools/energy` counts instructions through QEMU's monitor): instructions per minute, changed rows and peak heap. Then measure on a watch, as `docs/ENERGY.md` sets out. No battery claim is made until then.
