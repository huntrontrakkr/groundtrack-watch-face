# Pebble app-store listing: Groundtrack (draft)

Name: **Groundtrack**  
Type: **Watchface**  
Platform: **Pebble Time 2 / Emery**  
Source and support: https://github.com/huntrontrakkr/groundtrack-watch-face

## Published listing

None yet. Once the listing exists in the Pebble developer dashboard, its id goes in the repository variable `GROUNDTRACK_STORE_APP_ID` and the publishing sign-in in the secret `PEBBLE_FIREBASE_REFRESH_TOKEN`; releases then publish to it (see [RELEASING.md](RELEASING.md)). Until then a release is a GitHub release only.

## Description

The hour as an aeronautical chart. The ground route of the Sun, the Moon, a GPS satellite or Japan's QZSS runs across the map in magenta, from this hour's compass rose to the next hour's reporting point, graduated like a ruler a mark every minute. The body stands on the route at the minute.

Choose the International Space Station, Tiangong, Hubble, Landsat 9 or NOAA-20 and the chart becomes mission control's plotboard: the orbit across a band of the whole world, each tracking station with the circle within which it could hear a low orbit, and the hour on an instrument tape above. The tape can be a fixed ruler with a moving pointer, a tape that runs past a still pointer, the tape with the world scrolling under it, or simply a clock.

Contour relief, the continental shelf and the coastline come from public-domain elevation data, stored on the watch. Mercury and Apollo tracking stations mark the map, and the calculated Sun brings the night across it.

A home station gives the day's sunrise and sunset, or the satellite's next pass overhead. The margins carry the local date, Zulu time and the day of the year.

Twelve plates: Enroute, Sectional, Console, Hypsometric, Night red, Green CRT, Sunlight, Blueprint, Amber, Airbrush (shaded relief), Dot matrix and Odyssey (a dark Earth with the dawn on its rim, and the Sun as HAL's eye).

The watch draws each hour's chart itself and repaints only what moves each minute. The phone sends the Sun and Moon weeks ahead, and a satellite's orbit a few days ahead, so the face keeps going without it.

Requires Pebble Time 2. Satellite orbits come from CelesTrak through the phone. Your home's position stays on the phone and the watch. Not for navigation. Source code is on GitHub.
