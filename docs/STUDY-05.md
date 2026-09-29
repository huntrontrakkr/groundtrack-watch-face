# Study 05 — Chart

A salvage pass over studies 01–04. It keeps the idea and the engineering, and drops the rendering the display could not carry. The result is flat and north-up, with two hours and the route between them, drawn only in the display's own colors.

![Study 05 proofs at native size](screenshots/study-05-contact-sheet.png)

## What carried over

- **The clock.** The current hour, the next hour and the ground route between them, with a marker at the present minute. This was the strongest idea in studies 02–04 and it is unchanged.
- **The sky.** Sun and Moon from Astronomy Engine. The bounded 2019 ISS archive from Satellite.js, with its refusal to extrapolate. The trajectory-cache measurements.
- **Civil hours.** Stations fall on the hour in any time zone, including half- and quarter-hour offsets.
- **Geography.** The same quarter-degree Natural Earth atlas. It is now sampled bilinearly (four samples per pixel, majority kept), so stair-stepped cells become smooth shorelines without adding detail. A test checks that the smoothed land matches the atlas to within 2% in every view.
- **Discipline.** Opaque RGB222 pixels only, fixed patterns, caches keyed to the hour and the minute, and no idle redraws.
- **The one Sun.** The calculated Sun still decides day, civil twilight and night at the selected minute, and casts the current hour's shadow.
- **Palettes.** Survey is Study 01's olive and deep-teal chart. Shore is the concept painting's bone, sea glass and vermilion, flattened into native colors. Nocturne is a dark variant.

## What was cut, and why

- **Extruded numeral monuments** (studies 02–04). At about 60 pixels tall in 64 colors, the walls and rounded roofs render as one- to three-pixel colored fringes. The numerals read as misregistered, not sculpted. A flat shadow gives the same sense of a raised figure for a fraction of the pixels.
- **Color mixing across whole fields** (Study 04). Screened land and water turn into speckle at arm's length, which a reflective screen will make more visible. Fields are now flat. Only the civil-twilight band uses a fixed ordered screen, where the texture has a meaning.
- **The rotated Fuller atlas** (studies 03–04). Turning the map so the route runs upward made coastlines unrecognizable, and icosahedral cuts added marks that needed a legend. North stays up here, so Somalia, Madagascar or Western Australia read at a glance.
- **Perspective camera, compass, city labels and home markers.** None is needed to read the time. They are deferred, not rejected.

## Reading the face

- **Map.** A north-up equidistant cylindrical view. For the Sun and Moon, the hour's two stations sit 128 pixels apart on a line 150 pixels down, about 8.5 pixels per degree. Both bodies travel west, so time runs right to left and the next hour is on the left.
- **Hours.** The current hour is solid and the next hour is a two-pixel inline, each set above its station. The figures are Fira Sans Medium, thresholded at half coverage to whole pixels. Two-digit hours step down a size, and the pair spreads apart rather than colliding.
- **Route.** Elapsed time is a bold line and the rest of the hour a fine one. Beyond the stations it becomes a sparse dotted line. Ticks mark five minutes, with longer ticks at the quarters. Stations are transit stops: this hour's filled, the next open.
- **Present.** The marker is the body itself: a Sun with eight rays, the Moon in its calculated phase, or a small station for the ISS. The minute is set in the Dymaxion pixel figures, placed where it clears the route and numerals. Marks knock out the linework beneath them instead of adding a halo color.
- **Coast.** A one-pixel sea-side outline and a single offshore waterline, as on an engraved chart. These are graphic devices, not measured depth.
- **Light.** Flat day, civil-twilight and night zones from the Sun at the minute. Through twilight, a fixed 4×4 screen moves from the dusk color to the night color. The current hour casts a flat shadow from a notional three-pixel height, at most four pixels long, pointing away from the Sun. Near the subsolar point it is effectively zero. At night there is none.
- **ISS.** The station travels about 240° of longitude in an hour, so a regional map cannot hold both stations. It gets a world band from 60°S to 72°N at the bottom of the screen, with the two hours set above it.

## Open questions

- **Direction.** Right-to-left progress is true to the sky but unfamiliar on a clock. A mirrored map would read left to right, but it would no longer be the Earth. This needs testing with people, not only argument.
- **Open ocean.** The Sun spends many hours over the Pacific. The face then shows numerals on water with a few islands. This is honest and quiet, but sparse.
- **The ISS composition** differs from the Sun and Moon faces, and its "hour" is two-thirds of an orbit. It may deserve its own face rather than a mode.
- **Real screen.** Pale fields (bone, celeste) and the twilight screen must be checked on the reflective display under daylight and backlight before a palette is chosen.
- **Native cost has not been measured.** A plausible watch layout is a per-hour material mask (2 bits per pixel, about 11 KB) and a per-minute light pass, with colors drawn from a small [light][material] table. A new hour takes about 85 ms and a new minute about 13 ms in Node on a desktop CPU. These numbers are not watch estimates, and no battery claim is made.

## Verification

```sh
npm test                      # includes tests/chart.test.mjs
node tests/chart-browser.mjs  # part of npm run test:browser
npm run proofs                # regenerates the study-05 PNGs without a browser
```

Unit tests cover native RGB222 output in every palette and view, north-up geometry and station spacing, atlas fidelity after smoothing, hour numerals for all 24 hours in both clock formats, numeral clearance from the route, marker progress through every minute, minute-label placement, half-hour time zones, light zones against the solar altitude, fixed twilight patterns, shadow direction, the ISS world band and cache reuse. The browser check confirms that the page shows the renderer's exact pixels in 18 combinations. It also checks the controls, moonlight, clock zones, zero idle redraws, and 320- and 390-pixel layouts.

Earlier studies remain available at `/study-04.html`, `/study-03.html`, `/study-02.html` and `/study-01.html`, with their own tests.
