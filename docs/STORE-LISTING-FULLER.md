# Pebble app-store listing: Groundtrack Fuller

Name: **Groundtrack Fuller**  
Type: **Watchface**  
Platform: **Pebble Time 2 / Emery**  
Source and support: https://github.com/huntrontrakkr/groundtrack-watch-face

## Published listing

https://apps.repebble.com/7e96e11b99aa4f6fb3ba3928 (listing id `7e96e11b99aa4f6fb3ba3928`), made on 2 October 2026 with version 0.1.0 by `tools/release.py create`, under the developer account Segfaultgolf..

Releases from the workflow publish to it once the repository variable `GROUNDTRACK_FULLER_STORE_APP_ID` holds that id and the secret `PEBBLE_FIREBASE_REFRESH_TOKEN` the publishing sign-in (neither is set yet: until then a release is a GitHub release, and `GROUNDTRACK_FULLER_STORE_APP_ID=7e96e11b99aa4f6fb3ba3928 python tools/release.py publish` by hand, signed in with `pebble login`, publishes it). See [RELEASING.md](RELEASING.md).

## Description

The Earth unfolded as Buckminster Fuller unfolded it, rolled along the route. The icosahedron rolls across the watch face face by face under the Sun, the Moon, the International Space Station, Tiangong, Hubble, Landsat 9, NOAA-20, GPS or QZSS, printing each face as it touches down, so the route never meets a cut: a satellite's hour unrolls into a band of faces, the Sun's and the Moon's day into a strip across the whole net.

The hour is set along the route as on an aeronautical chart: a compass rose turned to true north, the next hour's reporting point, minute graduations and the hour's figures. The tracking stations that can hear the satellite this hour are marked with their circles, and home has its own.

Contour relief, the continental shelf and the coastline come from public-domain elevation data, pre-projected onto every face of the icosahedron and stored on the watch, and the calculated Sun brings the night across the net. Twelve plates, from paper charts and airbrushed relief to blueprint blue, a dot-matrix wall, green or amber screens and 2001's HAL; a minute flag or a time callout; events on the route as reporting points.

Orbits come from CelesTrak through the phone, a few days ahead, so the face keeps going without it. Requires Pebble Time 2. Not for navigation. Source code is on GitHub.
