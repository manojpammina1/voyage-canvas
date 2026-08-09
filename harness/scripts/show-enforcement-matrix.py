#!/usr/bin/env python3
"""Print Claude vs Codex vs Cursor enforcement from governance-manifest.json.

Usage (from repo root with a deployed manifest):
    python3 titan/harness/scripts/show-enforcement-matrix.py
    python3 titan/harness/scripts/show-enforcement-matrix.py path/to/governance-manifest.json

Reads each control's claude / codex / cursor blocks and shows trigger, via,
or advisory (trigger: null + note). Zero third-party deps.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def fmt(block: dict | None) -> str:
    if not block:
        return "—"
    trigger = block.get("trigger")
    if trigger:
        return str(trigger)
    if block.get("via"):
        return str(block["via"])
    if trigger is None:
        note = (block.get("note") or "advisory only").split("—")[0].strip()
        if len(note) > 55:
            note = note[:55] + "…"
        return f"advisory ({note})"
    return "?"


def find_default_manifest() -> Path | None:
    candidates = [
        Path.cwd() / "governance-manifest.json",
        Path(__file__).resolve().parent.parent.parent.parent / "governance-manifest.json",
    ]
    for path in candidates:
        if path.is_file():
            return path
    return None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "manifest",
        nargs="?",
        type=Path,
        help="Path to governance-manifest.json (default: ./governance-manifest.json or RCG root)",
    )
    args = parser.parse_args(argv)

    manifest_path = args.manifest or find_default_manifest()
    if manifest_path is None or not manifest_path.is_file():
        print("FAIL: governance-manifest.json not found.", file=sys.stderr)
        print("Run: titan-render.py --target all --out <dir>", file=sys.stderr)
        return 1

    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
    controls = doc.get("controls") or []
    targets = doc.get("targets_rendered") or []

    print(f"Manifest: {manifest_path.resolve()}")
    print(f"Rendered for: {targets}\n")
    print(f"{'Control':<22} {'Claude':<38} {'Codex':<38} Cursor")
    print("-" * 140)

    for ctrl in controls:
        cid = ctrl.get("id", "?")
        cl = fmt(ctrl.get("claude"))
        co = fmt(ctrl.get("codex"))
        cu = fmt(ctrl.get("cursor"))
        print(f"{cid:<22} {cl:<38} {co:<38} {cu}")

    print()
    print(f"{len(controls)} control(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
