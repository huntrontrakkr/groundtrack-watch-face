# Energy plan and first measurement

This repository has no native watchface yet. There is **no measured mAh saving, runtime estimate, or claim that it uses less power than Dymaxion**. The useful result so far is a small, accuracy-tested trajectory representation.

## Divide the work

The phone can fetch orbital elements in a cached batch, run SGP4 for selected spacecraft, calculate Sun/Moon positions, and prepare time-stamped directions. These are different calculations; Sun and Moon must not use an artificial satellite model. The watch can interpolate the compact directions, project a few markers, and update once a minute.

Treat scheduling as a watch/phone protocol problem, not an assumption that a phone background timer runs forever. The watch requests data on launch, settings changes, or approaching the end of its valid cache. Use acknowledgement, coalescing, bounded retries, backoff, and reconnect recovery. Store the latest good data with its epoch and validity. If data expires, retain an honest clock and show a stale/absent orbit; do not freeze a satellite marker while implying it is current.

The cache must include the past/future margins used by the visible time scale. A six-hour refresh interval needs more than six hours of knots if the view shows ±90 minutes. Adjacent packets need overlap. Budget and test those details when implementing the real protocol.

## What was measured

Run `npm run measure`. Results are committed in `trajectory-measurements.json`.

- A packet has a 20-byte experimental header and six bytes per normalized XYZ knot (three signed int16 values).
- Reference positions are sampled every 15 seconds for one six-hour interval per body.
- Cached positions use normalized linear interpolation. This handles the longitude seam without jumping through longitude zero.
- The largest angular deviation times a 400-pixel radius bounds the **continuous orthographic position** error for those sampled instants. Pixel rounding can turn even a small difference into a one-pixel raster change. Label visibility near a horizon/edge needs a separate threshold test.

| Body | Knot spacing | Six-hour bytes | Largest sampled positional bound at 400px radius |
| --- | ---: | ---: | ---: |
| Sun | 10 minutes | 242 | 0.008 px |
| Moon | 10 minutes | 242 | 0.024 px |
| Historical ISS | 2 minutes | 1,106 | 0.098 px |

Combined: **1,590 bytes** for those three six-hour sample windows, including the three headers. Four such batches would be **6,360 bytes/day before window overlap, AppMessage framing, chunking, ACKs, retries, and metadata**. They will require multiple Bluetooth messages; this is not a count of radio transactions or energy used. Sun, Moon and ISS use their separately recorded demonstration epochs, not a shared operational observing session.

Five-minute ISS knots were less suitable at the same test scale: 0.581 px worst sampled bound. That is why the proposed interval depends on the body. Highly eccentric orbits, perigee motion, and other propagators need adaptive error checks before inclusion. Do not generalize the single ISS fixture to every satellite.

These are errors **relative to the chosen ephemeris model**, not truth. They exclude stale orbital elements, maneuvers, model errors, and geographic projection/atlas resolution. A future data packet also needs body identity, source epoch, expiry, settings generation, sequence number and integrity checking; the experiment is not the final transport format.

## Rendering budget to test on hardware

