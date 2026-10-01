# Native: Groundtrack and Groundtrack Fuller on the watch

Study 06 on Pebble Time 2 (`emery`, 200×228, 64 colours), as three watch faces built from one source:

- **Groundtrack** (`native/`): the body chooses the chart. The Sun, the Moon and GPS have Enroute's hour chart, QZSS its whole day (or its hour), and the ISS, Tiangong, Hubble, Landsat 9 and NOAA-20 Plotboard's world band, with its tapes or its clock. (Enroute and Plotboard were two apps until 2 October 2026; they share the map and the chart, and one app holds both.)
- **Groundtrack Fuller** (`native-fuller/`, whose sources and resources are `native/`'s, linked): the rolling Fuller sheet of any of the nine bodies: a satellite's hour, the Sun's, the Moon's and QZSS's day (or QZSS's hour).

Each compiles only its own charts (`native/src/c/face.h`: the other face's code is left out as dead code), so each has room under PebbleOS's 64 KB cap for an app, and heap for its builds: Groundtrack's code is 63.6 KB, Fuller's 63.0 KB. All of them in one app would be 82 KB, 16.5 KB over (Fuller's projection is 16 KB the others don't share; single-precision arithmetic throughout would still leave it about 10 KB over). The chart lettering's glyphs are a resource read at start (`font.bin`, 1.7 KB), not code. The phone side is one source bundled for each face, with its own bodies and settings; each face has its own app id, listing and settings. The host tests exercise both faces' code together.

**Groundtrack Fuller.** The watch rolls the icosahedron along the track as the study does (`native/src/c/fuller.c`, to the same bits) and builds the sheet's ground from the faces' pre-projected grids (`fuller.bin`, 100 KB; see Study 06), not from the map pack, which this face leaves out: a pixel's place on its face's grid is an integer affine function of the pixel, and its land, relief and the Sun's height are interpolated between three grid points in integers. Zoomed in past 150 px a face (GPS's hour) its coastline comes from the quarter-degree `land.bin` (130 KB) at the grids' directions. Each minute the renderer lights the sheet from the grid; measured at 35 million instructions, six times Enroute's minute, because it draws the whole ground again each minute and compares heights in software doubles (see [energy/review-2026-09-30.md](energy/review-2026-09-30.md) for the plan to pare it down). The build fits a smaller heap: the class plane is kept in four bands, so its runs can be made a band at a time, and the track is rolled again for the drawing rather than kept.

For the Sun, the Moon and all seven satellites (GPS on the hour chart; the ISS, Tiangong, Hubble, Landsat 9 and NOAA-20 on the world band; QZSS on the whole-day chart) the watch draws each hour's chart itself, from its own map and ephemeris, and needs the phone only now and then. The same code is the study's renderer: `tools/build-core.sh` compiles it to WebAssembly (`public/core.wasm`, behind `native/host/core_api.c` and `src/core.js`), so the page draws with the watch's code and there is one renderer to change. In the SDK's emulator the watch's frames match the core's pixel for pixel (`npm run check:emulator`).

## What runs where

