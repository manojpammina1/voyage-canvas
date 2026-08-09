#!/usr/bin/env python3
"""Generate docs/CONFIG-REFERENCE.md from harness/titan.config.schema.json.

    python harness/scripts/gen-config-reference.py [output-path]

Walks the JSON Schema (draft-07) and emits a flat, readable Markdown table:
key path, type, required?, description, enum values / notes. Zero
third-party deps (matches the rest of the harness's fail-open, stdlib-only
posture) — just the stdlib `json` module and string formatting.

This is a generator, not hand-maintained prose: re-run it after any schema
change and commit the output. docs/CONFIG-REFERENCE.md carries a header
saying so; do not hand-edit that file.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
HARNESS_DIR = SCRIPTS_DIR.parent
SCHEMA_PATH = HARNESS_DIR / "titan.config.schema.json"
DEFAULT_OUT = HARNESS_DIR.parent / "docs" / "CONFIG-REFERENCE.md"


def type_label(node: dict) -> str:
    t = node.get("type")
    if t == "array":
        item_type = (node.get("items") or {}).get("type", "any")
        return f"array<{item_type}>"
    if isinstance(t, list):
        return " | ".join(t)
    return t or "any"


def walk(node: dict, path: str, required_here: set[str], rows: list[dict]) -> None:
    """Emit one row for `path`, then recurse into object/array-of-object children."""
    if path:
        rows.append({
            "path": path,
            "type": type_label(node),
            "required": "yes" if path.split(".")[-1] in required_here else "no",
            "description": (node.get("description") or "").replace("\n", " ").strip(),
            "enum": ", ".join(f"`{v}`" for v in node.get("enum", [])),
        })

    if node.get("type") == "object" and "properties" in node:
        req = set(node.get("required", []))
        for key, child in node["properties"].items():
            child_path = f"{path}.{key}" if path else key
            walk(child, child_path, req, rows)
        # additionalProperties with its own schema (e.g. contacts.people,
        # contacts.areas, roles.definitions) — document the value shape once
        # under a `<id>` placeholder segment rather than per-instance.
        addl = node.get("additionalProperties")
        if isinstance(addl, dict):
            walk(addl, f"{path}.<id>" if path else "<id>", set(addl.get("required", [])), rows)

    elif node.get("type") == "array" and isinstance(node.get("items"), dict):
        items = node["items"]
        if items.get("type") == "object" and "properties" in items:
            req = set(items.get("required", []))
            for key, child in items["properties"].items():
                child_path = f"{path}[].{key}"
                walk(child, child_path, req, rows)


def render_markdown(rows: list[dict], schema: dict) -> str:
    lines = [
        "# Titan Config Reference",
        "",
        "GENERATED FILE — do not hand-edit. Produced by "
        "`harness/scripts/gen-config-reference.py` from "
        "`harness/titan.config.schema.json`. Re-run the generator and commit "
        "the output after any schema change.",
        "",
        f"Schema: `{schema.get('$id', 'titan.config.schema.json')}` — "
        f"{schema.get('description', '')}",
        "",
        "See `docs/ADOPTION.md` for the minimum set of keys to fill in before "
        "a first deploy, and `harness/titan.config.example.json` for a fully "
        "filled worked example.",
        "",
        "| Key path | Type | Required (at its level) | Enum / notes | Description |",
        "|---|---|---|---|---|",
    ]
    for row in rows:
        enum = row["enum"] or "—"
        desc = row["description"] or "—"
        lines.append(f"| `{row['path']}` | {row['type']} | {row['required']} | {enum} | {desc} |")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    out_path = Path(argv[0]) if argv else DEFAULT_OUT
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    rows: list[dict] = []
    top_required = set(schema.get("required", []))
    for key, child in schema.get("properties", {}).items():
        walk(child, key, top_required, rows)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_markdown(rows, schema), encoding="utf-8")
    print(f"Wrote {len(rows)} rows -> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
