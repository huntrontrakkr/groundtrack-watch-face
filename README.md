# Groundtrack

**A little landscape that tells time.** Two hour numerals rise from the Earth like towers. A body's ground track runs upward between them, with five-minute marks and a small current-minute marker. The actual Sun lights the scene and casts the towers' shadows; a tiny map compass keeps the rotated landscape oriented.

An independent Pebble Time 2 concept, following the pixel-rendering and battery work in [Dymaxion](https://github.com/huntrontrakkr/dymaxion-watch-face). Groundtrack is a working title. This repository currently contains **browser design studies and a trajectory-cache experiment**, not an installable watchface.

![Sculpted and inlaid watchface studies](docs/screenshots/study-02-contact-sheet.png)

## Try the studies

Use Node 22.12 or newer:

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. **Study 02** is the default: sculpted or inlaid numerals, three materials, three camera angles, Sun or Moon tracks, and dated afternoon/sunset/night observations. Scrub through the selected civil hour. Optional stipple, a map compass, 24-hour numerals, and a small full-time readout let us compare readability. No location request or motion sensor is used.

**Study 01** remains at `/study-01.html`: a broader orbital exploration with Sun, Moon, and an archived ISS orbit; landscape, oblique, and globe views; three palettes; home/city marks; and a second independently calculated Sun/Moon marker. Home is an explicit Norfolk example. Both studies remain frozen until you interact.

Read [the sculptural design notes](docs/STUDY-02.md), [the first study's research](docs/DESIGN.md), and [the battery architecture](docs/ENERGY.md).

## Data and light

Sun and Moon positions use Astronomy Engine. In study 02 the same calculated Sun supplies the only directional lighting. Towers cast shadows as volumes onto a spherical Earth; ambient display tones keep the night side readable. The structures are deliberately exaggerated artwork. Coastlines are real map data, but they contain no terrain elevations. The compass indicates geographic north within the map, not the wearer's magnetic heading.

ISS uses Satellite.js with its published June 5, 2019 example TLE, is labeled `ARCHIVE`, and refuses to extrapolate more than a day from that epoch. There is no live satellite catalog or background network polling yet. The close hour-to-hour sculptural view is currently for the Sun and Moon; a fast satellite needs a different time-window treatment.

## Verification and measurement

```sh
npm test
npm run measure
npx playwright install chromium
npm run test:browser
npm run build
```

On Linux, Playwright may also need `npx playwright install-deps chromium`. Browser tests start and stop their own servers; `GROUNDTRACK_URL` can point them at an existing dev or production preview. CI checks both pages and produces a downloadable static preview. It does not publish a watchface.

Tests cover projection and horizon behavior, time-zone transitions, compass direction, sunlight and volume shadows, 153 rendering combinations across both studies, all 24 hour numerals, RGB222 pixels, cache reuse, controls, and 320/390-pixel mobile layouts.

The initial six-hour trajectory-cache experiment uses **1,106 bytes** for two-minute ISS knots and **242 bytes each** for ten-minute Sun/Moon knots. The largest sampled extra interpolation/quantization error was **0.098 pixel at a 400-pixel orthographic globe radius**. This is neither total orbital accuracy nor a bound for the new perspective camera. See [the recorded measurements](docs/trajectory-measurements.json).

Study 02 caches geography and tower geometry within an hour, then uses the selected minute for solar lighting and shadows. It performs no idle redraws. Native CPU cost, memory use, and electrical battery savings have **not** been measured. The larger shadows need profiling before being part of an installable face.

## Repository map

| Location | Purpose |
| --- | --- |
| `src/art-camera.js` | Track-aligned perspective and geographic north |
| `src/art-light.js` | Solar rays and solid-numeral shadow intersections |
| `src/art-render.js` | Native-pixel sculptural rendering and geometry caches |
| `src/ephemeris.js` | Sun/Moon astronomy and bounded historical ISS propagation |
| `src/render.js` | Original orbital study and shared bitmap utilities |
| `src/trajectory.js` | Packed trajectory experiment with expiry handling |
| `tools/` | Reproducible land, dither, font, and trajectory generators |
| `docs/` | Research, architecture, measurements, and visual proofs |

The quarter-degree land atlas is a 129,600-byte flash/resource candidate; a native port must not load it wholesale into watch RAM. No Dymaxion app identity, credentials, or store release workflow is reused.

Project code: Apache-2.0. Natural Earth: public domain. Fira Sans and its derived numeral masks: SIL OFL 1.1. Other dependency and reused Dymaxion notices are in [NOTICE](NOTICE).
