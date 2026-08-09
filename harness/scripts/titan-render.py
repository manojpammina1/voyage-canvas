#!/usr/bin/env python3
"""Titan render pipeline — one governance core, multiple agent adapters.

    titan-render.py --config <cfg> --target {claude|codex|cursor|all} --out <dir>
    titan-render.py <config.json> <output-dir>   # backward compat → --target claude

Zero third-party deps.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_DIR))
sys.path.insert(0, str(HARNESS_DIR / "scripts"))

from titan_core import Core, sha256, write_text  # noqa: E402
from adapters.claude.adapter import ClaudeAdapter  # noqa: E402
from adapters.codex.adapter import CodexAdapter  # noqa: E402
from adapters.cursor.adapter import CursorAdapter  # noqa: E402

ADAPTERS = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "cursor": CursorAdapter(),
}


def write_governance_manifest(out_dir: Path, gov: Core, config_path: Path, targets: list[str]) -> None:
    doc = {
        "_description": "Per-control enforcement by agent adapter (T12 audit evidence).",
        "governance_version": gov.version,
        "config_source": str(config_path),
        "targets_rendered": targets,
        "controls": gov.enforcement_manifest(),
    }
    write_text(out_dir / "governance-manifest.json", json.dumps(doc, indent=2) + "\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", "-c", type=Path, help="Path to titan.config.json")
    parser.add_argument("--target", "-t", default="claude", choices=["claude", "codex", "cursor", "all"])
    parser.add_argument("--out", "-o", type=Path, help="Output directory")
    parser.add_argument("positional", nargs="*", help="Legacy: <config> <out>")
    return parser.parse_args(argv)


def resolve_paths(args: argparse.Namespace) -> tuple[Path, Path, str]:
    if args.config and args.out:
        return args.config.resolve(), args.out.resolve(), args.target
    if len(args.positional) == 2:
        cfg, out = args.positional[0].strip(), args.positional[1].strip()
        if not cfg:
            raise SystemExit(
                "FAIL: config path is empty (is $FIXTURE set?).\n"
                "  Example: FIXTURE=../fixtures/titan.config.github-generic.json\n"
                "  Or:      python3 scripts/titan-render.py --config ../fixtures/titan.config.github-generic.json --out .render/manual-claude"
            )
        return Path(cfg).resolve(), Path(out).resolve(), "claude"
    raise SystemExit(
        "Usage: titan-render.py --config <cfg> --target claude|codex|cursor|all --out <dir>\n"
        "   or: titan-render.py <config.json> <output-dir>"
    )


def _load_config(config_path: Path) -> dict:
    if not config_path.is_file():
        hint = ""
        if config_path.resolve() == Path.cwd():
            hint = " (Path('') resolves to '.' — check that $FIXTURE is set or pass an explicit config path)"
        raise SystemExit(f"FAIL: config is not a file: {config_path}{hint}")
    try:
        return json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SystemExit(f"FAIL: invalid JSON in {config_path}: {e}") from e


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    config_path, out_dir, target = resolve_paths(args)
    config = _load_config(config_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    gov = Core(HARNESS_DIR)
    targets = ["claude", "codex", "cursor"] if target == "all" else [target]
    total_files = 0
    verify_failures: list[str] = []

    for name in targets:
        adapter = ADAPTERS[name]
        written = adapter.render(config, gov, out_dir)
        total_files += len(written)
        if not adapter.verify(out_dir):
            verify_failures.append(name)
            print(f"FAIL: {name} adapter verify() failed for {out_dir}", file=sys.stderr)

    if target == "all" or len(targets) > 1:
        write_governance_manifest(out_dir, gov, config_path, targets)

    print(f"Rendered {total_files} file(s) -> {out_dir} (target={target})")
    if verify_failures:
        print(
            "RESULT: FAIL — adapter verify failed: " + ", ".join(verify_failures),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