The expensive part of the face, the hour's chart, holds still for an hour; each minute only a few things move. The hour's chart is a **class plane**: for each pixel, the ground beneath (water, land, a height tint, space) in the low nibble, and what was drawn over it (contour, coast, shelf, grid, route, ink, mark or a knockout) in the high nibble, with the hour's per-minute data (the Sun's direction, the body's position, the Moon's phase, Zulu time, a satellite's pass line, height and tape index, home's acquisition circle). Each minute the minute renderer (`native/src/c/enroute_core.c`) colours the plane with the plate and adds night (flat zones, the dot screen, scan lines, the drawn terminator, from the Sun's direction and per-row and per-column tables: the chart is equidistant cylindrical), the bold route behind the body, the body, the minute flag or the tape's index, Zulu time, the pass line and the height.

The layers also record *when* in the browser's drawing each pixel was last drawn, so the minute renderer can put the moving things between them as the browser does: home's acquisition circle goes under the network's own circles (drawn after it, layer 11); the route's bold line under everything drawn after the route but over the network's knockouts (12, 13); the body under the hour figures, home's mark and the margins drawn after it (14, 15), and the minute flag over the figures but under home and the margins.

| | Sun and Moon | A satellite |
|---|---|---|
| The hour's chart | built on the watch, each hour (`native/src/c/chart.c`) | built on the watch, each hour: GPS on the hour chart, the fast satellites on the world band |
| From the phone | settings; the Sun and Moon for weeks ahead; home's rise and set | as for the Sun, plus the satellite's segments and home's passes for three days |
| Without the phone | as long as the segments last (the phone sends 45 days) | as long as the satellite's segments last (three days from its elements' epoch) |
| Each minute | the minute renderer, redrawing only what changed | the same |

The phone sends no charts: it once rendered satellites' scenes and sent them an hour at a time (22–33 KB each), a path removed once every view was built on the watch. What it sends is the input the chart builder takes (`src/chart-input.js` writes it as text for the host tools and the study: settings, the local hour and date, home and its rise and set, the Sun, Moon and satellite segments, home's passes).

### The watch builds the hour

