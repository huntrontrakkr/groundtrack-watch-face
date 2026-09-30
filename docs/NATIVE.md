# Native: Groundtrack Enroute on the watch

The Enroute face on Pebble Time 2 (`emery`, 200×228, 64 colours). `native/` is a Pebble SDK project. For the Sun, the Moon and six satellites (GPS on the hour chart; the ISS, Tiangong, Hubble, Landsat 9 and NOAA-20 on the world band) the watch draws each hour's chart itself, from its own map and ephemeris, and needs the phone only now and then; its charts are the browser renderer's to the byte, and in the SDK's emulator its frames match the browser's pixel for pixel.

## What runs where

The expensive part of the face, the hour's chart, holds still for an hour; each minute only a few things move. The hour's chart is a **class plane**: for each pixel, the ground beneath (water, land, a height tint, space) in the low nibble, and what was drawn over it (contour, coast, shelf, grid, route, ink, mark or a knockout) in the high nibble, with the hour's per-minute data (the Sun's direction, the body's position, the Moon's phase, Zulu time, a satellite's pass line, height and tape index, home's acquisition circle). Each minute the minute renderer (`native/src/c/enroute_core.c`) colours the plane with the plate and adds night (flat zones, the dot screen, scan lines, the drawn terminator, from the Sun's direction and per-row and per-column tables: the chart is equidistant cylindrical), the bold route behind the body, the body, the minute flag or the tape's index, Zulu time, the pass line and the height.

The layers also record *when* in the browser's drawing each pixel was last drawn, so the minute renderer can put the moving things between them as the browser does: home's acquisition circle goes under the network's own circles (drawn after it, layer 11); the route's bold line under everything drawn after the route but over the network's knockouts (12, 13); the body under the hour figures, home's mark and the margins drawn after it (14, 15), and the minute flag over the figures but under home and the margins.

| | Sun and Moon | A satellite |
|---|---|---|
| The hour's chart | built on the watch, each hour (`native/src/c/chart.c`) | built on the watch, each hour: GPS on the hour chart, the fast satellites on the world band |
| From the phone | settings; the Sun and Moon for weeks ahead; home's rise and set | as for the Sun, plus the satellite's segments and home's passes for three days |
| Without the phone | as long as the segments last (the phone sends 45 days) | as long as the satellite's segments last (three days from its elements' epoch) |
| Each minute | the minute renderer, redrawing only what changed | the same |

The phone can still render and send a whole scene (`src/native-scene.js`, 22–33 KB an hour); the watch would use that path only for a body it cannot build. QZSS's whole-day chart is the one view neither builds yet.

### The watch builds the hour

`native/src/c/chart.c` mirrors `buildScene` (`src/native-scene.js`) and the base layer of `renderEnroute` step for step, and builds the minute renderer's own scene:

- **The camera and track:** the hour and forty minutes either side, a minute apart, from the Sun and Moon segments or a satellite's; for the world band twenty minutes either side every fifteen seconds, the whole world between 72°N and 60°S fitted to the hour's longitudes.
- **The ground, streamed row by row** from the map pack: land from four bilinear samples of the atlas per pixel; the relief's bilinear sample and its three smoothing passes, as floats, exactly as the browser's `Float32Array`s; coast and waterline distances; contours, the shelf edge and height tints. Only three stages of three rows, a ring of smoothed rows and the map's columns under the chart are kept, never a full-frame array.
- **The base layer**, in the renderer's order, writing layers instead of colours: the graticule, home and the tracking network (on the world band with their acquisition circles), the route cased, dashed and graduated, the rose, the hour figures (Jost, from a resource) or the world band's tape, home's mark, the margins with home's rise and set or the satellite's elements.
- **The minutes:** for each, the Sun's direction, the body's place, the Moon's phase, the pass line, and on the world band the tape's index, the satellite's height and home's acquisition circle for that height (120 points by arcsine and arctangent, the same functions as the browser's; minutes that plot the same pixels share one).

Each minute the face redraws only what changed: per row, the minute renderer knows which 16-pixel blocks lie wholly in day or in night, repaints the blocks the terminator crossed and the boxes of the moving things (body, route, flag, Zulu time, pass line), and leaves the rest of the frame buffer as it was. A full repaint happens only when the face comes back into focus.

The build runs a slice at a time on short timers (about a second of work in pieces of at most 80 ms: the ground twelve rows at a time, the drawing, the minutes six at a time), so the firmware never sees the app stop answering; a single blocking second brings up its "not responding" dialog. The old hour's chart is dropped first; the screen keeps showing it until the new one is drawn. Memory is the tight part, 74 KB of heap for everything, and the build takes it in phases so that no two large things are held at once:

1. **The ground** (the map's decoder and rows, the smoothing rings: about 34 KB) writes its classes row by row as row runs into a 16 KB arena, taken first.
2. The decoder freed, **the class plane** (45.6 KB) is unpacked from the runs, in the one free stretch the arena leaves; the arena then holds the track and the drawing's lists.
3. **The drawing**, then the plane as row runs into the arena again, the plane freed, and the runs moved to their own size.
4. **The scene and its minutes**, in what the plane left.

At its peak a build holds about 66 KB; a finished hour 24–34 KB. A first version held the plane throughout and needed 80 KB for the world band; `tests/chart-native.test.mjs` now checks every case's peak.

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

### Satellites: segments and passes

SGP4 is too large for the watch, and its element set good for only about three days anyway, so a satellite is handled like the Sun: the phone runs SGP4 on CelesTrak's elements and fits **Chebyshev segments** to it (`src/segments.js`): an hour for a low orbit, six hours otherwise, with latitude and longitude (14 terms) and altitude (8), with the elements' epoch, 160 bytes each. The browser draws from the same segments, so the two agree to the bit; they are within about 0.005° of SGP4 for GPS. Passes over home are found **deterministically** (`src/home.js`): in blocks of 12 hours from midnight UTC, sampled at absolute 20-second marks, so the phone and the browser find the same passes whenever they look; the watch stores the blocks and composes the chart's top line from them (`native/src/c/passes.c`).

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
| `Settings` (phone → watch) | body, plate, flag, 24-hour, home and its position in hundredths of a degree, and a satellite's catalog number, symbol, view and code: on launch and when settings change |
| `DataRequest`, `DataBody` (watch → phone) | the first UTC day the watch lacks, and the satellite it needs, if any; asked on its minute ticks at most every few minutes until the data arrives |
| `Segments`, `RiseSets` (phone → watch) | 45 days of segments from that day, eight to a message; home's rise and set for 45 local dates |
| `SatSegments`, `Passes` (phone → watch) | three days of a satellite's segments (160 bytes each, with its elements' epoch), twelve to a message; home's pass blocks for them |
| `SceneRequest`, `SceneTotal`, `SceneOffset`, `SceneChunk`, `SceneStatus` | a satellite's scene, in 2,000-byte chunks, and why there is none |

Satellites' element sets are fetched from CelesTrak at most once every two hours each and used within three days of their epoch; GPS falls back to its nominal orbit. The app's settings page (`native/pkjs/config.html`, opened offline as a data URL) sets the body (the Sun, the Moon or one of six satellites), plate, minute flag and home.

## What is verified

| | |
|---|---|
| The watch's scenes against the phone's (`tests/chart-native.test.mjs`) | byte for byte, across the Sun, the Moon, GPS and the world band's satellites (from CelesTrak's elements of 29 September 2026, kept in `tests/fixtures`), all seven plates, homes, zones (with a half-hour one) and dates; with each build's peak memory |
| The map pack (`tests/map-pack.test.mjs`) | every cell exact, in JavaScript and C |
| Segments, sines, arcsines, arctangents, square roots, remainders (`tests/segments.test.mjs`) | the C gives the JavaScript's bits |
| The minute renderer against the browser (`tests/native.test.mjs`) | pixel-exact on every plate but Plotboard, whose inks change with night by anchor in the browser and by pixel here (≤0.1% of pixels) |
| The phone side (`tests/pkjs.test.mjs`, `tests/config-browser.mjs`) | scenes, requests, retries, settings, segments, rise and set |
| In the emery emulator (firmware 4.33.2, SDK 4.33.1) | the watch's own chart against the browser: 0 pixels differ for the Sun after partial minute redraws, for GPS, the ISS and Landsat 9 (home's acquisition circle and a polar route over the margin) from live CelesTrak elements; the hour turns with no phone |

