# Native: Groundtrack Enroute on the watch

The Enroute face on Pebble Time 2 (`emery`, 200×228, 64 colours). `native/` is a Pebble SDK project. For the Sun and Moon the watch draws each hour's chart itself, from its own map and ephemeris, and needs the phone only now and then; its charts are the browser renderer's to the byte, and in the SDK's emulator its frames match the browser's pixel for pixel. A satellite's chart (GPS so far) still comes from the phone, an hour at a time.

## What runs where

The expensive part of the face, the hour's chart, holds still for an hour; each minute only a few things move. The hour's chart is a **class plane**: for each pixel, the ground beneath (water, land, a height tint, space) in the low nibble, and what was drawn over it (contour, coast, shelf, grid, route, ink, mark or a knockout) in the high nibble, with the hour's per-minute data (the Sun's direction, the body's position, the Moon's phase, Zulu time, a satellite's pass line). Each minute the minute renderer (`native/src/c/enroute_core.c`) colours the plane with the plate and adds night (flat zones, the dot screen, scan lines, the drawn terminator, from the Sun's direction and per-row and per-column tables: the chart is equidistant cylindrical), the bold route behind the body, the body, the minute flag, Zulu time and the pass line.

| | Sun and Moon | A satellite (GPS) |
|---|---|---|
| The hour's chart | built on the watch, each hour (`native/src/c/chart.c`) | rendered by the phone (`src/native-scene.js`) and sent, 22–31 KB |
| From the phone | settings; the Sun and Moon for weeks ahead; home's rise and set | the hour's scene, and the next five minutes before the hour |
| Without the phone | as long as the segments last (the phone sends 45 days) | the current hour |
| Each minute | the minute renderer | the minute renderer |

### The watch builds the hour

`native/src/c/chart.c` mirrors `buildScene` (`src/native-scene.js`) and the base layer of `renderEnroute` step for step, and builds the minute renderer's own scene:

- **The camera and track:** the hour and forty minutes either side, a minute apart, from the Sun and Moon segments.
- **The ground, streamed row by row** from the map pack: land from four bilinear samples of the atlas per pixel; the relief's bilinear sample and its three smoothing passes, as floats, exactly as the browser's `Float32Array`s; coast and waterline distances; contours, the shelf edge and height tints. Only three stages of three rows, a ring of smoothed rows and the map's columns under the chart are kept, never a full-frame array.
- **The base layer**, in the renderer's order, writing layers instead of colours: the graticule, home and the tracking network, the route cased, dashed and graduated, the rose, the hour figures (Jost, from a resource), home's mark, the margins with home's rise and set.

The build runs a slice at a time on short timers (about a second of work in pieces of at most 80 ms), so the firmware never sees the app stop answering; a single blocking second brings up its "not responding" dialog. It takes its memory in phases: about 76 KB at its peak (the class plane, the ground's rings, the map's decoder and rows), against 84 KB of heap free; nothing large is on the stack. The old hour's chart is dropped first; the screen keeps showing it until the new one is drawn.

### The map on the watch: `native/resources/map.pack`

`tools/relief-pack.mjs` packs the land atlas and the relief grid together, **without loss**: every relief code and land bit decodes exactly. Each cell's land bit is coded from six neighbouring land bits; its relief code is predicted from six decoded neighbours with fitted fixed-point weights (land and sea apart) and the difference coded against a frequency table chosen by land and by how large the neighbours' own differences were. Coding is rANS with fixed tables; strips of 32 rows decode independently. The pack keeps 79°N to 66°S, the latitudes the watch's views can show (GPS charts reach 77.5°N and 64.4°S, the world band 72°N to 60°S; `tests/map-pack.test.mjs` checks every view stays inside):

| | |
|---|---|
| Relief alone, deflated | 438 KB |
| Relief and land, packed, 79°N–66°S | 236 KB (`--world`: 270 KB) |
| All resources, with the figures | 248 KB of the app store's 256 KB (1 MB side-loaded) |

