# Releasing the watch faces

After Dymaxion's release process, with Groundtrack's own identity. There are two faces, released together at one version: Groundtrack (`native/`, UUID `a0f61ba3-4580-4bf9-a71c-0a83f3d35600`: Enroute's charts and Plotboard's world band in one app) and Groundtrack Fuller (`native-fuller/`), each with the UUID in its `package.json`. Nothing of Dymaxion's listing or credentials is used.

## Every change

The *Release watch app* workflow (`.github/workflows/release.yml`) runs the tests, builds the watch app clean and packages it with `tools/release.py`:

- `python tools/release.py package` copies each face's build to `release-artifacts/groundtrack-enroute.pbw` (Groundtrack) and `groundtrack-fuller.pbw`, deflated (every member stays byte-identical), with `SHA256SUMS` and the release notes.
- `python tools/release.py check` verifies the package: the UUID and version, an Emery-only watchface, the `configurable` and `location` capabilities (the settings page and the phone's position), resources within the store's 256 KB and the app within 64 KB, and a store description of at most 1,600 characters.

## A release

1. Write `releases/vX.Y.Z.md`, the notes for the store and GitHub.
2. `npm run release:prepare -- X.Y.Z` sets the version in `package.json`, both faces' `package.json` and the lockfile.
3. Commit and merge to main. The workflow tags the tested commit `vX.Y.Z`, publishes it to the Pebble store if a listing is set up, and makes a GitHub release with the `.pbw` and its checksum. (Pushing the tag by hand does the same.)

## The store listing

Both faces are listed (Groundtrack `4cb497d2805d4b0b87d70876`, Groundtrack Fuller `7e96e11b99aa4f6fb3ba3928`; see the listings' pages), made as below on 2 October 2026 with version 0.1.0. A listing is public from the moment it exists. How a listing is made, signed in with `pebble login` as the account that will own it:

1. `python tools/release.py package` (or put a release's downloads in `release-artifacts/`), then `python tools/release.py create` makes each face's listing from the verified package: the copy in [STORE-LISTING.md](STORE-LISTING.md) (Groundtrack) and [STORE-LISTING-FULLER.md](STORE-LISTING-FULLER.md), the release notes, and the gallery in `docs/screenshots/store/<face>/` (drawn by the watch's own code: `node tools/render-store.mjs`). It goes through the Pebble tool's own publishing code, as `pebble publish` does, and prints each listing's id. Run with the Pebble tool's Python (`~/.local/share/uv/tools/pebble-tool/bin/python`).
2. Set the repository variables `GROUNDTRACK_STORE_APP_ID` and `GROUNDTRACK_FULLER_STORE_APP_ID` to the listings' ids (a face without one isn't published).
3. Set the repository secret `PEBBLE_FIREBASE_REFRESH_TOKEN` to a refresh token for the account that owns them, for releases from the workflow.

`tools/release.py publish` then checks the account owns the listing, refuses to replace a newer version, uploads the package (with any gallery in `docs/screenshots/store/<face>/emery_*`), and verifies the public version, the download's checksum and the listing's text. A rerun verifies instead of uploading twice. Run by hand, it uses `pebble login`.
