#!/usr/bin/env python3
"""Titan config CLI — inspect and validate titan.config.json.

    titan-config.py --validate [path]
    titan-config.py --get <dotted.path> [path]
    titan-config.py --list [path]

Zero third-party deps (matches the rest of the harness's fail-open hook
posture). Dotted paths use `.N` for array index and `contacts.*` person-ids
are auto-dereferenced to `.name` (same convention titan-render.py uses).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HARNESS_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = HARNESS_DIR / "titan.config.json"
DEFAULT_SCHEMA = HARNESS_DIR / "titan.config.schema.json"


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def resolve_path(config: dict, dotted: str):
    """Resolve a dotted path, e.g. contacts.areas.aem.primary.0.name or
    contacts.areas.aem.primary.0 (auto-dereferenced through contacts.people)."""
    parts = dotted.split(".")
    people = config.get("contacts", {}).get("people", {})
    node = config
    for part in parts:
        if isinstance(node, str) and node in people:
            node = people[node]
        if isinstance(node, list):
            try:
                idx = int(part)
            except ValueError:
                raise KeyError(f"expected array index, got {part!r}")
            node = node[idx]
        elif isinstance(node, dict):
            if part not in node:
                raise KeyError(f"no key {part!r} in {list(node.keys())}")
            node = node[part]
        else:
            raise KeyError(f"cannot descend into {part!r} on {type(node).__name__}")
    return node


def dereference_person(config: dict, value):
    """If value looks like a contacts.people id, return its .name."""
    if isinstance(value, str):
        people = config.get("contacts", {}).get("people", {})
        if value in people and isinstance(people[value], dict) and "name" in people[value]:
            return people[value]["name"]
    return value


# --- minimal validator (no jsonschema dependency) ---------------------------

def validate_type(value, expected: str, ctx: str, errors: list[str]) -> None:
    pytypes = {
        "object": dict, "array": list, "string": str,
        "boolean": bool, "number": (int, float),
    }
    t = pytypes.get(expected)
    if t is None:
        return
    if expected == "boolean" and isinstance(value, bool):
        return
    if expected == "number" and isinstance(value, bool):
        errors.append(f"{ctx}: expected number, got boolean")
        return
    if not isinstance(value, t):
        errors.append(f"{ctx}: expected {expected}, got {type(value).__name__}")


def validate_against_schema(config: dict, schema: dict) -> list[str]:
    errors: list[str] = []

    def walk(node_schema: dict, node_value, ctx: str):
        if "type" in node_schema:
            validate_type(node_value, node_schema["type"], ctx, errors)
        if node_schema.get("type") == "object" and isinstance(node_value, dict):
            for req in node_schema.get("required", []):
                if req not in node_value:
                    errors.append(f"{ctx}: missing required key {req!r}")
            props = node_schema.get("properties", {})
            for key, sub_schema in props.items():
                if key in node_value:
                    walk(sub_schema, node_value[key], f"{ctx}.{key}")
        if node_schema.get("type") == "array" and isinstance(node_value, list):
            item_schema = node_schema.get("items")
            if item_schema:
                for i, item in enumerate(node_value):
                    walk(item_schema, item, f"{ctx}[{i}]")
        if "enum" in node_schema and node_value not in node_schema["enum"]:
            errors.append(f"{ctx}: {node_value!r} not in {node_schema['enum']}")

    walk(schema, config, "$")
    return errors


def cmd_validate(config_path: Path, schema_path: Path) -> int:
    try:
        config = load_json(config_path)
    except Exception as e:
        print(f"FAIL: cannot parse {config_path}: {e}", file=sys.stderr)
        return 1
    try:
        schema = load_json(schema_path)
    except Exception as e:
        print(f"FAIL: cannot parse {schema_path}: {e}", file=sys.stderr)
        return 1

    errors = validate_against_schema(config, schema)
    if errors:
        print(f"FAIL: {config_path} — {len(errors)} error(s)")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"OK: {config_path} validates against {schema_path.name}")
    return 0


def cmd_get(config_path: Path, dotted: str) -> int:
    config = load_json(config_path)
    try:
        value = resolve_path(config, dotted)
    except KeyError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1
    value = dereference_person(config, value)
    if isinstance(value, (dict, list)):
        print(json.dumps(value, indent=2))
    else:
        print(value)
    return 0


def cmd_list(config_path: Path) -> int:
    config = load_json(config_path)

    def walk(node, prefix=""):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{prefix}.{k}" if prefix else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f"{prefix}.{i}")
        else:
            print(f"{prefix} = {node!r}")

    walk(config)
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1

    flag = argv[0]
    rest = argv[1:]

    if flag == "--validate":
        config_path = Path(rest[0]) if rest else DEFAULT_CONFIG
        return cmd_validate(config_path, DEFAULT_SCHEMA)
    if flag == "--get":
        if not rest:
            print("FAIL: --get requires a dotted path", file=sys.stderr)
            return 1
        dotted = rest[0]
        config_path = Path(rest[1]) if len(rest) > 1 else DEFAULT_CONFIG
        return cmd_get(config_path, dotted)
    if flag == "--list":
        config_path = Path(rest[0]) if rest else DEFAULT_CONFIG
        return cmd_list(config_path)

    print(f"FAIL: unknown flag {flag!r}", file=sys.stderr)
    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
