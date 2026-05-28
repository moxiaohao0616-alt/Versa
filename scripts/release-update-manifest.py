#!/usr/bin/env python3
"""
Build and upload the `latest.json` manifest the Tauri updater plugin reads.

Usage:
    scripts/release-update-manifest.py v0.1.0-alpha.24

What it does:
    1. Lists the assets on the named GitHub Release via `gh`.
    2. Finds each platform's UPDATER ARCHIVE + its `.sig` sidecar:
         macOS   →  *.app.tar.gz                  (+ .sig)
         Linux   →  *.AppImage                    (+ .sig)
         Windows →  *-setup.nsis.zip              (+ .sig)
       These are produced by `tauri build` when
       `bundle.createUpdaterArtifacts: true` in tauri.conf.json.
    3. Reads the .sig file contents (downloads from the release).
    4. Assembles a `latest.json` matching the schema the tauri-updater
       plugin expects:
         { version, notes, pub_date, platforms: { "<target>": { signature, url } } }
    5. Uploads `latest.json` to the same release with `--clobber`.

Endpoint URL (configured in tauri.conf.json plugins.updater.endpoints):
    https://github.com/moxiaohao0616-alt/Versa/releases/latest/download/latest.json
That URL only resolves once the release is PUBLISHED (drafts return 404),
so users only see the update after you publish the release manually.

Requirements: gh CLI authenticated with repo scope. macOS/Linux/Python 3.
"""
import argparse
import datetime
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = "moxiaohao0616-alt/Versa"

PLATFORM_MATCHERS = [
    # (suffix to match on asset name, tauri target identifier)
    (".app.tar.gz",       "darwin-aarch64"),
    (".AppImage",         "linux-x86_64"),
    ("-setup.nsis.zip",   "windows-x86_64"),
]


def gh_assets(tag: str) -> list[str]:
    out = subprocess.check_output(
        ["gh", "release", "view", tag, "--repo", REPO,
         "--json", "assets", "--jq", ".assets[].name"],
        text=True,
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def gh_download(tag: str, pattern: str, into: Path) -> None:
    subprocess.check_call(
        ["gh", "release", "download", tag, "--repo", REPO,
         "--pattern", pattern, "--dir", str(into), "--clobber"],
    )


def gh_upload(tag: str, path: Path) -> None:
    subprocess.check_call(
        ["gh", "release", "upload", tag, str(path),
         "--repo", REPO, "--clobber"],
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("tag", help="Release tag, e.g. v0.1.0-alpha.24")
    args = ap.parse_args()
    tag = args.tag
    version = tag.lstrip("v")

    assets = set(gh_assets(tag))
    if not assets:
        print(f"ERROR: no assets on {tag}", file=sys.stderr)
        return 1

    # Discover platform archives + ensure their .sig sidecar exists.
    platforms: dict[str, dict[str, str]] = {}
    for name in sorted(assets):
        for suffix, target in PLATFORM_MATCHERS:
            if name.endswith(suffix):
                sig = name + ".sig"
                if sig in assets:
                    platforms[target] = {"archive": name, "sig": sig}
                else:
                    print(f"WARN: {name} has no {sig}, skipping", file=sys.stderr)
                break

    if not platforms:
        print("ERROR: no updater archives found. Did `tauri build` run with "
              "`bundle.createUpdaterArtifacts: true`?", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        for info in platforms.values():
            gh_download(tag, info["sig"], td_path)

        now = datetime.datetime.now(datetime.timezone.utc) \
            .isoformat(timespec="seconds").replace("+00:00", "Z")

        manifest = {
            "version": version,
            "notes": f"See https://github.com/{REPO}/releases/tag/{tag}",
            "pub_date": now,
            "platforms": {},
        }
        for target, info in platforms.items():
            sig_text = (td_path / info["sig"]).read_text(encoding="utf-8").strip()
            manifest["platforms"][target] = {
                "signature": sig_text,
                "url": f"https://github.com/{REPO}/releases/download/{tag}/{info['archive']}",
            }

        manifest_path = td_path / "latest.json"
        manifest_path.write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        gh_upload(tag, manifest_path)

    targets = ", ".join(sorted(platforms.keys()))
    print(f"OK — uploaded latest.json with platforms: {targets}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
