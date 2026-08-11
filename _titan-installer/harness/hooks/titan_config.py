#!/usr/bin/env python3
"""
Titan — shared config-access library for hooks.

Non-hook module inside hooks/ (same precedent as redact_lib.py — deployed by
the directory copy, importable by every sibling hook via
``sys.path.insert(0, str(Path(__file__).resolve().parent))``).

Every function here is FAIL-OPEN: on any error (missing file, malformed JSON,
missing key, wrong type) it returns a safe empty value — never raises, never
prints, never exits. Hooks that read org facts through this module keep
working (with an emptier answer) even when titan.config.json is missing,
half-filled, or corrupt. The one deliberate exception to "fail open" in the
whole harness is protect-secrets.py's hardcoded secret-format floor, which
does NOT go through this module at all — see that file's own docstring.

In-process cache: protect-secrets.py fires on every single Read / Write /
Edit / Bash / Grep PreToolUse event, so re-parsing titan.config.json (and the
compiled protected-paths.json) on every call would be wasteful. Both are
cached in a module-level dict keyed by the resolved workspace path string.
The cache is intentionally process-lifetime only (each hook invocation is a
fresh Python process under Claude Code's hook model), so there is no
staleness concern beyond "edit the config, next hook invocation picks it up".

Two-location fallback (deployed tree first, harness source tree second) is
the same convention as answer-cache.py:load_data_file — a maintainer running
scripts directly from harness/ (no .claude/ deploy) still gets real data.
"""
from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
HARNESS_DIR = HOOKS_DIR.parent

_CONFIG_CACHE: dict[str, dict] = {}
_PROTECTED_CACHE: dict[str, dict] = {}

DEFAULT_SALT = "TITAN-DEFAULT-SALT"
DEFAULT_BRAND = "Titan"


# ─────────────────────────────────────────────────────────────────────────
# Location resolution (two-location fallback, matches answer-cache.py)
# ─────────────────────────────────────────────────────────────────────────
def _locate(workspace: Path, relative: str) -> Path | None:
    candidates = [
        workspace / ".claude" / relative,
        HARNESS_DIR / relative,
    ]
    for p in candidates:
        try:
            if p.exists():
                return p
        except Exception:
            continue
    return None


def _read_json(path: Path | None) -> dict:
    if not path:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────
# Core loaders (cached)
# ─────────────────────────────────────────────────────────────────────────
def load_config(workspace) -> dict:
    """Load titan.config.json. Fail-open: {} on any error/missing file."""
    try:
        key = str(Path(workspace).resolve())
    except Exception:
        key = str(workspace)
    if key in _CONFIG_CACHE:
        return _CONFIG_CACHE[key]
    try:
        ws = Path(workspace)
        data = _read_json(_locate(ws, "titan.config.json"))
        if not isinstance(data, dict):
            data = {}
    except Exception:
        data = {}
    _CONFIG_CACHE[key] = data
    return data


def load_protected(workspace) -> dict:
    """Load the compiled data/protected-paths.json (see titan-render.py's
    build_protected_paths). Fail-open: {"paths": []} on any error/missing."""
    try:
        key = str(Path(workspace).resolve())
    except Exception:
        key = str(workspace)
    if key in _PROTECTED_CACHE:
        return _PROTECTED_CACHE[key]
    try:
        ws = Path(workspace)
        cfg = load_config(ws)
        rel = (cfg.get("data_files") or {}).get("protected_paths") or "data/protected-paths.json"
        # rel may be "data/protected-paths.json" — strip any leading "data/"
        # duplication risk is irrelevant here since _locate joins under .claude/
        name = rel if not rel.startswith("data/") else rel
        data = _read_json(_locate(ws, name))
        if not isinstance(data, dict) or "paths" not in data:
            data = {"paths": data.get("paths", []) if isinstance(data, dict) else []}
    except Exception:
        data = {"paths": []}
    _PROTECTED_CACHE[key] = data
    return data


def clear_cache() -> None:
    """Test/dev helper — drop the in-process cache."""
    _CONFIG_CACHE.clear()
    _PROTECTED_CACHE.clear()


# ─────────────────────────────────────────────────────────────────────────
# Telemetry identity — the 12-site duplication, consolidated once
# ─────────────────────────────────────────────────────────────────────────
def telemetry_salt(workspace) -> str:
    try:
        cfg = load_config(workspace)
        salt = (cfg.get("telemetry") or {}).get("salt")
        if isinstance(salt, str) and salt:
            return salt
    except Exception:
        pass
    return DEFAULT_SALT


def hashed_user(workspace) -> str:
    try:
        salt = telemetry_salt(workspace)
        user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
        return hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]
    except Exception:
        return "0" * 16


# ─────────────────────────────────────────────────────────────────────────
# Org / brand / repos
# ─────────────────────────────────────────────────────────────────────────
def org(workspace) -> dict:
    try:
        return load_config(workspace).get("org") or {}
    except Exception:
        return {}


def brand(workspace) -> str:
    try:
        b = org(workspace).get("harness_brand")
        if isinstance(b, str) and b:
            return b
    except Exception:
        pass
    return DEFAULT_BRAND