`native/src/c/chart.c` builds the minute renderer's scene from the hour's input (it was written to mirror the study's JavaScript renderer step for step, until the study moved onto it):

- **The camera and track:** the hour and forty minutes either side, a minute apart, from the Sun and Moon segments or a satellite's; for the world band twenty minutes either side every fifteen seconds, the whole world between 72°N and 60°S fitted to the hour's longitudes; for the whole-day chart the local day (23 or 25 hours across a clock change) every five minutes, its shape fitted and set to the right, graduated in hours.
- **The ground, streamed row by row** from the map pack's tiles: land from four bilinear samples per pixel and the relief's bilinear sample, in integers (fractions in Q8, heights in Q8 metres), from the resolution whose cells are at most a pixel wide; three smoothing passes in integers; coast and waterline distances; contours, the shelf edge and height tints. Only six decoded tiles, three stages of three rows and a ring of smoothed rows are kept, never a full-frame array.
- **The base layer**, in the renderer's order, writing layers instead of colours: the graticule, home and the tracking network (on the world band with their acquisition circles), the route cased, dashed and graduated, the rose, the hour figures (Jost, from a resource) or the world band's tape, home's mark, the margins with home's rise and set or the satellite's elements.
- **The time callout** is the minute's: on the whole-day chart set aside in open map level with the satellite, on the hour chart (as an option) hung under the body on the side that keeps it on the face and its leader clearest; an elbow leader breaks for lettering. The minute renderer sets the time in the chosen figures from the 20, 28 and 40 px Jost figures, which the scene keeps (the colon drawn to match, Departure Mono's doubled from its regular figures).
- **The minutes:** for each, the Sun's direction, the body's place, the Moon's phase, the pass line, and on the world band the tape's index, the satellite's height and home's acquisition circle for that height (120 points by arcsine and arctangent, the same functions as the browser's; minutes that plot the same pixels share one).

Each minute the face redraws only what changed: per row, the minute renderer knows which 16-pixel blocks lie wholly in day or in night, repaints the blocks the terminator crossed and the boxes of the moving things (body, route, flag, Zulu time, pass line), and leaves the rest of the frame buffer as it was. A full repaint happens only when the face comes back into focus.

The build runs a slice at a time on short timers (about a second of work in pieces of at most 80 ms: the ground twelve rows at a time, the drawing, the minutes six at a time), so the firmware never sees the app stop answering; a single blocking second brings up its "not responding" dialog. The old hour's chart is dropped first; the screen keeps showing it until the new one is drawn. Memory is the tight part (about 63 KB of heap on each face, for everything), and the build takes it in phases so that no two large things are held at once:

1. **The ground** (the map's decoder and rows, the smoothing rings: about 25 KB) writes its classes row by row as row runs into an 8 KB arena, taken first, and 2 KB chunks past it.
2. The decoder freed, **the drawing's plane** holds only what is drawn over the ground, a nibble a pixel (22.8 KB in four bands; nothing drawn is 0): the ground stays in its runs, read where the drawing asks what lies under a pixel. The track and the drawing's lists take a block of their own, with only the hour figures' digits that are drawn.
3. **The drawing**; then each row's ground and what was drawn over it merged into the scene's runs, a band of the plane at a time, the band let go.
4. **The scene and its minutes**, in what the plane left. A Fuller sheet's night is lit from every other point of the faces' grid of directions (3.4 KB for 12.9 KB). Zoomed in, its coastline comes from `land.pack`, the quarter-degree land bits as runs (16 KB for land.bin's 130 KB, `tools/land-pack.mjs`), read a row at a time.

At its peak a build holds 43–47 KB on Groundtrack and 47–51 KB on Fuller; a finished hour 24–40 KB. (A first version held a byte-a-pixel plane throughout and needed 80 KB; the next, 60–64 KB, which on Fuller was within a KB or two of the heap, and failed on the hours that needed a little more.) `tests/native.test.mjs` holds each face, built alone as its app is (`native/host/build_check-<face>`), to a budget that leaves a fifth of its heap free at the peak; `tools/check-app-size.mjs`, run after the build in CI, holds each app about 700 bytes under the 65,535 bytes an app may be (Fuller, the largest, is about 900 under), and checks its header leads the binary. The apps are optimised across their sources at link time (`-flto`, about 1 KB smaller: every byte of an app is a byte of its heap).

### The map on the watch: `native/resources/map.pack`

The plates read relief only through ten thresholds (the shelf at −200 m, the contours at 500 to 5,000 m, the tints at 300 to 3,500 m), so `tools/map-pack.mjs` packs each cell's *level* between them with its land bit, in tiles of 32×32 cells that decode on their own, at three resolutions (0.25°, 0.5° and 1° cells, the coarser ones by majority): a chart decodes only the tiles under it, at the resolution its pixels need (the Sun's hour at 8 px a degree reads the 0.25° cells; the world band at about a pixel a degree reads the 1° cells). Each cell's land bit is coded from four neighbouring land bits, its level against a table chosen by land and the levels to its left and above; coding is rANS with fixed tables, and a tile of one level and one class is two bytes. The pack keeps 79°N to 66°S, the latitudes the watch's views can show (`tests/map-pack.test.mjs` checks every view stays inside, and that both decoders give every cell):

| | |
|---|---|
| The earlier pack: every relief code, losslessly, 0.25° | 236 KB |
| Levels and land at 0.25°, 0.5° and 1° (`map.pack`, Enroute) | 51 KB |
| Decoded for a Sun's hour chart | about 12 tiles, 12,000 cells (200,000 before) |
| Decoded for the world band | 60 tiles, 52,000 cells (830,000 before) |

Rendered from levels instead of heights, contour lines and tint edges move by a pixel here and there (the review of 30 September 2026 shows the comparison).

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

`native/pkjs/main.js` is the phone's source; `npm run build:pkjs` bundles it with esbuild into `native/src/pkjs/index.js` (generated, not committed), which the SDK packages with webpack 1: its parser takes ES2015 at most, and it indents every line of the file with a tab, which would change a template literal spanning lines, so the bundle targets ES2015 and has none. The bundle is about 140 KB: the settings page, the ephemeris and SGP4 it fits segments with.

Messages, all through one queue on the phone:

| | |
|---|---|
| `Settings` (phone → watch) | body, plate, flag, 24-hour, home and its position in hundredths of a degree, and a satellite's catalog number, symbol, view and code: on launch and when settings change |
| `DataRequest`, `DataBody` (watch → phone) | the first UTC day the watch lacks, and the satellite it needs, if any; asked on its minute ticks at most every few minutes until the data arrives |
| `Segments`, `RiseSets` (phone → watch) | 45 days of segments from that day, eight to a message; home's rise and set for 45 local dates |
| `Events` (phone → watch) | events from two hours ago to four days ahead: each its time and five-letter name (9 bytes) |
| `SatSegments`, `Passes` (phone → watch) | three days of a satellite's segments (160 bytes each, with its elements' epoch), twelve to a message; home's pass blocks for them |
| `Status` (phone → watch) | why the phone can't give what was asked (no elements for a satellite) |

Satellites' element sets are fetched from CelesTrak at most once every two hours each and used within three days of their epoch; GPS falls back to its nominal orbit. The app's settings page (`native/pkjs/config.html`, opened offline as a data URL) opens on a preview of the face that is the watch's own: the core, compiled to WebAssembly (`tools/build-core.sh`: 145 KB, sized for this), with the face's resources gzipped into the phone app (`tools/build-pkjs.mjs`), builds and draws this hour and minute from the chart input the phone makes for it (`src/chart-input.js`: the body chosen, and the Sun and Moon), each change of plate, figures, readout, corner, time scale or clock drawn again at once; beside it the same frame as the watch's reflective screen shows its colours (Pebble's Sunlight mapping, `data/sunlight-colors.json`). The page is about 208 KB (Groundtrack) or 230 KB (Fuller); a phone without WebAssembly or gzip streams shows no preview. The page sets the body (the Sun, the Moon or one of seven satellites), plate, home, events (a title and a time, set on the route as compulsory reporting points named with five letters, as the study names them), and the browser's clock options: 24-hour figures, the minute readout (none, the minute flag or a time callout), the callout's figures (four figures with the minutes outlined, the browser's default; the minutes in route ink; in Departure Mono; smaller without or with a colon), the margin's time (Zulu or the nautical zone under the body), QZSS's chart (its whole day or this hour) and the world band's time scale (fixed; a sliding tape; the tape with the world sliding under it: the band is then the whole world round at 0.56 px a degree, built once an hour and turned under the index each minute; or a clock, the time in the callout's figures and style in the panel instead of a tape), the figure set (Michroma, the default; Jost; B612; Orbitron), and the margins' corner (the day of the year or, on the world band, the height; the body's ground point; the Moon's light). The corner shows the watch's own state while it lasts: NO LINK when the phone is out of reach, BAT 18 at 20% or less and not charging (the watch's battery and connection services; a change draws the minute again whole), and EL OLD for elements over two days old, and, under the fixed ruler, how its even minutes fall on the route (none; a vernier of the route's own minutes; a comb of strokes leaning toward them; chevrons where the route squeezes or stretches them).

## What is verified

| | |
|---|---|
| Every hour the faces draw builds within the watch's memory (`tests/native.test.mjs`) | the Sun, the Moon, GPS, the world band's satellites and QZSS's day and hour (from CelesTrak's elements of 29 September 2026, kept in `tests/fixtures`), the plates, homes, zones (with a half-hour one), dates, callouts, events, tapes and Fuller sheets; each build's peak under 69 KB |
| The study draws with the watch's code (`tests/*.test.mjs`, `tests/enroute-browser.mjs`) | the art's rules (figures clear of the rose and route, the flag between route and figures, stations without collisions, the tape's index, the Fuller net's continuity, home's mark, events' names, Zulu time in the margin) hold on the core's frames; the page's canvas shows the core's pixels |
| The map pack (`tests/map-pack.test.mjs`) | every tile's cells exact, in JavaScript and C; the levels are every height the plates read |
| Segments, sines, arcsines, arctangents, square roots, remainders (`tests/segments.test.mjs`) | the C gives the JavaScript's bits |
| A minute drawn over the last (`tests/native.test.mjs`) | every minute of every hour above, drawn over the minute before (and over a jump of five), is the minute drawn whole |
| The phone side (`tests/pkjs.test.mjs`, `tests/config-browser.mjs`) | scenes, requests, retries, settings, segments, rise and set |
| In the emery emulator (firmware 4.33.2, SDK 4.33.1) | the watch's own chart against the browser: 0 pixels differ for the Sun after partial minute redraws, for GPS, the ISS, Landsat 9 (home's acquisition circle and a polar route over the margin) and QZSS's day from live CelesTrak elements; the hour turns with no phone |

