#!/usr/bin/env python3
"""Build the addon .mcpack from this repository and verify what went into it.

A .mcpack is a ZIP archive whose members sit at the archive root: manifest.json
and the pack's own directories, with no wrapper folder and nothing from the
repository that is not part of the pack (README, LICENSE, .github, ...).

Usage:
    python3 build_mcpack.py --version 1.2.3 --out dist/safe-villages-v1.2.3.mcpack
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

# Directories that belong to a Bedrock pack. Only those present are included, so
# this stays correct as the pack grows without having to list files by hand.
PACK_DIRS = (
    "scripts",
    "entities",
    "textures",
    "blocks",
    "items",
    "recipes",
    "loot_tables",
    "functions",
    "structures",
    "sounds",
    "ui",
    "models",
    "animations",
    "animation_controllers",
    "spawn_rules",
    "features",
    "feature_rules",
    "particles",
    "dialogue",
    "trading",
    "render_controllers",
)

REQUIRED_ROOT_FILES = ("manifest.json",)


def pack_members(root: Path, manifest: dict) -> list[Path]:
    """Every file that belongs in the pack, as paths relative to the repo root."""
    members: list[Path] = []

    for name in REQUIRED_ROOT_FILES:
        path = root / name
        if not path.is_file():
            sys.exit(f"error: {name} is missing from the repository")
        members.append(Path(name))

    icon = root / "pack_icon.png"
    if icon.is_file():
        members.append(Path("pack_icon.png"))

    for dirname in PACK_DIRS:
        directory = root / dirname
        if directory.is_dir():
            members.extend(sorted(p.relative_to(root) for p in directory.rglob("*") if p.is_file()))

    # A module entry that lives outside the known directories still ships.
    for module in manifest.get("modules", []):
        entry = module.get("entry")
        if not entry:
            continue
        path = root / entry
        if not path.is_file():
            sys.exit(f"error: module entry {entry!r} does not exist")
        relative = Path(entry)
        if relative not in members:
            members.append(relative)

    return members


def build(root: Path, version: str, out: Path) -> None:
    manifest_path = root / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except json.JSONDecodeError as error:
        sys.exit(f"error: manifest.json is not valid JSON: {error}")

    declared = ".".join(str(part) for part in manifest.get("header", {}).get("version", []))
    if declared != version:
        sys.exit(f"error: manifest.json declares {declared or 'no version'}, expected {version}")

    members = pack_members(root, manifest)

    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for member in members:
            archive.write(root / member, arcname=str(member))

    verify(out, version, members)
    print(f"built {out} with {len(members)} files:\n  " + "\n  ".join(str(m) for m in members))


def verify(out: Path, version: str, members: list[Path]) -> None:
    """Read the archive back: a pack that does not open is not a release."""
    with zipfile.ZipFile(out) as archive:
        bad = archive.testzip()
        if bad is not None:
            sys.exit(f"error: {out} has a corrupt member: {bad}")

        names = archive.namelist()
        if "manifest.json" not in names:
            sys.exit("error: manifest.json is not at the archive root - the game will not load this pack")

        for name in names:
            if name.startswith("/") or ".." in Path(name).parts:
                sys.exit(f"error: unsafe path in archive: {name}")

        packed = json.loads(archive.read("manifest.json"))
        packed_version = ".".join(str(part) for part in packed.get("header", {}).get("version", []))
        if packed_version != version:
            sys.exit(f"error: the packed manifest declares {packed_version}, expected {version}")

        missing = {str(m) for m in members} - set(names)
        if missing:
            sys.exit(f"error: archive is missing {sorted(missing)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="version the pack should declare")
    parser.add_argument("--out", required=True, type=Path, help="path of the .mcpack to write")
    parser.add_argument("--root", type=Path, default=Path("."), help="repository root")
    args = parser.parse_args()

    build(args.root, args.version, args.out)


if __name__ == "__main__":
    main()
