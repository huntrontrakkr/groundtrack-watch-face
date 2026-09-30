# Native: Groundtrack Enroute on the watch

The first step from the browser studies toward an installable Pebble Time 2 watchface. It covers the Enroute face on the hour chart: the Sun, the Moon and slow orbits such as GPS, on every plate, with the minute flag. `native/` is a Pebble SDK project. Its drawing core is portable C, checked pixel for pixel against the browser renderer in this repository's tests.

## How the work is split

The expensive parts of the face hold still for an hour, and only a few pixels change each minute. So the work is split between phone and watch.

- **Phone, once an hour:** renders the hour's chart with the browser renderer in a *base* mode that leaves out everything that changes by the minute. The result is a **class plane**. For each pixel it holds the ground beneath (water, land, a height tint, space) in the low nibble, and what was drawn over it (contour, coast, shelf, grid, route, ink, mark, or a paper knockout) in the high nibble. The phone sends it with the hour's per-minute data (`tools/export-scene.mjs` writes the format):
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

## What is verified

`tests/native.test.mjs` exports hours with the browser renderer, draws them with the C core on the host, and compares frames:

| Hours | Result |
|---|---|
| Sun over the Indian Ocean (Enroute, Sectional, Plotboard, Hypsometric, Night red, Green CRT, Sunlight) | Pixel-exact at every minute tried |
| Moon at nightfall, night across the chart (Enroute, Sectional, Hypsometric, Night red, Green CRT, Sunlight), with the minute flag | Pixel-exact |
| GPS (Green CRT) with the flag and a changing pass line | Pixel-exact |
| Moon at nightfall and GPS on **Plotboard** | 9–29 pixels differ per frame (≤0.1%) |

The Plotboard difference is a deliberate simplification. Plotboard's inks change with night, and the browser colours a symbol by the zone at its anchor point (a station's centre, a figure's corner), while the C core colours each pixel by the zone under it. They disagree only where a symbol straddles the terminator. On the other plates the inks don't change with night, so the two agree.

The watch app (`native/src/c/main.c`) is type-checked against a stand-in `pebble.h` (`native/host/stub/`) that declares the SDK calls it uses. That catches typos and type errors, but it isn't the SDK; see below.

## Measured so far

These are measurements of the code and data, not of a watch.

| | |
|---|---|
| Core code and read-only data, Cortex-M4, `-Os` | 6.7 KB (float build) |
| Core static buffers | 4.7 KB |
| Scene per hour, as sent | 26–31 KB (the class plane as row runs: 10.7–15.8 KB instead of 45.6 KB) |
| Scene parsed on the watch (float build) | 6.9 KB, plus the track (about 2.3 KB); the class plane stays in the received scene |
| Bluetooth per hour | one scene, about 15 messages of 2,000 bytes |
| Single- vs double-precision night | at most 1 pixel per frame differs, so the watch can use its single-precision FPU |
| Host CPU time per minute (x86, a proxy only) | 0.6–0.9 ms; 2.5 ms with a drawn terminator (Green CRT, Night red) |

The terminator's cost comes from testing each pixel's neighbours; a row cache of sun-dot values would remove most of it.

## Building

The Pebble SDK comes from `sdk.repebble.com`, which the development environment used so far could not reach. Once it can:

```sh
uv tool install pebble-tool        # or pipx
pebble sdk install latest
cd native
pebble build                       # builds build/native.pbw for emery (Pebble Time 2)
pebble install --emulator emery
```

The phone side (`native/src/pkjs/index.js`) fetches the current hour's scene from a scene server and sends it to the watch in 2,000-byte chunks: on launch, and when the watch asks for a new hour. For development, run the server next to the emulator:

```sh
node tools/scene-server.mjs 5199   # GET /scene?body=sun&plate=enroute&flag=1&zone=America/New_York
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

1. **The SDK build and the emulator.** Build the `.pbw`, run it in the `emery` emulator, and check that the frame buffer and AppMessage behave as `main.c` assumes. `emery` is the Pebble Time 2 platform name as understood here; confirm it against the SDK.
2. **Memory.** The float build needs roughly 26–31 KB for the scene, about 9 KB parsed, 4.7 KB static and about 7 KB of code, so about 45–52 KB in all. The Pebble Time 2's app memory limit hasn't been checked. If it's tight, the scene's header tables could be dropped after parsing, or the phone could send deflated scenes.
3. **The renderer on the phone.** Scenes come from a scene server for now. Next is to bundle the renderer into the phone's JavaScript and fetch the relief and coastline data it needs, cached on the phone.
4. **Batching.** Send the next few hours in one session to cut the number of radio sessions a day, and keep the current scene in persistent storage across restarts.
5. **Not yet native:**
   - the world band (fast satellites) and its tape
   - Rolling Fuller
   - the whole-day chart (QZSS)
   - the time callout
   - events (whose labels give way to the minute flag, so they change by the minute)
   - Plotboard's per-anchor zones
6. **Energy.** Profile a day of minute updates in the emulator: instructions per minute, changed rows and peak heap. Then measure on a watch, as `docs/ENERGY.md` sets out. No battery claim is made until then.
