### Instructions executed in the emulator

| | before | after |
|---|---:|---:|
| Idle nine seconds (background) | 6,535,694 | 5,127,741 (21.5%) |
| A minute change, over idle | 24,248,002 | 5,769,882 (76.2%) |
| Building the hour's chart, over idle | 116,357,418 | 116,925,506 (-0.5%) |
| A day: 1,440 minute changes and 24 builds | 37,709,700,912 | 11,114,842,224 (70.5%) |
| Of a minute change: app code | 25,475,209 | 3,847,414 (84.9%) |
| Of a build: app code | 121,943,788 | 120,145,556 (1.5%) |
| Of a minute change: firmware | -1,225,885 | 1,922,468 (256.8%) |
| Of a build: firmware | -4,608,379 | -3,229,487 (29.9%) |

Medians of 12 (before), 12 (after) windows (nine seconds; ten for builds), all builds in one emulator in turn; each minute or build window is measured against the idle window of the same install. Percentages are the reduction from before. Every executed block is counted, firmware included (drawing, flash reads, display driver); app code is code running from RAM. Blocks without a translation: 0; addresses translated with different lengths: 825. These are instruction counts, not current: flash, display and radio energy are not modelled.

#### Minute windows: firmware code pages that differ most, after against before

| Page | before | after | difference |
|---|---:|---:|---:|
| 0x8e000 | 2,693,790 | 3,778,742 | +1,084,952 |
| 0x1000 | 333,902 | 276,542 | -57,359 |
| 0x8f000 | 501,302 | 539,799 | +38,497 |
| 0xbc000 | 44,741 | 20,528 | -24,213 |
| 0xc4000 | 139,861 | 160,920 | +21,060 |
| 0x99000 | 0 | 19,028 | +19,028 |
| 0x2d000 | 12,315 | 0 | -12,315 |
| 0x2a000 | 8,677 | 147 | -8,530 |
| 0x8d000 | 184,988 | 191,055 | +6,067 |
| 0x1b000 | 46,823 | 51,303 | +4,480 |
