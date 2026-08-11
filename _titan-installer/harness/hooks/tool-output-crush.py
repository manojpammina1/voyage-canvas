"""
Titan tool-output-crush hook (PostToolUse) — input-token compression.

Compresses large tool outputs BEFORE they enter the model's context via the
PostToolUse `updatedToolOutput` field. Two deterministic paths:

  JSON path  (vendored Headroom slice, _vendor/headroom_json, Apache-2.0):
      1. Titan array-sampler: arrays > 20 items -> first 3 + last 1 + count marker
      2. If still large: structure-mask elision — ALL keys/brackets/schema kept
         verbatim, long string values shortened to 48 chars (entropy-preserved
         tokens like IDs/hashes are kept by the vendored mask logic)
  LOG path   (Titan-native): non-JSON text >= 120 lines -> first 40 + last 60
      lines (errors cluster at the end of build logs) + elision marker.

Design contract (mirrors answer-cache.py):
  - Scope: Bash | Grep | mcp__* tool responses. Read/Edit/Write are NEVER
    touched — the model needs exact file content for Edit old_string matching.
  - Original output is ALWAYS spilled to .claude/tool-output-cache/<sha12>.txt
    before replacement; the compressed output ends with a pointer line so the
    model can `Read` the full version on demand (native retrieval — no proxy,
    no MCP server). Cache dir self-gitignores; entries older than 7 days pruned.
  - Only replaces output when savings >= 20% — otherwise silent no-op.
  - Skips: outputs < 2048 bytes (headroom min_size_bytes), outputs > 2 MB
    (hook latency guard), anything that fails to parse cleanly.
  - Kill switch: TITAN_CRUSH_DISABLED=1.
  - Telemetry: metadata-only `_crush` event (sizes + saved_pct — never content).
  - Fail-silent everywhere: any exception -> exit 0, output untouched.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "_vendor"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None

# Thresholds — ported from headroom config.py defaults (see _vendor provenance)
MIN_SIZE_BYTES = 2048        # headroom config.py:321 — skip small outputs
MAX_SIZE_BYTES = 2_000_000   # Titan: latency guard, never stall a tool result
ARRAY_SAMPLE_MIN = 20        # headroom min_items_to_cache — sample above this
ARRAY_KEEP_HEAD = 3
ARRAY_KEEP_TAIL = 1
STRING_VALUE_CAP = 48        # Titan: elided string values keep this many chars
MIN_SAVINGS_PCT = 20         # below this, compression is not worth the risk
LOG_MIN_LINES = 120
LOG_KEEP_HEAD = 40
LOG_KEEP_TAIL = 60
CACHE_TTL_DAYS = 7
CRUSHABLE_TOOLS = ("Bash", "Grep")           # exact names
CRUSHABLE_PREFIXES = ("mcp__",)              # any MCP tool
# Exempt from ALL crushing (2.4.1 pre-ship audit finding): the structure-mask
# path truncates string VALUES to STRING_VALUE_CAP (48 chars) regardless of
# semantic content. For a generic JSON blob that's a reasonable token-savings
# trade — for a Jira issue's Description/Acceptance Criteria field, it's a
# silent, invisible truncation of the exact text /qa-mode derives test cases
# from, with no signal to the model that anything was cut. Full exemption
# (not just a higher cap) because there is no length that is safe for
# free-text acceptance criteria — some run to paragraphs.
EXEMPT_PREFIXES = ("mcp__claude_ai_Atlassian_Rovo__",)
TEXT_FIELDS = ("stdout", "output", "content", "text", "result")


def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


def hashed_user(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.hashed_user(workspace)
        except Exception:
            pass
    salt = "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anon"
    return hashlib.sha256(f"{salt}:{user}".encode()).hexdigest()[:16]


def emit_crush_event(workspace: Path, session: str, meta: dict) -> None:
    """Metadata-only telemetry, same contract as answer-cache.py."""
    try:
        if (workspace / ".no-telemetry").exists():
            return
        if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false"):
            return
        event = {
            "v": 1,
            "ts": _dt.datetime.now(_dt.timezone.utc).isoformat().replace("+00:00", "Z"),
            "user": hashed_user(workspace),
            "role": os.environ.get("CLAUDE_ROLE", "unknown"),
            "tool": "_crush",
            "session": (session or os.environ.get("CLAUDE_SESSION_ID", ""))[:32],
            "meta": meta,
        }
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event) + "\n")
    except Exception:
        pass


def spill_original(workspace: Path, text: str) -> Path | None:
    """Save the uncompressed output so the model can Read it back on demand."""
    try:
        cache = workspace / ".claude" / "tool-output-cache"
        cache.mkdir(parents=True, exist_ok=True)
        gi = cache / ".gitignore"
        if not gi.exists():
            gi.write_text("*\n", encoding="utf-8")   # self-ignoring dir
        now = time.time()
        for old in cache.glob("*.txt"):              # best-effort TTL prune
            try:
                if now - old.stat().st_mtime > CACHE_TTL_DAYS * 86400:
                    old.unlink()
            except OSError:
                pass
        key = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:12]
        path = cache / f"{key}.txt"
        if not path.exists():
            path.write_text(text, encoding="utf-8", errors="replace")
        return path
    except Exception:
        return None


# ── JSON path ─────────────────────────────────────────────────────────────
def sample_arrays(obj, stats: dict):
    """Titan array-sampler: keep head+tail of long arrays, count the rest."""
    if isinstance(obj, dict):
        return {k: sample_arrays(v, stats) for k, v in obj.items()}
    if isinstance(obj, list):
        if len(obj) > ARRAY_SAMPLE_MIN:
            stats["arrays_sampled"] += 1
            head = [sample_arrays(x, stats) for x in obj[:ARRAY_KEEP_HEAD]]
            tail = [sample_arrays(x, stats) for x in obj[-ARRAY_KEEP_TAIL:]]
            marker = (f"…crushed: showing {ARRAY_KEEP_HEAD + ARRAY_KEEP_TAIL} "
                      f"of {len(obj)} items…")
            return head + [marker] + tail
        return [sample_arrays(x, stats) for x in obj]
    return obj


def elide_span(span: str) -> str:
    """compress_fn for apply_mask_to_text — shorten long non-structural spans."""
    if len(span) <= STRING_VALUE_CAP:
        return span
    return span[:STRING_VALUE_CAP] + f"…[{len(span) - STRING_VALUE_CAP} chars]"


def crush_json(text: str, stats: dict) -> str | None:
    try:
        parsed = json.loads(text)
    except (ValueError, RecursionError):
        return None
    sampled = sample_arrays(parsed, stats)
    out = json.dumps(sampled, indent=None, separators=(",", ":"),
                     ensure_ascii=False, default=str)
    if len(out) > MIN_SIZE_BYTES:
        # Structure-mask elision (vendored Headroom): schema verbatim,
        # long values shortened, high-entropy identifiers preserved.
        try:
            from headroom_json.json_handler import JSONStructureHandler
            from headroom_json.masks import apply_mask_to_text
            result = JSONStructureHandler().get_mask(out)
            out2 = apply_mask_to_text(out, result.mask, elide_span)
            if len(out2) < len(out):
                stats["mask_applied"] = True
                out = out2
        except Exception:
            pass  # sampler-only result still stands
    return out


# ── LOG path ──────────────────────────────────────────────────────────────
def crush_log(text: str, stats: dict) -> str | None:
    lines = text.splitlines()
    if len(lines) < LOG_MIN_LINES:
        return None
    elided = len(lines) - LOG_KEEP_HEAD - LOG_KEEP_TAIL
    stats["log_lines_elided"] = elided
    brand = titan_config.brand(workspace_root()) if titan_config else "Titan"
    return "\n".join(
        lines[:LOG_KEEP_HEAD]
        + [f"… [{elided} lines elided by {brand} crush] …"]
        + lines[-LOG_KEEP_TAIL:]
    )


# ── response extraction / rebuild ─────────────────────────────────────────
def content_block_texts(blocks) -> list[int]:
    """Indexes of MCP text blocks ({'type':'text','text':str}) in a list."""
    if not isinstance(blocks, list):
        return []
    return [i for i, b in enumerate(blocks)
            if isinstance(b, dict) and b.get("type") == "text"
            and isinstance(b.get("text"), str)]


def extract_text(response) -> tuple[str | None, str | None]:
    """Return (text, shape). shape tells rebuild() where the text came from:
    None = plain string, '__whole__' = serialized dict, '<field>' = dominant
    dict field, '__blocks__' = largest MCP content block (list or
    {'content': [...]} shape — how MCP tool results arrive in PostToolUse)."""
    if isinstance(response, str):
        return response, None
    if isinstance(response, list):
        idxs = content_block_texts(response)
        if idxs:
            big = max(idxs, key=lambda i: len(response[i]["text"]))
            return response[big]["text"], f"__blocks__{big}"
        return None, None
    if isinstance(response, dict):
        idxs = content_block_texts(response.get("content"))
        if idxs:
            big = max(idxs, key=lambda i: len(response["content"][i]["text"]))
            return response["content"][big]["text"], f"__blocks__{big}"
        total = len(json.dumps(response, default=str))
        for f in TEXT_FIELDS:
            v = response.get(f)
            if isinstance(v, str) and total and len(v) / total >= 0.7:
                return v, f
        return json.dumps(response, default=str), "__whole__"
    return None, None


def main() -> None:
    if os.environ.get("TITAN_CRUSH_DISABLED", "") == "1":
        return
    payload = json.load(sys.stdin)
    tool = payload.get("tool_name", "")
    if tool not in CRUSHABLE_TOOLS and not tool.startswith(CRUSHABLE_PREFIXES):
        return
    if tool.startswith(EXEMPT_PREFIXES):
        return
    response = payload.get("tool_response")
    text, field = extract_text(response)
    if text is None or not (MIN_SIZE_BYTES <= len(text) <= MAX_SIZE_BYTES):
        return

    stats = {"arrays_sampled": 0}
    crushed = crush_json(text, stats)
    mode = "json"
    if crushed is None:
        crushed = crush_log(text, stats)
        mode = "log"
    if crushed is None:
        return

    saved_pct = round(100 * (1 - len(crushed) / len(text)), 1)
    if saved_pct < MIN_SAVINGS_PCT:
        return

    spill = spill_original(workspace_root(), text)
    pointer = f"\n[crushed {saved_pct}% — full output: Read {spill}]" if spill else ""
    if field and field.startswith("__blocks__"):
        # MCP content-block shape: swap the crushed text into the same block,
        # keep every other block and the envelope untouched.
        idx = int(field[len("__blocks__"):])
        blocks = response if isinstance(response, list) else list(response["content"])
        blocks = [dict(b) if isinstance(b, dict) else b for b in blocks]
        blocks[idx]["text"] = crushed + pointer
        rebuilt = blocks if isinstance(response, list) else {**response, "content": blocks}
        new_output = json.dumps(rebuilt, ensure_ascii=False, default=str)
    elif field and field != "__whole__" and isinstance(response, dict):
        rebuilt = dict(response)
        rebuilt[field] = crushed + pointer
        new_output = json.dumps(rebuilt, ensure_ascii=False, default=str)
    else:
        new_output = crushed + pointer

    emit_crush_event(workspace_root(), payload.get("session_id", ""), {
        "tool": tool, "mode": mode,
        "orig_bytes": len(text), "crushed_bytes": len(crushed),
        "saved_pct": saved_pct, **stats,
    })
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "updatedToolOutput": new_output,
        }
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail-silent: never break a tool result
    sys.exit(0)
