#!/usr/bin/env python3
"""Package, check and publish one version of the watch faces (after Dymaxion's).

Two faces are built from one source: Groundtrack Enroute (native/) and
Groundtrack Plotboard (native-plotboard/). Each command takes --face (enroute,
plotboard or all; all by default).

package  copies each face's .pbw to release-artifacts/, deflated, every member
         byte for byte, with SHA256SUMS and the release notes
check    verifies the packaged .pbw: identity, version, platform, the limits
         the store and the watch hold it to
publish  uploads it to the Pebble app store and verifies the public listing

No credentials are written to the repo. Publishing needs each face's store
listing id (its environment variable below, once the listing exists) and
either `pebble login` or PEBBLE_FIREBASE_REFRESH_TOKEN.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
API = "https://appstore-api.repebble.com"


class Face:
    def __init__(self, key, project, title, listing, store_env):
        self.key, self.project, self.title = key, project, title
        self.uuid = json.loads((ROOT / project / "package.json").read_text())["pebble"]["uuid"].lower()
        self.name = "groundtrack-" + key + ".pbw"
        self.listing = ROOT / listing
        # The listing's id on apps.repebble.com. There are no listings yet:
        # create them in the developer dashboard, then set these.
        self.store_env = store_env
        self.store_id = os.environ.get(store_env, "")

    def built(self):
        return ROOT / self.project / "build" / (self.project + ".pbw")


FACES = {
    "enroute": Face("enroute", "native", "Groundtrack Enroute", "docs/STORE-LISTING.md", "GROUNDTRACK_STORE_APP_ID"),
    "plotboard": Face("plotboard", "native-plotboard", "Groundtrack Plotboard", "docs/STORE-LISTING-PLOTBOARD.md",
                      "GROUNDTRACK_PLOTBOARD_STORE_APP_ID"),
}
# The store takes at most 256 KB of resources an app; an app's code and static
# data are capped at 64 KB (PebbleOS #1873).
MAX_RESOURCES = 256 * 1024
MAX_BINARY = 64 * 1024
CAPABILITIES = {"configurable", "location"}


def version_for(tag=None):
    versions = [json.loads((ROOT / path).read_text())["version"] for path in
                ["package.json", "native/package.json", "native-plotboard/package.json", "package-lock.json"]]
    if len(set(versions)) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", versions[0]):
        raise ValueError("Root, watch faces' and lockfile versions must match (major.minor.patch).")
    version = versions[0]
    if tag and tag != "v" + version:
        raise ValueError("Release tag must match the package version: v" + version)
    return version


def validate_pbw(path, version, face):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip():
            raise ValueError("PBW archive is corrupt.")
        names = archive.namelist()
        for name in ["appinfo.json", "pebble-js-app.js", "emery/pebble-app.bin", "emery/app_resources.pbpack", "emery/manifest.json"]:
            if name not in names:
                raise ValueError("PBW is missing " + name)
        info = json.loads(archive.read("appinfo.json"))
        if info.get("uuid", "").lower() != face.uuid or info.get("versionLabel") != version:
            raise ValueError("PBW UUID/version does not match this release of " + face.title + ".")
        if info.get("targetPlatforms") != ["emery"] or not info.get("watchapp", {}).get("watchface"):
            raise ValueError("This release must be an Emery-only watchface.")
        missing = CAPABILITIES - set(info.get("capabilities", []))
        if missing:
            raise ValueError("PBW lacks capabilities: " + ", ".join(sorted(missing)))
        if archive.getinfo("emery/app_resources.pbpack").file_size > MAX_RESOURCES:
            raise ValueError("Resources exceed the store's 256 KB.")
        if archive.getinfo("emery/pebble-app.bin").file_size > MAX_BINARY:
            raise ValueError("The app binary exceeds 64 KB.")
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def notes_for(version):
    return ROOT / "releases" / ("v" + version + ".md")


def package(version, faces):
    out = ROOT / "release-artifacts"
    out.mkdir(exist_ok=True)
    sums = []
    for face in faces:
        source = face.built()
        validate_pbw(source, version, face)
        # A PBW is a ZIP archive. Deflate changes only its transport size;
        # every member, including the source map and the SDK manifest, stays.
        with zipfile.ZipFile(source) as src, zipfile.ZipFile(out / face.name, "w", zipfile.ZIP_DEFLATED) as dest:
            for item in src.infolist():
                dest.writestr(item.filename, src.read(item.filename))
        digest = validate_pbw(out / face.name, version, face)
        with zipfile.ZipFile(source) as src, zipfile.ZipFile(out / face.name) as dest:
            assert src.namelist() == dest.namelist()
            assert all(src.read(name) == dest.read(name) for name in src.namelist())
        sums.append(digest + "  " + face.name + "\n")
        print(f"Packaged {face.title} {version}: {(out / face.name).stat().st_size:,} bytes; all SDK contents preserved.")
    (out / "SHA256SUMS").write_text("".join(sums))
    notes = notes_for(version)
    if notes.is_file():
        (out / "release-notes.md").write_bytes(notes.read_bytes())
    else:
        print(f"(No {notes.relative_to(ROOT)} yet: not releasable.)")


def description(face):
    copy = face.listing.read_text().split("## Description\n", 1)[1].split("\n## ", 1)[0].strip()
    if not copy or len(copy) > 1600:
        raise ValueError(face.title + "'s store description must contain 1–1600 characters.")
    return copy


def check(version, faces, tag=None):
    for face in faces:
        digest = validate_pbw(ROOT / "release-artifacts" / face.name, version, face)
        description(face)
        print("Verified", face.title, version, digest)
    if tag and not notes_for(version).is_file():
        raise ValueError("Add release notes at " + str(notes_for(version).relative_to(ROOT)))


def access_token():
    from pebble_tool.account import get_account
    from pebble_tool.firebase_account import DEFAULT_FIREBASE_API_KEY
    import requests
    refresh = os.environ.get("PEBBLE_FIREBASE_REFRESH_TOKEN")
    if refresh:
        r = requests.post("https://securetoken.googleapis.com/v1/token",
                          params={"key": DEFAULT_FIREBASE_API_KEY},
                          data={"grant_type": "refresh_token", "refresh_token": refresh}, timeout=30)
        if not r.ok:
            raise RuntimeError("Pebble release sign-in could not be refreshed. Reconnect the publishing secret.")
        token = r.json()["id_token"]
    else:
        if os.environ.get("GITHUB_ACTIONS"):
            raise RuntimeError("Set the repository secret PEBBLE_FIREBASE_REFRESH_TOKEN before publishing.")
        account = get_account(auth_provider="firebase")
        if not account.is_logged_in:
            raise RuntimeError("Run pebble login before publishing.")
        token = account.get_access_token()
    if os.environ.get("GITHUB_ACTIONS"):
        print("::add-mask::" + token)
    return token


def public_app(face):
    import requests
    # The public endpoint caches responses for five minutes and serves stale
    # ones while revalidating. A unique query reads the release just uploaded.
    response = requests.get(API + "/api/v1/apps/id/" + face.store_id,
                            params={"_release_check": str(time.time_ns())}, timeout=30)
    response.raise_for_status()
    return response.json()["data"][0]


def publish(version, face):
    if not face.store_id:
        raise RuntimeError(f"No store listing for {face.title} yet: create it in the Pebble developer dashboard and set {face.store_env}.")
    import requests
    from pebble_tool.commands.publish import PublishCommand
    pbw = ROOT / "release-artifacts" / face.name
    digest = validate_pbw(pbw, version, face)
    copy = description(face)
    notes = notes_for(version).read_text().strip()
    token = access_token()
    headers = {"Authorization": "Bearer " + token}
    r = requests.get(API + "/api/v1/developer/me", headers=headers, timeout=30)
    r.raise_for_status()
    me = r.json()
    if me.get("app_lookup", {}).get("by_app_uuid", {}).get(face.uuid) != face.store_id:
        raise RuntimeError(f"This account does not own the expected {face.title} listing. No changes made.")
    limit = me.get("upload_constraints", {}).get("max_pbw_bytes", 4400000)
    if pbw.stat().st_size > limit:
        raise ValueError("PBW exceeds the store upload limit.")

    app = public_app(face)
    current = (app.get("latest_release") or {}).get("version", "0.0.0")
    parse = lambda v: tuple(int(n) for n in v.split("."))
    if parse(current) > parse(version):
        raise ValueError("Refusing to replace a newer published version.")
    if current != version:
        # The face's gallery in docs/screenshots/store/<face>, if any,
        # replaces the listing's: GIFs first, then stills.
        gallery = sorted((ROOT / "docs/screenshots/store" / face.key).glob("emery_*"))
        gifs = [str(p) for p in gallery if p.suffix == ".gif"]
        stills = [str(p) for p in gallery if p.suffix == ".png"]
        PublishCommand._upload_release(API, face.store_id, token, str(pbw), version, notes, True, gifs, stills,
                                       replace_screenshots=bool(gallery))
    # A rerun verifies an existing version instead of creating it again.
    app = public_app(face)
    if app["latest_release"]["version"] != version:
        raise RuntimeError("The public store has not confirmed the new version.")
    download = requests.get(app["latest_release"]["pbw_file"], timeout=90)
    download.raise_for_status()
    if hashlib.sha256(download.content).hexdigest() != digest:
        raise RuntimeError("Published version has a different package. Use a new version; do not overwrite it.")

    with requests.Session() as session:
        response = session.post(API + "/api/auth/firebase/session", json={"idToken": token}, timeout=30)
        response.raise_for_status()
        values = {"title": face.title, "description": copy,
                  "source": "https://github.com/huntrontrakkr/groundtrack-watch-face", "visibility": "listed"}
        response = session.patch(API + "/api/dashboard/apps/" + face.store_id,
                                 files={key: (None, value) for key, value in values.items()}, timeout=45)
        response.raise_for_status()
    app = public_app(face)
    if app.get("description") != copy or not app.get("visible"):
        raise RuntimeError("Release uploaded, but listing verification failed.")
    store = "https://apps.repebble.com/" + face.store_id
    print(f"Verified public release of {face.title} {version}: {store}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"Published **{face.title} {version}** to [Pebble]({store}).\n\nPublic download SHA-256: `{digest}`.\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["package", "check", "publish"])
    parser.add_argument("--tag")
    parser.add_argument("--face", choices=["all", *FACES], default="all")
    args = parser.parse_args()
    version = version_for(args.tag)
    faces = list(FACES.values()) if args.face == "all" else [FACES[args.face]]
    if args.command == "package":
        package(version, faces)
    elif args.command == "check":
        check(version, faces, args.tag)
    else:
        for face in faces:
            if face.store_id:
                publish(version, face)
            else:
                print(f"{face.title}: no store listing ({face.store_env} unset); not published.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Release failed:", str(error), file=sys.stderr)
        sys.exit(1)
