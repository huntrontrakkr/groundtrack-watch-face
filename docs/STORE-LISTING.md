# Pebble app-store listing: Groundtrack

Name: **Groundtrack**  
Type: **Watchface**  
Platform: **Pebble Time 2 / Emery**  
Source and support: https://github.com/huntrontrakkr/groundtrack-watch-face

## Published listing

https://apps.repebble.com/4cb497d2805d4b0b87d70876 (listing id `4cb497d2805d4b0b87d70876`), made on 2 October 2026 with version 0.1.0 by `tools/release.py create`, under the developer account Segfaultgolf..

Releases from the workflow publish to it once the repository variable `GROUNDTRACK_STORE_APP_ID` holds that id and the secret `PEBBLE_FIREBASE_REFRESH_TOKEN` the publishing sign-in (neither is set yet: until then a release is a GitHub release, and `GROUNDTRACK_STORE_APP_ID=4cb497d2805d4b0b87d70876 python tools/release.py publish` by hand, signed in with `pebble login`, publishes it). See [RELEASING.md](RELEASING.md).

## Description

Two faces in one, for the Sun, the Moon and any satellite.

Enroute is the hour as an aeronautical chart: the ground route across the map from this hour's compass rose to the next hour's reporting point, a mark every minute, the body on it. For the Sun, the Moon and the slower, higher satellites.

The Plotboard is mission control's wall: a band of the whole world with the tracking stations, the hour above it on a ruler, a sliding tape or a clock. A fast satellite's hour runs across it, or a slow one's whole day.

Follow one of 68 satellites (space stations, Starlink, navigation, weather, Earth observation, telescopes) or find any other at CelesTrak by name or number. The Sun and Moon can be marked beside it.

Contour relief, the continental shelf and the coastline come from public-domain elevation data, stored on the watch, and the calculated Sun brings the night across the map.

A home station gives the day's sunrise and sunset, or the satellite's next pass overhead. The margins carry the local date, Zulu time and the day of the year.

Twelve plates, from paper charts and airbrushed relief to blueprint blue, a dot-matrix wall, green or amber screens and 2001's HAL. Four sets of figures.

The watch draws each hour's chart itself and repaints only what moves each minute. The phone sends the Sun and Moon weeks ahead, and a satellite's orbit a few days ahead, so the face keeps going without it.

Requires Pebble Time 2. Satellite orbits come from CelesTrak through the phone. Your home's position stays on the phone and the watch. Not for navigation. Source code is on GitHub.
