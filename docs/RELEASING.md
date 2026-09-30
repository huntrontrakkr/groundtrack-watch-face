# Releasing the watch app

After Dymaxion's release process, with Groundtrack's own identity: the app's UUID is `a0f61ba3-4580-4bf9-a71c-0a83f3d35600`, and nothing of Dymaxion's listing or credentials is used.

## Every change

The *Release watch app* workflow (`.github/workflows/release.yml`) runs the tests, builds the watch app clean and packages it with `tools/release.py`:

- `python tools/release.py package` copies `native/build/native.pbw` to `release-artifacts/groundtrack-enroute.pbw`, deflated (every member stays byte-identical), with `SHA256SUMS` and the release notes.
- `python tools/release.py check` verifies the package: the UUID and version, an Emery-only watchface, the `configurable` and `location` capabilities (the settings page and the phone's position), resources within the store's 256 KB and the app within 64 KB, and a store description of at most 1,600 characters.

## A release

1. Write `releases/vX.Y.Z.md`, the notes for the store and GitHub.
2. `npm run release:prepare -- X.Y.Z` sets the version in `package.json`, `native/package.json` and the lockfile.
3. Commit and merge to main. The workflow tags the tested commit `vX.Y.Z`, publishes it to the Pebble store if a listing is set up, and makes a GitHub release with the `.pbw` and its checksum. (Pushing the tag by hand does the same.)

## The store listing

There is no listing yet. To publish to the Pebble store:

1. Create the listing in the Pebble developer dashboard, with the copy in [STORE-LISTING.md](STORE-LISTING.md).
2. Set the repository variable `GROUNDTRACK_STORE_APP_ID` to the listing's id.
3. Set the repository secret `PEBBLE_FIREBASE_REFRESH_TOKEN` to a refresh token for the account that owns it.

`tools/release.py publish` then checks the account owns the listing, refuses to replace a newer version, uploads the package (with any gallery in `docs/screenshots/store/emery_*`), and verifies the public version, the download's checksum and the listing's text. A rerun verifies instead of uploading twice. Run by hand, it uses `pebble login`.