Start with `MINUTE_UNIT`, no repeating animation timer, no continuous sensor subscriptions, and no forced backlight. A minute schedule has 1,440 scheduled ticks/day versus 86,400 for one tick/second; that is a 98.3% reduction in this one kind of callback, **not a 98.3% battery saving**. [Pebble's guidance](https://developer.repebble.com/guides/best-practices/conserving-battery-life/) explicitly favors sleep time, infrequent Bluetooth activity, and conservative display updates.

For the default Sun/Moon landscape, the study holds the camera for 30 minutes and refreshes lighting in five-minute buckets. ISS camera buckets are ten minutes. Native cadence is still a choice to measure: camera steps have a visual cost, and rebuilding the map too frequently could dominate the face even with sparse network traffic.

The browser caches the map raster and the sampled track independently. A minute inside the same camera/shading interval reuses both. It still draws the preview canvas to present the composed result; this is not evidence of partial updates in the native display driver.

Use an indexed cached map bitmap and redraw only the old/new marker regions, changed labels and clock information where possible. Preserve the old-region restoration behavior through coastline, day/night, and overlapping-marker cases. Dymaxion showed why a single indexed bitmap can be substantially cheaper than hundreds of separate drawing calls.

Provisional memory arithmetic for a 200×176 map area:

- One 4-bit indexed map: 17,600 bytes, plus palette and row-stride overhead.
- One 1-bit material/mask plane: 4,400 bytes.
- Selected six-hour trajectories: 1,590 bytes in the current sample, plus indexing/metadata.
- Full 1440×720 one-bit land atlas: **129,600 bytes**. It belongs in flash resources with row/tile reads or a smaller streamed cache, not RAM.

This is arithmetic, not measured native allocation. CPU projection costs, palette cardinality, SDK alignment, font data, code size, resource reads and peak temporary allocations still need accounting. The browser currently uses a full atlas in memory and per-pixel floating-point work on a rebuild, which is acceptable for a study but is not the native design.

## Native spike acceptance checks

1. Compile a separate Pebble app with its own UUID, resources and minute subscription. Preserve current app data; no inherited Dymaxion store identity.
2. Replay a day of minute updates for each camera mode; count map rebuilds, changed rows/pixels, drawing calls and peak heap. Include Quick View/obscured layouts and resume from sleep.
3. Compare static-map baseline, moving marker, scheduled camera, and day/night separately. Use emulator instruction profiles as CPU proxies, not electrical measurements.
4. Exercise interpolation and clipping through dateline, poles, horizons, midnight, DST and crossing tracks. Use geographically diverse real orbit fixtures and fresh-vs-stale metadata.
5. Simulate phone disconnects, missing packets, repeated ACK failure, and stale/expired elements. Count actual bytes and message sessions.
6. Then run a multi-day device comparison under similar backlight, notification and activity conditions. Only that can support a useful battery-runtime claim.

Terrain, cast shadows, continuous camera movement and additional detailed tracks stay behind this measurement gate. A subtle face that sleeps between minutes is the design target.

## Study 02: sculpted hour towers

The new default page uses an hour-fixed **perspective** camera. Geographic inverse rays, the land mask, glyph planes, and visible tower surface fragments are cached. The selected minute supplies the actual solar vector, ground shading, and complete tower shadows. A map-relative compass uses geographic projection and needs no physical heading sensor. There is no idle render loop.

The browser's shadow-volume rasterizer and lighting pass add work. They have not been profiled as native code; the original storage/interpolation measurements are not battery measurements for this renderer. In particular, the 400px orthographic error bound above is not a bound for the closer perspective camera. A native spike should measure changed pixels/rows, shadow-cache error, minute-update CPU cost, peak allocations, and hourly rebuild cost before choosing a lighting cadence or promising runtime.

Numeral heights are artistic exaggerations, rounded roofs use a stylized normal treatment, and there is no real elevation dataset. Terrain self-shadowing remains a later, separately budgeted feature. See [study 02](STUDY-02.md) for the visual and lighting decisions.

## Study 03: repeated Fuller atlas

The focused atlas is fixed between the current civil hour and the next one.
Geographic directions, land bits, primary track samples, city placements and
numeral meshes are cached for that window. Palette proofs share the geometry.
A minute change recomputes solar lighting/shadows and reading marks; an identical
scene request returns without drawing. There are no idle timers or sensors.

The nonlinear inverse is used only when building the geographic raster. A
native implementation should generate a packed per-pixel face/coordinate lookup
outside its ordinary minute draw, and bound the shadow working set. The browser
prototype's arrays, triangle search and multiple preview canvases are not a
proposed watch memory layout. The inset and full shadow raster also require
native profiling. No electrical saving, native RAM budget or frame-time promise
has been measured for this study. Restricting the view to two hour stations and
keeping broad fields solid improves legibility; it does not itself prove energy
savings on a memory LCD.
