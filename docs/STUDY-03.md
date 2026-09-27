# Study 03 — the unfolded hour

The composition contains **the current hour and the next hour**, not an entire orbit overview. Larger numeral towers sit beside those two stations, away from the route. Five-minute crossbars and the current minute do the reading. A small conventional world inset, an example home and at most two nearby major-city labels supply context.

This is an exploratory browser renderer. It is not a native Pebble face or an energy benchmark.

## Fuller geometry and truthful cuts

The face transform in `src/fuller.js` adapts [Philippe Rivière's public-domain implementation](https://observablehq.com/@fil/buckminster-fullers-triangle-transformation) of Robert W. Gray's 1995 exact Fuller equations. The former Dymaxion project's within-face transform was gnomonic; this one is nonlinear Gray–Fuller. Its inverse uses an analytic Jacobian and bounded Newton iteration. Gray's rounded vertex orientation is regularized to a true regular icosahedron using the first vertex and its first neighbor as an orthonormal frame. It retains the original geographic orientation to the precision of the published coordinates.

Background: [Gray's papers and description](https://rwgrayprojects.com/rbfnotes/maps/graymap1.html). No code from Gray's separately restricted implementation is incorporated.

The layout is a new repeated atlas, **not the canonical Airocean net**. Each equilateral tile carries one of the 20 actual geographic faces. Adjacent faces unfold by reflection. Five faces meet around an icosahedral vertex, whereas six equilateral triangles meet on a plane; some joins must therefore be cuts. The renderer explicitly records incompatible edges. Solid triangle edges show these cuts, and paired letters identify interruptions of the primary path. No segment is drawn across an incompatible join. Optional sparse fold marks describe continuous joins.

The tessellation is conceptually extendable but only a bounded patch is generated. Its geographic pixel lookup is cached for the displayed civil hour. Labels, shadows, lights and paths use the same face placement. Repeated geographic copies are intentional. The compass points north at the body's current position, not magnetic north or a universal direction across all tiles.

## Solid fields; stipple at transitions

Each theme uses exactly two opaque RGB222 colors. Ocean fields are solid dark ink; day-side land is solid light ink. Stippling is confined to the narrow terminator band, a one-pixel feather around cast-shadow boundaries, and transitions in the curved tower walls. There is no ambient speckle over flat fields and no temporal dithering.

The towers reuse Study 02's bitmap masks and solid extrusion geometry. Light direction and spherical volume-shadow intersections still come from the actual Sun at the selected minute. The shadow result is then mapped through Fuller faces. A local relief camera displays the exaggerated height; these are artistic monuments, not plausible buildings or a terrain elevation model.

Clock lettering takes priority over literal surface rendering: roofs choose a contrasting ink, a narrow roof rim separates them from coastlines, and enclosed counters remain visible instead of filling with a bright rear wall. Those legibility treatments and the pixel penumbra are illustrative. They do not change the solar direction or introduce a fictional second light.

## Geographic context and dates

The 243-place catalog is derived from [Natural Earth's 1:110m populated places](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_populated_places.geojson), public-domain data. Names are prioritized by spherical proximity to the current body location, subject to actual on-screen availability and label collisions. Night lights are limited to 15 major-city copies so they remain distinct from shading. They are symbolic lights, not measured luminosity or up-to-date population estimates.

Home is an explicitly selected Norfolk/London/Tokyo/Sydney example. No GPS lookup occurs. The world inset shows the body as a filled dot and home as a ring, including when home lies outside this hour's map.

Sun/Moon positions and lighting use Astronomy Engine. ISS retains the bounded June 5, 2019 Satellite.js fixture and is visibly labeled ARCHIVE. A secondary Sun/Moon path is independently sampled at the **same dates**. No current ISS accuracy is claimed.

## Update strategy and verification

Geometry and tower masks are rebuilt when the civil hour, body, zone or numeral format changes. Minute scrubbing updates lighting, shadows and the current marker. Palette proofs share geography and tower geometry. Identical scene requests do not draw again; there is no animation timer, polling, geolocation or sensor subscription.

This JavaScript study retains floating-point arrays and object graphs for convenient experimentation. A watch port will require precomputed/packed geographic lookup tables, bounded memory, clipped shadow updates and real emulator/device profiling. Neither the earlier orthographic interpolation bound nor browser rendering speed establishes battery savings or an error bound at this new zoom.

Tests cover spherical forward/inverse mapping, geographic agreement across all genuine neighbor joins, explicit discontinuities, viewport coverage, solid-field shading, glyph counters, exact two-color output, two-hour-station framing, route/numeral separation, time-zone controls, cache reuse, no idle redraws, and mobile layouts. Prior studies remain available and are tested as well.
