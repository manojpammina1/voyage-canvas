#!/usr/bin/env python3
"""Protected path guard for git pre-commit and CI — uses data/protected-paths.json."""
from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys
from pathlib import Path


def find_protected_paths_file(start: Path) -> Path | None:
    for rel in (
        "data/protected-paths.json",
        ".claude/data/protected-paths.json",
        "titan/harness/data/protected-paths.json",
    ):
        p = start / rel
        if p.is_file():
            return p
    return None


def load_paths(config_path: Path) -> list[dict]:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    return data.get("paths") or []


def git_staged_files(cwd: Path) -> list[str]:
    r = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "-z"],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return []
    return [p for p in r.stdout.split("\0") if p]


def git_diff_files(cwd: Path, ref_a: str, ref_b: str) -> list[str]:
    r = subprocess.run(
        ["git", "diff", "--name-only", ref_a, ref_b],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return []
    return [ln.strip() for ln in r.stdout.splitlines() if ln.strip()]


def matches_protected(path: str, entries: list[dict]) -> tuple[bool, str]:
    for entry in entries:
        enforcement = entry.get("enforcement") or {}
        if not enforcement.get("hard_stop") and not enforcement.get("block_write"):
            continue
        for glob in entry.get("globs") or []:
            if fnmatch.fnmatch(path, glob) or fnmatch.fnmatch(path, glob.lstrip("./")):
                return True, entry.get("id") or glob
    return False, ""


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged", action="store_true", help="Check git staged files")
    parser.add_argument("--diff", nargs=2, metavar=("A", "B"), help="Check git diff A..B")
    parser.add_argument("--root", default=".", help="Repo root")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    pp_file = find_protected_paths_file(root)
    if pp_file is None:
        sys.stderr.write("[path-guard] No protected-paths.json — fail open\n")
        return 0

    entries = load_paths(pp_file)
    if args.staged:
        files = git_staged_files(root)
    elif args.diff:
        files = git_diff_files(root, args.diff[0], args.diff[1])
    else:
        files = git_staged_files(root)

    blocked = []
    for f in files:
        hit, reason = matches_protected(f.replace("\\", "/"), entries)
        if hit:
            blocked.append((f, reason))

    if blocked:
        sys.stderr.write("[path-guard] Protected path violation:\n")
        for f, reason in blocked:
            sys.stderr.write(f"  {f} ({reason})\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
