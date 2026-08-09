#!/usr/bin/env python3
"""
Titan — EXACT token usage capture (Stop hook).

Fires when Claude finishes a turn. Claude Code's Stop-hook payload does NOT
carry token counts inline — it carries `transcript_path`. The exact usage that
Anthropic bills for lives in the transcript: each assistant message has a
`message.usage` object (input/output/cache tokens) and `message.model`.

This hook reads ONLY those numeric usage fields + the model string from the
transcript and emits one `_actual_usage` event per new assistant message.

────────────────────────────────────────────────────────────────────────────
SECURITY CONTRACT — METADATA ONLY (do not weaken):
  This hook reads the transcript, which contains full prompts, responses, file
  contents, and potentially secrets/PII. It MUST extract ONLY:
      - message.usage.{input_tokens, output_tokens,
                       cache_creation_input_tokens, cache_read_input_tokens}
      - message.model
      - message timestamp / type
  It MUST NEVER read, store, log, or emit message CONTENT (text, tool inputs,
  tool results, file bodies). The emitted event and the cursor file contain
  only integers, a model label, a hashed user id, and a session id.
────────────────────────────────────────────────────────────────────────────

Stop hook payload (stdin JSON from Claude Code):
{
  "session_id": "...",
  "transcript_path": "/abs/path/to/<session>.jsonl",
  "stop_hook_active": true,
  "hook_event_name": "Stop",
  "cwd": "..."
}

De-duplication (TWO layers — both required):
  1. A per-session byte-offset cursor records how far into the transcript we
     have already processed (efficiency + cross-run safety).
  2. A per-session set of already-counted `message.id`s. Claude Code writes
     MULTIPLE transcript records per assistant message (one per content block —
     text, tool_use, ...), and every record repeats the SAME cumulative usage.
     Counting per-record over-counts (~2x). We count each message.id ONCE.
State lives in .claude/telemetry/.usage-cursor.json:
  { "<session_id>": { "o": <byte_offset>, "ids": ["msg_..","..."] } }
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


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

def is_disabled(workspace: Path) -> bool:
    if (workspace / ".no-telemetry").exists(): return True
    if os.environ.get("CLAUDE_TELEMETRY", "").lower() in ("off", "0", "false"): return True
    try:
        sj = workspace / ".claude" / "settings.local.json"
        if sj.exists():
            cfg = json.loads(sj.read_text(encoding="utf-8"))
            if str((cfg.get("env") or {}).get("CLAUDE_TELEMETRY","")).lower() in ("off","0","false"):
                return True
    except Exception: pass
    return False


def model_cost_usd(model: str, in_tok: int, out_tok: int,
                   cache_create: int, cache_read: int) -> float:
    """Exact USD cost from real token counts + known Anthropic list prices."""
    RATES = {
        "claude-opus-4-7":   (15.00, 75.00, 15.00, 1.50),
        "claude-opus-4-8":   (15.00, 75.00, 15.00, 1.50),
        "claude-sonnet-4-6": ( 3.00, 15.00,  3.75, 0.30),
        "claude-sonnet-4-7": ( 3.00, 15.00,  3.75, 0.30),
        "claude-haiku-4-5":  ( 0.25,  1.25,  0.30, 0.03),
    }
    rate = None
    for key, vals in RATES.items():
        if key in model or model in key:
            rate = vals; break
    if not rate:
        rate = (3.00, 15.00, 3.75, 0.30)  # Sonnet default

    inp_per_1m, out_per_1m, cache_write_per_1m, cache_read_per_1m = rate
    return (
        in_tok          / 1_000_000 * inp_per_1m
        + out_tok       / 1_000_000 * out_per_1m
        + cache_create  / 1_000_000 * cache_write_per_1m
        + cache_read    / 1_000_000 * cache_read_per_1m
    )


def write_event(workspace: Path, event: dict) -> None:
    try:
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass


def _load_cursor(tel: Path, session_id: str) -> tuple[dict, Path, int, set]:
    cf = tel / ".usage-cursor.json"
    data: dict = {}
    try:
        if cf.exists():
            data = json.loads(cf.read_text(encoding="utf-8")) or {}
    except Exception:
        data = {}
    ent = data.get(session_id)
    if isinstance(ent, dict):
        return data, cf, int(ent.get("o", 0) or 0), set(ent.get("ids", []) or [])
    if isinstance(ent, int):          # backward-compat with old int-only cursor
        return data, cf, ent, set()
    return data, cf, 0, set()


def _save_cursor(cf: Path, data: dict, session_id: str, offset: int, seen: set) -> None:
    try:
        ids = list(seen)
        if len(ids) > 20000:          # bound file growth per session
            ids = ids[-20000:]
        data[session_id] = {"o": offset, "ids": ids}
        cf.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    except Exception:
        pass


def main() -> int:
    workspace = workspace_root()
    if is_disabled(workspace): return 0

    # Read Stop hook payload from stdin
    payload: dict = {}
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read()
            if raw.strip():
                payload = json.loads(raw)
    except Exception:
        return 0

    tp = payload.get("transcript_path")
    if not tp:
        return 0
    tpath = Path(tp)
    if not tpath.is_file():
        return 0

    # Fixed in the 2.4.1 pre-ship audit: this used [:64] (the full 36-char
    # session UUID fits under that with room to spare) while every other
    # producer (telemetry-capture.py, cost-estimate.py, correction-signal.py,
    # correction-scan.py, tool-output-crush.py, answer-cache.py,
    # telemetry-emit.py) truncates to [:32] — same session, two different
    # IDs in the event stream. Consequences on the dashboard: sessions count
    # ~2x overcounted (aggregations.ts), and correction-episode reconstruction
    # buckets _actual_usage events separately from the _correction/tool-error
    # events that should share the same session bucket, so wastedCostUsd
    # comes out ~0 even when real rework happened. Standardized to [:32].
    session_id = (str(payload.get("session_id", "")) or "default")[:32]
    tel = workspace / ".claude" / "telemetry"
    try:
        tel.mkdir(parents=True, exist_ok=True)
    except Exception:
        return 0

    data, cf, offset, seen_ids = _load_cursor(tel, session_id)

    # Read only the NEW bytes since last processed (binary — Windows-safe offsets).
    try:
        size = tpath.stat().st_size
        if offset > size:          # transcript rotated/truncated → restart
            offset = 0
        with tpath.open("rb") as fh:
            fh.seek(offset)
            chunk = fh.read()
            new_offset = fh.tell()
    except Exception:
        return 0

    role = os.environ.get("CLAUDE_ROLE", "unknown")
    user = hashed_user(workspace)

    for line in chunk.split(b"\n"):
        if not line.strip():
            continue
        try:
            rec = json.loads(line.decode("utf-8", "ignore"))
        except Exception:
            continue
        # Only assistant records carry billable usage. Ignore everything else.
        if rec.get("type") != "assistant":
            continue
        msg = rec.get("message") or {}
        usage = msg.get("usage") or {}
        if not usage:
            continue

        # ── DEDUP by message.id — multiple records repeat the same usage ──
        mid = str(msg.get("id") or "")
        if mid and mid in seen_ids:
            continue                      # already counted this message

        # ── FIELD-SCOPED EXTRACTION — integers + model only, never content ──
        in_tok       = int(usage.get("input_tokens", 0) or 0)
        out_tok      = int(usage.get("output_tokens", 0) or 0)
        cache_create = int(usage.get("cache_creation_input_tokens", 0) or 0)
        cache_read   = int(usage.get("cache_read_input_tokens", 0) or 0)
        if in_tok == 0 and out_tok == 0 and cache_create == 0 and cache_read == 0:
            continue

        model = str(msg.get("model", "unknown"))
        ts    = str(rec.get("timestamp") or (_dt.datetime.utcnow().isoformat() + "Z"))
        cost  = model_cost_usd(model, in_tok, out_tok, cache_create, cache_read)

        if mid:
            seen_ids.add(mid)             # mark counted — later records of this msg are skipped

        write_event(workspace, {
            "v": 1,
            "ts": ts,
            "user": user,
            "role": role,
            "tool": "_actual_usage",           # dashboard queries this field
            "session": session_id,
            "meta": {
                "source": "stop_hook_transcript",   # exact — not an estimate
                "model": model,
                "input_tokens":          in_tok,
                "output_tokens":         out_tok,
                "cache_creation_tokens": cache_create,
                "cache_read_tokens":     cache_read,
                # Fixed in the 2.4.1 pre-ship audit: this excluded
                # cache_read_tokens, but the dashboard uses total_tokens as
                # the full-period denominator for reworkTokenRatio
                # (aggregations.ts). Cache-read tokens are real, billed
                # volume — a long-running session's cache_read count
                # routinely dwarfs input+output+cache_create (seen in
                # practice: 1,741 vs 826,407), so omitting it inflated the
                # rework ratio by orders of magnitude.
                "total_tokens":          in_tok + out_tok + cache_create + cache_read,
                "cost_usd":              round(cost, 6),
            },
        })

    _save_cursor(cf, data, session_id, new_offset, seen_ids)
    return 0


if __name__ == "__main__":
    try: sys.exit(main())
    except Exception: sys.exit(0)