`native/src/c/map_pack.c` decodes it: 1.6 KB of code, 3 rows of working memory, reading the resource through a 256-byte buffer.

### The Sun and Moon: segments

Astronomy Engine won't fit the watch: its C for the Sun and Moon alone is 85 KB, and an app's code and static data are capped at 64 KB. So the browser, the phone and the watch all take the Sun and Moon from **daily Chebyshev segments** (`src/segments.js`), fitted to Astronomy Engine: latitude and longitude of the sub-solar and sub-lunar points, the Moon's lit fraction and phase angle, as float32 coefficients. They are within 1e-6° in latitude and 2e-5° in longitude of Astronomy Engine (about 2 m on the ground); 228 bytes a day on the watch. The phone fits them; the watch evaluates them (`native/src/c/segments.c`) with the JavaScript's arithmetic.

### Same arithmetic, same bits

Parity between the JavaScript and the C needs the same operations in the same order, and the same elementary functions:

- **Sine and cosine** come from `src/fmath.js` and `native/src/c/fmath.c`, one implementation (FreeBSD msun's kernels, after Sun's fdlibm): engines' `Math.sin` and C libraries' `sin` round their last bits differently (Node's and glibc's differ for 3–12% of inputs).
- **The watch's libm is not IEEE's.** Its `fmod` is wrong (`fmod(100, 5)` gives 0.11) and its square root can be an ulp off. `fmath.c` has fdlibm's exact remainder and correctly rounded square root, which match JavaScript's `%` and `Math.sqrt`.
- The SDK compiles apps for the Cortex-M3: all floating point is software, which is IEEE-exact for the basic operations. Builds keep multiplies and adds unfused (`-ffp-contract=off`).
- Tables the C needs (the plates, the tracking stations, the relief's heights, the figures) are generated from the JavaScript's own (`tools/generate-native-data.mjs`).

### The phone side

`native/pkjs/main.js` is the phone's source; `npm run build:pkjs` bundles it with esbuild into `native/src/pkjs/index.js` (generated, not committed), which the SDK packages with webpack 1: its parser takes ES2015 at most, and it indents every line of the file with a tab, which would change a template literal spanning lines, so the bundle targets ES2015 and has none. The bundle holds the renderer and the coastline and relief data (about 830 KB), for satellites' scenes.

Messages, all through one queue on the phone:

| | |
|---|---|
| `Settings` (phone → watch) | body, plate, flag, 24-hour, home and its position in hundredths of a degree: on launch and when settings change |
| `DataRequest` (watch → phone) | the first UTC day the watch lacks; asked on its minute ticks until the data arrives |
| `Segments`, `RiseSets` (phone → watch) | 45 days of segments from that day, eight to a message; home's rise and set for 45 local dates |
| `SceneRequest`, `SceneTotal`, `SceneOffset`, `SceneChunk`, `SceneStatus` | a satellite's scene, in 2,000-byte chunks, and why there is none |

Satellites' element sets are fetched from CelesTrak at most once every two hours each and used within three days of their epoch; GPS falls back to its nominal orbit. The app's settings page (`native/pkjs/config.html`, opened offline as a data URL) sets the body, plate, minute flag and home.

## What is verified

| | |
|---|---|
| The watch's scenes against the phone's (`tests/chart-native.test.mjs`) | byte for byte, across both bodies, all seven plates, homes, zones (with a half-hour one) and dates: 70 set cases and 120 random hours checked, 8 kept as tests |
| The map pack (`tests/map-pack.test.mjs`) | every cell exact, in JavaScript and C |
| Segments, sine, cosine, square roots, remainders (`tests/segments.test.mjs`) | the C gives the JavaScript's bits |
| The minute renderer against the browser (`tests/native.test.mjs`) | pixel-exact on every plate but Plotboard, whose inks change with night by anchor in the browser and by pixel here (≤0.1% of pixels) |
| The phone side (`tests/pkjs.test.mjs`, `tests/config-browser.mjs`) | scenes, requests, retries, settings, segments, rise and set |
| In the emery emulator (firmware 4.33.2, SDK 4.33.1) | the watch's own chart against the browser: 0 pixels differ; the hour turns with no phone |

`npm run check:emulator` (`tools/emulator-check.mjs`) takes an emulator screenshot and compares it with the browser's frame, and the *Native watch app* workflow runs it on every change.

## Measured so far

These are measurements of the code in the emulator and on the host, not of a watch.

| | |
|---|---|
| App code and static data | 47 KB of the 64 KB an app may have |
| Heap free at launch | 84 KB; about 76 KB used at a build's peak; 60 KB free with the hour's chart |
| Building the hour, in the emulator | about 1 second of work, in slices of at most 80 ms |
| Radio for the Sun and Moon | settings on launch; about 10 KB of segments every few weeks |
| Radio for a satellite | one scene an hour, about 15 messages of 2,000 bytes |
| Minute renderer, host CPU (a proxy only) | 0.6–0.9 ms; 2.5 ms with a drawn terminator |

## Building

With [pebble-tool](https://pypi.org/project/pebble-tool/) 5.0.40 and SDK 4.33.1:

```sh
uv tool install --python 3.11 pebble-tool==5.0.40   # or pip
pebble sdk install 4.33.1
npm run build:native                  # the phone bundle, then native/build/native.pbw for emery
tools/emulator.sh install --emulator emery native/build/native.pbw
npm run check:emulator                # screenshot, compared with the browser renderer
```

`tools/emulator.sh` stands in for `pebble` for emulator commands. The phone simulator runs JavaScript on STPyV8 13.1, whose ICU loading is broken: when it finds its own copy of `icudtl.dat` in `~/.local/share/stpyv8` it passes V8 a freed string, V8 starts without ICU, and the first `Intl.DateTimeFormat` aborts the simulator. The script moves that copy aside and runs pebble from a directory holding `icudtl.dat`, where V8 falls back to looking. It also runs the emulator without a window. The emulator needs `libsdl2-2.0-0`, `libpixman-1-0` and `libfdt1`; where they can't be installed, unpack them and point `PEBBLE_QEMU_PATH` at a wrapper for `qemu-pebble` that sets `LD_LIBRARY_PATH`.

Regenerate the watch's data after changing its sources: `npm run generate:map-pack` (the map), `node tools/generate-native-data.mjs` (plates, stations, relief heights, figures), `node tools/generate-native-font.mjs` (the chart lettering).

Without the SDK, the host harnesses in `native/host/` (`make -C native/host harness chart_test map_test segments_test fmath_test`) run the watch's C on the desktop; `npm test` uses them.

## Open questions and next steps

1. **Satellites on the watch.** GPS still comes from the phone each hour. SGP4 in C (satellite.js's algorithm) with the element set the phone already fetches (140 bytes, good for about three days) would make it the watch's too.
2. **The other views:** the world band (fast satellites and their tape), the whole-day chart (QZSS) with its time callout, events, the time callout on the hour chart, Rolling Fuller, and Plotboard's per-anchor zones.
3. **A real watch and phone.** Everything so far runs in the emulator. The build's second in the emulator says little about the Pebble Time 2's CPU; the phone app's JavaScript engines on iOS and Android, and the store's limits for the 1.7 MB `.pbw`, are unchecked.
4. **Quick View.** Timeline peeks cover the bottom of the screen; the face draws the whole frame regardless.
5. **Energy.** Profile a day of minute updates and the hourly build in the emulator (Dymaxion's `tools/energy` counts instructions through QEMU's monitor), then measure on a watch, as `docs/ENERGY.md` sets out. No battery claim is made until then.
