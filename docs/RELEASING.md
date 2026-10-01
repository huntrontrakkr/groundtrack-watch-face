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

There are no listings yet. To publish to the Pebble store:

1. Create each face's listing in the Pebble developer dashboard, with the copy in [STORE-LISTING.md](STORE-LISTING.md) (Groundtrack) and [STORE-LISTING-FULLER.md](STORE-LISTING-FULLER.md).
2. Set the repository variables `GROUNDTRACK_STORE_APP_ID` and `GROUNDTRACK_FULLER_STORE_APP_ID` to the listings' ids (a face without one isn't published).
3. Set the repository secret `PEBBLE_FIREBASE_REFRESH_TOKEN` to a refresh token for the account that owns it.

`tools/release.py publish` then checks the account owns the listing, refuses to replace a newer version, uploads the package (with any gallery in `docs/screenshots/store/<face>/emery_*`), and verifies the public version, the download's checksum and the listing's text. A rerun verifies instead of uploading twice. Run by hand, it uses `pebble login`.