def repo_dirs(workspace) -> list[str]:
    try:
        repos = load_config(workspace).get("repos") or []
        return [r.get("dir") for r in repos if isinstance(r, dict) and r.get("dir")]
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────────
# Contacts
# ─────────────────────────────────────────────────────────────────────────
def _person_name(config: dict, pid: str) -> str:
    try:
        people = (config.get("contacts") or {}).get("people") or {}
        person = people.get(pid)
        if isinstance(person, dict) and person.get("name"):
            return person["name"]
    except Exception:
        pass
    return pid


def _names(config: dict, ids) -> list[str]:
    return [_person_name(config, pid) for pid in (ids or [])]


def contacts_for(workspace, area: str) -> dict:
    """Return {'label', 'primary': [names], 'secondary': [names]} for one
    contacts.areas key. Fail-open: {} if the area/config is missing."""
    try:
        config = load_config(workspace)
        areas = (config.get("contacts") or {}).get("areas") or {}
        entry = areas.get(area)
        if not isinstance(entry, dict):
            return {}
        return {
            "label": entry.get("label", area),
            "primary": _names(config, entry.get("primary")),
            "secondary": _names(config, entry.get("secondary")),
        }
    except Exception:
        return {}


def contacts_inline(workspace) -> str:
    """Short human-readable string for inline hook messages, e.g.
    'aem→Jane Doe · commerce→John Smith'. Fail-open: '' if unavailable."""
    try:
        config = load_config(workspace)
        areas = (config.get("contacts") or {}).get("areas") or {}
        parts = []
        for key, entry in areas.items():
            if not isinstance(entry, dict):
                continue
            names = _names(config, entry.get("primary"))
            if names:
                parts.append(f"{key}\u2192{', '.join(names)}")
        return " \u00b7 ".join(parts)
    except Exception:
        return ""


# ─────────────────────────────────────────────────────────────────────────
# Protected-path ownership lookup — most-specific glob wins
# ─────────────────────────────────────────────────────────────────────────
def _norm_path(path: str) -> str:
    return (path or "").replace("\\", "/")


def _glob_matches(norm_path: str, glob: str) -> bool:
    if not glob:
        return False
    g = glob.replace("\\", "/")
    try:
        if fnmatch.fnmatch(norm_path, g):
            return True
        # allow a glob anchored with ** to match a path missing the leading
        # segment (mirrors answer-cache.py:resolve_reviewers' fallback)
        stripped = g.lstrip("*/")
        if stripped and fnmatch.fnmatch("/" + norm_path, "*/" + stripped):
            return True
    except Exception:
        return False
    return False


def owners_for_path(workspace, path: str) -> tuple[str | None, list[str], str]:
    """Return (severity, [owner names], why) for the most-specific
    protected_paths entry whose globs match `path`. Most-specific = longest
    matching glob string. Fail-open: (None, [], '') on any error / no match."""
    try:
        norm = _norm_path(path)
        if not norm:
            return None, [], ""
        protected = load_protected(workspace)
        config = load_config(workspace)
        best = None
        best_len = -1
        for entry in protected.get("paths", []) or []:
            if not isinstance(entry, dict):
                continue
            for g in entry.get("globs", []) or []:
                if _glob_matches(norm, g) and len(g) > best_len:
                    best = entry
                    best_len = len(g)
        if not best:
            return None, [], ""
        owner_names = best.get("owner_names")
        if not owner_names:
            owner_names = _names(config, best.get("owners"))
        return best.get("severity"), owner_names, best.get("why", "")
    except Exception:
        return None, [], ""


# ─────────────────────────────────────────────────────────────────────────
# Glob → regex compilation (search-anywhere semantics, for Bash command text)
# ─────────────────────────────────────────────────────────────────────────
def globs_to_regex(globs) -> "re.Pattern | None":
    """Compile a list of path globs into a single case-insensitive regex
    usable with re.search() against arbitrary strings (e.g. a Bash command
    line where the path glob may appear anywhere, followed by other tokens).

    Uses fnmatch.translate() per plan §C.0, then strips the trailing anchor
    fnmatch adds (`\\Z` / `\\Z(?ms)`) so the compiled pattern can match a
    substring instead of requiring the whole subject to match. Backslashes
    are normalised to `/` first so Windows-style paths in globs behave the
    same as POSIX ones. Fail-open: None if the input is empty or invalid.
    """
    try:
        if not globs:
            return None
        parts = []
        for g in globs:
            if not g:
                continue
            g = str(g).replace("\\", "/")
            variants = {g}
            # A "**/foo" glob requires a literal "/" before "foo" once
            # translated -- it will NOT match bare "foo" text with no leading
            # path segment (e.g. a prompt/bash string that names the file
            # without a directory prefix). Also index the stripped-prefix
            # form so callers get the same "most-specific glob, but tolerant
            # of a missing leading segment" behavior as
            # answer-cache.py:resolve_reviewers / owners_for_path above.
            stripped = g.lstrip("*/")
            if stripped:
                variants.add(stripped)
            for variant in variants:
                pat = fnmatch.translate(variant)
                pat = re.sub(r"\\[Zz](\(\?ms\))?$", "", pat)
                parts.append(pat)
        if not parts:
            return None
        combined = "(?:" + "|".join(parts) + ")"
        return re.compile(combined, re.IGNORECASE)
    except Exception:
        return None
