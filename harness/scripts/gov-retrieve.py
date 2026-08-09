#!/usr/bin/env python3
"""
Titan — governance retrieval helper (Phase 2 of the agentic feature
suite; grounds the review-orchestrator / adversarial-verifier subagents in
CURRENT governance instead of an inlined, drift-prone copy).

Deterministic, LOCAL, no-egress retrieval over the adopter's governance
sources. There is no model in the retrieval path — this is lexical/glob
scoring only, so every result carries provenance (source_file + heading/line)
and nothing is ever invented. Mirrors the "most-specific glob wins" contract
from answer-cache.py:resolve_reviewers and the reviewer-map.json data shape.

Index sources (read live at query time — no separate build step to drift):
  - CLAUDE.md                      hard-stop tables, contract registry,
                                    escalation contacts, absolute rules
  - data/reviewer-map.json         glob -> owner / sensitivity rules
  - data/build-map.json            per-module build / hard-stop notes
  - titan.config.json              contacts.areas + protected_paths + contracts
                                    (so "?gov who owns search mappings" resolves
                                    even when no markdown table mentions it)

Safety: any glob covered by a titan.config.json protected_paths[] entry with
enforcement.never_index=true is NEVER indexed or returned, sourced live from
data/protected-paths.json via titan_config.py (fail-open to a small,
org-neutral fallback list of secret-file extensions if the config/hook module
is unavailable — never silently indexes nothing at all, never crashes).

Contract:
  - Fail-open on any error: print {"results": [], ...} and exit 0. Never
    blocks a caller — this is an on-demand lookup, not a gate.
  - No content from the skip-listed paths ever appears in output, even as a
    provenance string (skip and record a redaction note instead).

CLI:
    python gov-retrieve.py --query "hybris config"
    python gov-retrieve.py --file "hybris/config/prod.properties" --kind hardstop
    python gov-retrieve.py --query "OCC endpoint owner" --top-k 3 --format md
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "hooks"))
try:
    import titan_config
except Exception:
    titan_config = None

# Fail-open fallback if titan_config / the compiled protected-paths.json is
# unavailable -- a small, org-neutral list of secret-file-format globs so the
# index is never fully permissive even with a broken/missing config.
DEFAULT_NEVER_INDEX_GLOBS = (
    "*.p12", "*.jks", "*.pfx", "*.pem", "*.key", "*.keystore",
)

KIND_HEADING_HINTS = {
    "hardstop": ("hard stop", "escalation", "irrotatable"),
    "contract": ("contract", "graphql", "occ endpoint", "pim"),
    "contact": ("escalation contact", "owner"),
    "convention": ("convention", "naming", "module"),
    "known-issue": ("known issue",),
}


def never_index_globs(workspace: Path) -> tuple:
    if titan_config:
        try:
            protected = titan_config.load_protected(workspace)
            globs = []
            for e in protected.get("paths", []) or []:
                if isinstance(e, dict) and (e.get("enforcement") or {}).get("never_index"):
                    globs.extend(e.get("globs", []) or [])
            if globs:
                return tuple(globs)
        except Exception:
            pass
    return DEFAULT_NEVER_INDEX_GLOBS


def _is_never_index(path_str: str, never_globs: tuple) -> bool:
    norm = path_str.replace("\\", "/")
    return any(fnmatch.fnmatch(norm, pat) for pat in never_globs)


def workspace_root() -> Path:
    import os
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path.cwd())


def _locate(workspace: Path, relative: str) -> Path | None:
    """Same two-location fallback as answer-cache.py:load_data_file — deployed
    .claude/ tree first, harness source tree second (maintainer runs)."""
    candidates = [
        workspace / ".claude" / relative,
        Path(__file__).resolve().parent.parent / relative,
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


# ── Chunking ────────────────────────────────────────────────────────────────
_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)$")
_TABLE_ROW_RE = re.compile(r"^\|.+\|$")


def chunk_markdown(text: str, source: str) -> list[dict]:
    """Split a markdown file into (heading, body) chunks. Table blocks under a
    heading are kept as one chunk each (a table row alone has no meaning
    without its header row), not split per-row."""
    chunks: list[dict] = []
    lines = text.splitlines()
    current_heading = ""
    current_lines: list[str] = []
    current_start = 1

    def _flush(end_line: int) -> None:
        body = "\n".join(current_lines).strip()
        if body:
            chunks.append({
                "heading": current_heading,
                "text": body,
                "source": f"{source}:{current_start}-{end_line}",
            })

    for i, line in enumerate(lines, start=1):
        m = _HEADING_RE.match(line)
        if m:
            _flush(i - 1)
            current_heading = m.group(2).strip()
            current_lines = []
            current_start = i
        else:
            current_lines.append(line)
    _flush(len(lines))
    return chunks


def load_claude_md_chunks(workspace: Path) -> list[dict]:
    p = _locate(workspace, "CLAUDE.md")
    if not p:
        return []
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []
    return chunk_markdown(text, "CLAUDE.md")


def load_json_chunks(workspace: Path, relative: str, kind: str, never_globs: tuple) -> list[dict]:
    """Flatten a governance JSON data file into query-able chunks. Each
    top-level rule/module entry becomes one chunk with a synthetic heading so
    it scores like a markdown section."""
    p = _locate(workspace, relative)
    if not p:
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return []

    chunks: list[dict] = []
    if relative.endswith("reviewer-map.json"):
        for i, rule in enumerate(data.get("paths", [])):
            glob = rule.get("glob", "")
            if _is_never_index(glob, never_globs):
                continue
            text = (
                f"glob: {glob}\nsensitivity: {rule.get('sensitivity','')}\n"
                f"owners: {', '.join(rule.get('owners', []))}\nwhy: {rule.get('why','')}"
            )
            chunks.append({
                "heading": f"reviewer-map path rule #{i}",
                "text": text,
                "source": f"{relative}#paths[{i}]",
                "kind": "contract" if rule.get("sensitivity") in ("HIGH", "CRITICAL") else "convention",
                "glob": glob,
            })
    elif relative.endswith("build-map.json"):
        for repo, entry in data.get("repos", {}).items():
            for note in entry.get("notes", []) or []:
                chunks.append({
                    "heading": f"{repo} build notes",
                    "text": note,
                    "source": f"{relative}#{repo}.notes",
                    "kind": "hardstop" if "HARD STOP" in note.upper() else "convention",
                })
        for cmd in data.get("blocked_for_offshore", []) or []:
            chunks.append({
                "heading": "blocked_for_offshore",
                "text": cmd,
                "source": f"{relative}#blocked_for_offshore",
                "kind": "hardstop",
            })
    return chunks


def load_config_chunks(workspace: Path) -> list[dict]:
    """Fourth index source (plan §B.3): titan.config.json itself, so a query
    like "who owns search mappings" resolves from contacts.areas /
    protected_paths / contracts even when no markdown table mentions it."""
    if not titan_config:
        return []
    try:
        cfg = titan_config.load_config(workspace)
    except Exception:
        return []
    if not cfg:
        return []

    chunks: list[dict] = []

    areas = (cfg.get("contacts") or {}).get("areas") or {}
    for key in areas:
        try:
            info = titan_config.contacts_for(workspace, key)
        except Exception:
            info = {}
        if not info:
            continue
        text = (
            f"area: {key}\nlabel: {info.get('label', '')}\n"
            f"primary: {', '.join(info.get('primary') or [])}\n"
            f"secondary: {', '.join(info.get('secondary') or [])}"
        )
        chunks.append({
            "heading": f"contacts.areas.{key}",
            "text": text,
            "source": f"titan.config.json#contacts.areas.{key}",
            "kind": "contact",
        })

    for p in cfg.get("protected_paths", []) or []:
        if not isinstance(p, dict):
            continue
        if (p.get("enforcement") or {}).get("never_index"):
            continue  # metadata about a never-indexed path stays out too
        owners = [
            (cfg.get("contacts", {}).get("people", {}).get(pid) or {}).get("name", pid)
            for pid in p.get("owners", [])
        ]
        text = (
            f"id: {p.get('id','')}\nseverity: {p.get('severity','')}\n"
            f"owners: {', '.join(owners)}\nwhy: {p.get('why','')}\n"
            f"globs: {', '.join(p.get('globs', []))}"
        )
        chunks.append({
            "heading": f"protected_paths.{p.get('id','')}",
            "text": text,
            "source": f"titan.config.json#protected_paths.{p.get('id','')}",
            "kind": "hardstop" if (p.get("enforcement") or {}).get("hard_stop") else "contract",
        })

    for i, c in enumerate(cfg.get("contracts", []) or []):
        if not isinstance(c, dict):
            continue
        owners = [
            (cfg.get("contacts", {}).get("people", {}).get(pid) or {}).get("name", pid)
            for pid in c.get("owners", [])
        ]
        text = (
            f"contract: {c.get('name','')}\nowner_repo: {c.get('owner_repo','')}\n"
            f"consumer_repos: {', '.join(c.get('consumer_repos', []))}\nowners: {', '.join(owners)}"
        )
        chunks.append({
            "heading": f"contracts[{i}] {c.get('name','')}",
            "text": text,
            "source": f"titan.config.json#contracts[{i}]",
            "kind": "contract",
        })

    return chunks


# ── Scoring ─────────────────────────────────────────────────────────────────
def _tokenize(s: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", s.lower()))


def score_chunk(chunk: dict, query_tokens: set[str], file_arg: str | None, kind_filter: str | None) -> float:
    score = 0.0

    if file_arg and chunk.get("glob"):
        norm = file_arg.replace("\\", "/")
        if fnmatch.fnmatch(norm, chunk["glob"]) or fnmatch.fnmatch("/" + norm, "*/" + chunk["glob"].lstrip("*/")):
            score += 10.0  # exact path-glob match dominates, mirrors reviewer-map precedence

    if query_tokens:
        chunk_tokens = _tokenize(chunk.get("heading", "") + " " + chunk.get("text", ""))
        overlap = len(query_tokens & chunk_tokens)
        score += overlap * 1.0
        heading_tokens = _tokenize(chunk.get("heading", ""))
        score += len(query_tokens & heading_tokens) * 0.5  # heading match weighted extra

    if kind_filter:
        hints = KIND_HEADING_HINTS.get(kind_filter, ())
        heading_l = chunk.get("heading", "").lower()
        chunk_kind = chunk.get("kind", "")
        if chunk_kind == kind_filter or any(h in heading_l for h in hints):
            score += 2.0

    return score


def retrieve(workspace: Path, query: str, file_arg: str | None, kind_filter: str | None, top_k: int) -> dict:
    never_globs = never_index_globs(workspace)

    if file_arg and _is_never_index(file_arg, never_globs):
        return {
            "query": query, "file": file_arg, "kind": kind_filter, "k": top_k,
            "results": [],
            "redaction_note": "Path matches a never-indexed protected pattern — not indexed. Escalate per CLAUDE.md hard-stop table; do not read file contents.",
        }

    chunks: list[dict] = []
    chunks += load_claude_md_chunks(workspace)
    chunks += load_json_chunks(workspace, "data/reviewer-map.json", "contract", never_globs)
    chunks += load_json_chunks(workspace, "data/build-map.json", "hardstop", never_globs)
    chunks += load_config_chunks(workspace)

    query_tokens = _tokenize(query) if query else set()
    scored = [
        (score_chunk(c, query_tokens, file_arg, kind_filter), c)
        for c in chunks
        if not _is_never_index(c.get("source", ""), never_globs)
    ]
    scored = [(s, c) for s, c in scored if s > 0]
    scored.sort(key=lambda sc: -sc[0])

    results = [
        {
            "text": c["text"][:800],  # cap payload; this is a lookup, not a document dump
            "source": c["source"],
            "heading": c.get("heading", ""),
            "score": round(s, 2),
        }
        for s, c in scored[:top_k]
    ]
    return {"query": query, "file": file_arg, "kind": kind_filter, "k": top_k, "results": results}


# ── Telemetry (metadata-only, matches answer-cache.py emit_cache_hit shape) ──
def emit_gov_retrieve_event(workspace: Path, kind: str | None, hit_count: int, latency_ms: int) -> None:
    try:
        import datetime as _dt
        import hashlib
        import os
        if (workspace / ".no-telemetry").exists():
            return
        if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false"):
            return
        if titan_config:
            salt = titan_config.telemetry_salt(workspace)
        else:
            salt = "TITAN-DEFAULT-SALT"
        user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
        event = {
            "v": 1,
            "ts": _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "user": hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16],
            "role": os.environ.get("CLAUDE_ROLE", "unknown"),
            "tool": "_gov_retrieve",
            "session": os.environ.get("CLAUDE_SESSION_ID", "")[:32] or "noop",
            "meta": {"kind": kind or "free-text", "hit_count": hit_count, "latency_ms": latency_ms},
        }
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass  # fail-silent, never block the caller


def format_md(result: dict) -> str:
    if result.get("redaction_note"):
        return f"[gov-retrieve] {result['redaction_note']}"
    if not result["results"]:
        return f"[gov-retrieve] No governance match for query={result['query']!r} file={result['file']!r} kind={result['kind']!r}."
    lines = [f"[gov-retrieve] top {len(result['results'])} match(es):", ""]
    for r in result["results"]:
        lines.append(f"  ({r['score']})  {r['heading']}  — {r['source']}")
        lines.append(f"    {r['text'][:200].strip()}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    # Engineers run a mix of Windows terminals (cp1252/cp437 default console
    # codepage) and Unix shells. CLAUDE.md/data files contain em dashes and
    # other non-ASCII text verbatim, so a plain print() on a narrow Windows
    # codepage can raise UnicodeEncodeError or emit mojibake. Force UTF-8 on
    # stdout defensively; errors="replace" so this NEVER crashes the hook.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--query", default="")
    parser.add_argument("--file", default=None)
    parser.add_argument("--kind", default=None, choices=list(KIND_HEADING_HINTS.keys()) + [None])
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--format", default="json", choices=["json", "md"])
    try:
        args = parser.parse_args()
    except SystemExit:
        print(json.dumps({"results": [], "error": "bad-args"}))
        return 0

    import time
    t0 = time.monotonic()
    workspace = workspace_root()
    try:
        result = retrieve(workspace, args.query, args.file, args.kind, args.top_k)
    except Exception:
        print(json.dumps({"query": args.query, "file": args.file, "kind": args.kind, "k": args.top_k, "results": []}))
        return 0
    latency_ms = int((time.monotonic() - t0) * 1000)
    emit_gov_retrieve_event(workspace, args.kind, len(result.get("results", [])), latency_ms)

    if args.format == "md":
        print(format_md(result))
    else:
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