`npm run check:emulator` (`tools/emulator-check.mjs`) takes an emulator screenshot and compares it with the browser's frame, and the *Native watch app* workflow runs it on every change.

## Measured so far

These are measurements of the code in the emulator and on the host, not of a watch.

| | |
|---|---|
| App code and static data | Groundtrack 63.6 KB, Fuller 63.0 KB, of the 64 KB an app may have (PebbleOS keeps an app's size in 16 bits, whatever the SDK says; doubles in software make every sum a call). The minute renderer's 4.6 KB of working memory is taken from the heap for each drawing, not kept |
| Heap free at launch | 63 KB on Groundtrack, 64 KB on Fuller (less the lettering's 1.7 KB); 43–51 KB used at a build's peak; 39–49 KB free with the hour's chart (Fuller 27–42 KB) |
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
npm run build:native                  # both faces: native/build/native.pbw, native-fuller/build/native-fuller.pbw
tools/emulator.sh install --emulator emery native/build/native.pbw
npm run check:emulator                # screenshot, compared with the core's frame
```

`tools/emulator.sh` stands in for `pebble` for emulator commands. The phone simulator runs JavaScript on STPyV8 13.1, whose ICU loading is broken: when it finds its own copy of `icudtl.dat` in `~/.local/share/stpyv8` it passes V8 a freed string, V8 starts without ICU, and the first `Intl.DateTimeFormat` aborts the simulator. The script moves that copy aside and runs pebble from a directory holding `icudtl.dat`, where V8 falls back to looking. It also runs the emulator without a window. The emulator needs `libsdl2-2.0-0`, `libpixman-1-0` and `libfdt1`; where they can't be installed, unpack them and point `PEBBLE_QEMU_PATH` at a wrapper for `qemu-pebble` that sets `LD_LIBRARY_PATH`.

Regenerate the watch's data after changing its sources: `npm run generate:map-pack` (the map), `node tools/generate-native-data.mjs` (plates, stations, relief heights, figures), `node tools/generate-native-font.mjs` (the chart lettering).

Without the SDK, the host harnesses in `native/host/` (`make -C native/host harness build_check map_test segments_test fmath_test`) run the watch's C on the desktop; `npm test` uses them. `tools/build-core.sh` (wasi-sdk) builds the core for the study and the tests that draw.

## Open questions and next steps

1. **Rolling Fuller.** The one view of the study the watch doesn't draw: its map is an icosahedron rolled along the route, and night on it needs each pixel's own direction every minute, which neither the watch's memory nor its 64 KB of code (PebbleOS's cap; a fix, #2174, would raise it) has room for as things stand.
2. **Code space.** 52–53 of 64 KB for each face (the plates, stations and relief heights are a resource, `native/resources/tables.bin`, read while a chart is built), and each KB of code is one less of heap for the build: the other views need room, which may mean trimming (shared helpers, fewer inlined copies) or moving work to the phone.
3. **A real watch and phone.** Everything so far runs in the emulator. The build's second in the emulator says little about the Pebble Time 2's CPU; the phone app's JavaScript engines on iOS and Android, and the store's limits for the `.pbw`, are unchecked.
4. **Quick View.** Timeline peeks cover the bottom of the screen; the face draws the whole frame regardless.
5. **Energy on a watch.** The emulator's instruction counts guide the work; current is measured only on a watch, as `docs/ENERGY.md` sets out. No battery claim is made until then.