`npm run check:emulator` (`tools/emulator-check.mjs`) takes an emulator screenshot and compares it with the browser's frame, and the *Native watch app* workflow runs it on every change.

## Measured so far

These are measurements of the code in the emulator and on the host, not of a watch.

| | |
|---|---|
| App code and static data | 56 KB of the 64 KB an app may have (doubles in software make every sum a call) |
| Heap free at launch | 72 KB; about 66 KB used at a build's peak; 33–47 KB free with the hour's chart |
| Building the hour, in the emulator | 0.7–1.1 seconds of work, in slices |
| Radio for the Sun and Moon | settings on launch; about 10 KB of segments every few weeks |
| Radio for a satellite | GPS about 2.5 KB of segments and passes every day or two; a fast satellite (hour-long segments) about 13 KB every two to three days |
| Instructions for a minute change, in the emulator | the Sun 4.0 million (24.2 million with full repaints; 5.8 million before night's fixed-point filter); the ISS's world band 10 million |
| Instructions for building the hour | the Sun 114 million; the ISS 105 million |
| Instructions for a day (1,440 minutes and 24 builds) | the Sun 8.4 billion (37.7 billion at first); the ISS 16.9 billion |

The instruction counts come from `tools/energy/` (after Dymaxion's), which traces QEMU's executed blocks in windows around a minute change, a build and an idle stretch (`MEASURE_BODY` and `MEASURE_PLATE` pick the chart); `tools/energy/profile.mjs` shares a window's instructions out among the app's functions. The *Measure watch work* workflow compares a change against its base.

Night is the minute's largest cost: each pixel near the terminator compares the Sun's height there with a threshold, and the watch's doubles are software. The minute renderer first sums the height in 2^30 fixed point (a few integer instructions) and takes the double sums, whose bits the browser's decide, only within a hair of a threshold; `tests/native.test.mjs` checks every minute of eight hours against a build that always takes the doubles. On the world band, where the terminator crosses the whole map, this took a minute from about 44 to 10 million instructions. Details: [`docs/energy/minute-redraw.md`](energy/minute-redraw.md). They are instructions, not current: the display, flash and radio are not modelled.

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

1. **The other views and options:** the whole-day chart (QZSS) with its time callout; the world band's moving tapes; events; the time callout and the figure styles on the hour chart; Zulu's nautical zone; Rolling Fuller; and Plotboard's per-anchor zones.
2. **Code space.** 56 of 64 KB: the other views need room, which may mean trimming (single-precision where the pixels allow, shared helpers) or moving work to the phone.
3. **A real watch and phone.** Everything so far runs in the emulator. The build's second in the emulator says little about the Pebble Time 2's CPU; the phone app's JavaScript engines on iOS and Android, and the store's limits for the 1.7 MB `.pbw`, are unchecked.
4. **Quick View.** Timeline peeks cover the bottom of the screen; the face draws the whole frame regardless.
5. **Energy on a watch.** The emulator's instruction counts guide the work; current is measured only on a watch, as `docs/ENERGY.md` sets out. No battery claim is made until then.
