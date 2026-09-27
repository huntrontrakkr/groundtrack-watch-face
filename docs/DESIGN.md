# Groundtrack / study 01

## The central idea

The Earth is the dial and the trajectory is the clock's scale. A mark labeled 14 is the body's predicted ground point at 14:00 in the user's chosen time zone. The current marker identifies the current minute on that scale. A small exact-time callout makes it usable before the eye learns the spatial clock. Longitude does not select a new time zone.

The first interpretation is a camera that follows a **section of the track**, then holds there while the marker progresses. The landscape does not scroll continuously. This preserves geographic context, keeps the dither still, and gives cached drawing a chance to matter. A continuously body-centered camera is a possible comparison later, but makes every minute a map change.

This is a visual study. It does not fix the final name, typography, colors, or navigation. The current letterforms reuse the small Dymaxion Draft bitmap font so that we can concentrate on the new time-reading idea.

## Three views

| Study | Good at | Limitation |
| --- | --- | --- |
| Landscape | Large geographic forms and separated hour marks | At this zoom Earth's outer silhouette usually lies outside the screen |
| Oblique | A sense of looking across a curved surface | Orthographic foreshortening crowds the far side; this is not a terrain-height renderer |
| Orbital | Hemisphere context and fast spacecraft | The far side of the orbit is genuinely hidden |

All three use a spherical orthographic projection with a different camera center, scale, and roll. They are not a flattened world map distorted afterwards. The same transform places coastlines, track samples, and markers. A full perspective/altitude camera can be compared later if the orthographic study is too flat.

The [ISS takes roughly 90 minutes to orbit](https://esrs.jsc.nasa.gov/Tools/orbitTutorial.htm). An hour or two of its track cannot simultaneously fit in a small, geographically accurate local patch. A globe therefore offers a shorter visible interval, with quarter-hour labels. A future unwrapped route atlas could show an entire orbit, at the cost of the globe silhouette. Do not pretend unseen hour labels are visible through the Earth.

Sun and Moon ground points move on a daily timescale as Earth rotates, so a closer window works. They are calculated from celestial positions, not by applying satellite TLE propagation to them. Near-geostationary satellites scarcely move over the ground and should be secondary markers, not the only time scale. Other slow/repeating/self-crossing paths need a clear current-time callout and sensible window length.

## Keep the hierarchy simple

1. One primary track, one body marker, and one exact-time callout.
2. Hour marks first; five-minute divisions next; one-minute ticks only where separated by at least two pixels.
3. Up to two independent secondary markers as an initial native target. Extra full tracks should be an explicit option after a collision study.
4. Home and a few city labels, with lower placement priority than time.

An eventual large searchable satellite catalog belongs in phone settings. Favor NORAD identifiers and OMM-compatible elements, not an unbounded list of active renderers on the watch. [CelesTrak's current formats](https://www.celestrak.org/NORAD/documentation/gp-data-formats.php) address the growing catalog-number range; [its usage policy](https://www.celestrak.org/usage-policy.php) requires deliberate caching and restrained fetching. Batch selected objects and share/cache catalog downloads. No per-minute network requests.

The prototype's second-body option only chooses between the Sun and Moon. Its position is independently calculated at the same instant. It can be below the globe's horizon or outside the current map, particularly near full Moon. This is a geographic fact, not an invitation to draw it in a false location. A future edge-direction indicator should distinguish out-of-frame from below-horizon.

## Dither and relief

The game reference is **Return of the Obra Dinn**. [Lucas Pope's own development log](https://dukope.com/devlogs/obra-dinn/tig-32/) describes threshold patterns, motion instability, and experiments tying texture to camera/world orientation. The lesson for this watch is stability and restraint. We do not need its full rendering pipeline to draw a watch-sized map.

The study compares solid RGB222 tones, ordered 4×4 thresholds, and an original 32×32 periodic void-and-cluster stipple. Patterns are fixed in screen pixels while the camera is stationary. There is no frame-random seed and no dither over labels. A discrete camera change can still retexture features; this is not a claim of perfectly surface-locked dithering during rotation. Before introducing animated camera motion, compare temporal stability at native size.

The monochrome theme is truly two colors. There are no gray antialiased edges hidden in the export. Compare both magnified and 1:1 views; something that looks elaborate at 4× can become mud on the wrist.

Natural Earth's land layer supplies **coastlines, not terrain**. Elevation contours should later come from a real DEM with explicit scale and attribution. Restrict them to selected zoom levels and a few useful elevations. Hillshade can use local surface normals; cast terrain shadows additionally require occlusion calculations. They should be a phone/offline or infrequent update experiment. No procedural mountains are included in this geography study.

The Moon glyph uses its calculated illuminated fraction and waxing/waning direction. It is a symbolic north-up phase view. Correct orientation against the observer's horizon, lunar surface texture/libration, and a globe-of-the-Moon mode are separate features. They are not implemented by the current small phase disk.

## Prototype data and sources

- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public-domain 1:50m land, rasterized through world-atlas 2.0.2 at quarter-degree centers. This is not high-resolution local terrain.
- [Astronomy Engine](https://github.com/cosinekitty/astronomy), pinned 2.1.19. Equatorial-of-date body direction is rotated into Earth longitude using sidereal time. Ground coordinates use a spherical Earth, appropriate to this visual study's scale.
- [Satellite.js](https://github.com/shashwatak/satellite-js), pinned 7.1.0, SGP4 and TEME-to-geodetic conversion. Historical ISS example from its README; no current telemetry is implied.
- [CelesTrak's SGP4 guidance](https://www.celestrak.org/software/tutorials/sgp4.php), explaining why GP elements need their matching propagator.
- [Pebble hardware information](https://developer.repebble.com/guides/tools-and-resources/hardware-information/) and [battery guidance](https://developer.repebble.com/guides/best-practices/conserving-battery-life/), informing the target and update discipline.

## Next decision

First decide whether the close landscape or the oblique view makes the time scale easiest to understand. Then test it as a native minute-only face, with one primary object and a small preloaded trajectory. Add live phone data and expiry behavior before a large catalog. Terrain and additional tracks follow evidence from that build, not a speculative feature count.
