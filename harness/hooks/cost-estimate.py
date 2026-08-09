#!/usr/bin/env python3
"""
Titan -- Pre-flight cost & token estimator (UserPromptSubmit hook).

Shows token / USD estimates before a Claude prompt fires. Surfaces cheaper
alternatives (org general-chat alternative, Haiku tier) when the estimate
exceeds configured thresholds.

Design rules (per "do not frustrate with prompts"):
  - Hook NEVER blocks for cost reasons -- it informs.
  - User keeps full control: Ctrl+C aborts the streaming response.
  - Below threshold: silent (no notice).
  - Above warn threshold: inline notice with estimate + alternatives.
  - Above loud threshold ($1+ default): same notice with stronger wording.
  - /arch-mode is exempt from cost warnings (user intentionally on Opus).

SAFETY exception: the hook DOES block (exit non-zero) if the prompt itself
contains a hard-stop pattern -- either an org-neutral secret-format shape
(PAT, private key, cloud key) hardcoded below, or a titan.config.json
protected_paths[] entry with enforcement.block_prompt=true. That's a
security rule, not a cost rule.

Telemetry: every fire writes a `cost_estimate` event (metadata only).

Inputs (UserPromptSubmit contract):
  - Reads JSON from stdin OR env CLAUDE_USER_PROMPT
  - Best-effort: tokenizes the prompt + carrier overhead

Outputs:
  - stdout: human-readable notice (shown to user before Claude responds)
  - exit 0 always for cost concerns
  - exit 1 only for sensitive-prompt block (security)
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


# ─────────────────────────────────────────────────────────────────────────
# Fail-silent decorator
# ─────────────────────────────────────────────────────────────────────────
def _fail_silent(default_return: int = 0):
    def deco(fn):
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except Exception:
                return default_return
        return wrapper
    return deco


# ─────────────────────────────────────────────────────────────────────────
# Workspace + config
# ─────────────────────────────────────────────────────────────────────────
def workspace_root() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())


@_fail_silent(default_return={})
def load_pricing(workspace: Path) -> dict:
    """Read harness/pricing.json from workspace (deployed at install)."""
    candidates = [
        workspace / ".claude" / "pricing.json",
        workspace / "pricing.json",
    ]
    for p in candidates:
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    return {}


def env_override_float(var: str, default: float) -> float:
    try:
        v = os.environ.get(var, "").strip()
        return float(v) if v else default
    except ValueError:
        return default


def env_override_int(var: str, default: int) -> int:
    try:
        v = os.environ.get(var, "").strip()
        return int(v) if v else default
    except ValueError:
        return default


def env_truthy(var: str) -> bool:
    return os.environ.get(var, "").lower() in ("1", "true", "yes", "on")


# ─────────────────────────────────────────────────────────────────────────
# Tokenizer (best-effort: tiktoken if available, char/3.5 heuristic else)
# ─────────────────────────────────────────────────────────────────────────
@_fail_silent(default_return=None)
def _try_tiktoken_encode(text: str) -> int | None:
    """Return token count via tiktoken cl100k_base, or None if unavailable."""
    try:
        import tiktoken  # type: ignore
    except ImportError:
        return None
    enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def count_tokens(text: str) -> tuple[int, str]:
    """Return (count, source). Source = 'tiktoken' or 'heuristic'."""
    if not text:
        return 0, "empty"
    n = _try_tiktoken_encode(text)
    if n is not None:
        return n, "tiktoken"
    # Heuristic: ~3.5 chars per token for English / code mix
    return max(1, len(text) // 3), "heuristic"


def estimate_full_context_tokens(user_prompt: str, carrier_fallback: int = 15_000) -> tuple[int, int, str]:
    """Return (user_tokens, total_context_tokens, source_label).

    Reads the active Claude Code session messages file from ~/.claude/projects/
    to tokenize the FULL context window -- not just the user's new message.
    This gives a much more accurate cost estimate that matches Anthropic billing.

    Falls back to a carrier estimate (pricing.json carrier_token_overhead,
    default 15K) if the session file can't be found.
    """
    user_tokens, tok_src = count_tokens(user_prompt)

    try:
        claude_projects = Path.home() / '.claude' / 'projects'
        if not claude_projects.exists():
            raise FileNotFoundError

        session_files = sorted(
            claude_projects.glob('**/messages.jsonl'),
            key=lambda p: p.stat().st_mtime,
            reverse=True
        )
        if not session_files:
            raise FileNotFoundError

        lines = session_files[0].read_text(encoding='utf-8', errors='ignore').strip().split('\n')
        texts: list[str] = []
        for line in lines[-200:]:
            try:
                msg = json.loads(line)
                content = msg.get('content', '')
                if isinstance(content, str) and content:
                    texts.append(content)
                elif isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get('type') == 'text':
                            t = str(block.get('text', ''))
                            if t:
                                texts.append(t)
            except Exception:
                pass

        if texts:
            ctx_tokens, _ = count_tokens('\n'.join(texts) + '\n' + user_prompt)
            ctx_tokens = max(ctx_tokens, user_tokens)
            return user_tokens, ctx_tokens, f'{tok_src}+session-context'

    except Exception:
        pass

    # Fallback: carrier (pricing.json carrier_token_overhead) is a conservative
    # floor for an active Claude Code session. Real sessions are often 20K-80K+.
    return user_tokens, user_tokens + carrier_fallback, f'{tok_src}+carrier-{carrier_fallback // 1000}k'


# ─────────────────────────────────────────────────────────────────────────
# Sensitive prompt detection (safety, not cost)
#
# FLOOR_PATTERNS are org-neutral secret-*format* facts (credential shapes),
# always active regardless of config -- same posture as protect-secrets.py's
# hardcoded floor. CONFIG-DERIVED patterns come from titan.config.json
# protected_paths[] entries with enforcement.block_prompt=true (fail-open:
# if config/titan_config is unavailable, the floor alone still applies).
# ─────────────────────────────────────────────────────────────────────────
FLOOR_PATTERNS = [
    (re.compile(r"\b(pat|ado|aps)_[A-Za-z0-9_-]{30,}\b", re.I), "PAT-like token"),
    (re.compile(r"\bfigd_[A-Za-z0-9_-]{30,}\b"), "Figma PAT"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "GitHub token"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key ID"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "Slack token"),
    (re.compile(r"-----BEGIN (RSA |OPENSSH |EC |DSA |ENCRYPTED |)PRIVATE KEY-----"), "Private key block"),
]


@_fail_silent(default_return=[])
def build_sensitive_patterns(workspace: Path) -> list[tuple]:
    patterns = list(FLOOR_PATTERNS)
    if not titan_config:
        return patterns
    try:
        protected = titan_config.load_protected(workspace).get("paths", []) or []
        for entry in protected:
            if not isinstance(entry, dict):
                continue
            if not (entry.get("enforcement") or {}).get("block_prompt"):
                continue
            rx = titan_config.globs_to_regex(entry.get("globs", []))
            if rx:
                label = entry.get("why") or entry.get("id") or "protected path"
                patterns.append((rx, label))
    except Exception:
        pass
    return patterns


def scan_sensitive(prompt: str, patterns: list[tuple]) -> list[str]:
    """Return list of finding labels (empty if clean)."""
    hits: list[str] = []
    for pat, label in patterns:
        if pat.search(prompt):
            hits.append(label)
    return hits


# ─────────────────────────────────────────────────────────────────────────
# Output-token range heuristic
# ─────────────────────────────────────────────────────────────────────────
def classify_prompt(prompt: str, pricing: dict) -> tuple[str, int, int]:
    """Return (class, output_min, output_max)."""
    text = prompt.lower()
    cls_table = pricing.get("prompt_class_heuristics", {})
    # Order matters -- most specific first
    for cls in ("code_generation", "code_review", "refactor", "architecture", "qa_short"):
        cfg = cls_table.get(cls, {})
        if any(kw in text for kw in cfg.get("match_keywords", [])):
            return cls, int(cfg["output_min"]), int(cfg["output_max"])
    # Heuristic for yes/no: short + ends with ?
    if len(text) < 200 and text.strip().endswith("?"):
        cfg = cls_table.get("yes_no", {"output_min": 50, "output_max": 200})
        return "yes_no", int(cfg["output_min"]), int(cfg["output_max"])
    default = cls_table.get("default", {"output_min": 500, "output_max": 1500})
    return "default", int(default["output_min"]), int(default["output_max"])


# ─────────────────────────────────────────────────────────────────────────
# Cost calc
# ─────────────────────────────────────────────────────────────────────────
def cost_for_model(pricing: dict, model_id: str, in_tokens: int, out_tokens: int) -> float:
    models = pricing.get("models", {})
    m = models.get(model_id) or models.get("default") or {"input_per_1m": 3.0, "output_per_1m": 15.0}
    return (in_tokens / 1_000_000) * float(m["input_per_1m"]) + (out_tokens / 1_000_000) * float(m["output_per_1m"])


def all_model_costs(pricing: dict, in_tokens: int, out_mid: int) -> list[tuple[str, str, float]]:
    """Return [(model_id, label, cost), ...] sorted ascending. Skip 'default'."""
    rows = []
    for mid, info in pricing.get("models", {}).items():
        if mid == "default":
            continue
        rows.append((mid, info.get("label", mid), cost_for_model(pricing, mid, in_tokens, out_mid)))
    return sorted(rows, key=lambda r: r[2])


# ─────────────────────────────────────────────────────────────────────────
# Telemetry passthrough -- write a cost_estimate event next to other events
# ─────────────────────────────────────────────────────────────────────────
@_fail_silent(default_return=None)
def emit_telemetry(workspace: Path, event: dict) -> None:
    tel_dir = workspace / ".claude" / "telemetry"
    if not tel_dir.exists():
        return
    today = _dt.date.today().isoformat()
    out_file = tel_dir / f"events-{today}.jsonl"
    with out_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, separators=(",", ":")) + "\n")


def hashed_user_id(workspace: Path) -> str:
    if titan_config:
        try:
            return titan_config.hashed_user(workspace)
        except Exception:
            pass
    salt = "TITAN-DEFAULT-SALT"
    user = os.environ.get("USERNAME") or os.environ.get("USER") or "anonymous"
    return hashlib.sha256(f"{salt}:{user}".encode("utf-8")).hexdigest()[:16]


# ─────────────────────────────────────────────────────────────────────────
# Read user prompt (UserPromptSubmit contract)
# ─────────────────────────────────────────────────────────────────────────
def read_user_prompt() -> str:
    """UserPromptSubmit hooks receive the prompt via stdin (JSON) per Claude
    Code spec. Fall back to env CLAUDE_USER_PROMPT or CLAUDE_TOOL_INPUT."""
    try:
        if not sys.stdin.isatty():
            data = sys.stdin.read()
            if data:
                try:
                    parsed = json.loads(data)
                    if isinstance(parsed, dict):
                        return str(parsed.get("prompt") or parsed.get("user_prompt") or parsed.get("message") or "")
                except json.JSONDecodeError:
                    return data
    except Exception:
        pass

    for env in ("CLAUDE_USER_PROMPT", "CLAUDE_TOOL_INPUT"):
        v = os.environ.get(env, "")
        if v:
            try:
                parsed = json.loads(v)
                if isinstance(parsed, dict):
                    return str(parsed.get("prompt") or parsed.get("user_prompt") or "")
            except Exception:
                return v
    return ""


# ─────────────────────────────────────────────────────────────────────────
# Session-running cost (running total in same workspace)
# ─────────────────────────────────────────────────────────────────────────
@_fail_silent(default_return={})
def read_session_cost(workspace: Path) -> dict:
    p = workspace / ".claude" / ".session-cost.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


@_fail_silent(default_return=None)
def update_session_cost(workspace: Path, session_id: str, add_min: float, add_max: float) -> dict:
    p = workspace / ".claude" / ".session-cost.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    data = read_session_cost(workspace)
    sess = data.get(session_id, {"prompts": 0, "est_min": 0.0, "est_max": 0.0, "started": _dt.datetime.utcnow().isoformat() + "Z"})
    sess["prompts"] = int(sess.get("prompts", 0)) + 1
    sess["est_min"] = float(sess.get("est_min", 0.0)) + float(add_min)
    sess["est_max"] = float(sess.get("est_max", 0.0)) + float(add_max)
    sess["last"] = _dt.datetime.utcnow().isoformat() + "Z"
    data[session_id] = sess
    p.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return sess


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────
def main() -> int:
    workspace = workspace_root()

    # Disabled entirely?
    if env_truthy("TITAN_COST_DISABLED"):
        return 0

    brand = titan_config.brand(workspace) if titan_config else "Titan"
    alt_chat = "your org's general-chat assistant"
    if titan_config:
        try:
            alt_chat = (titan_config.load_config(workspace).get("platforms") or {}).get("general_chat_alternative") or alt_chat
        except Exception:
            pass

    pricing = load_pricing(workspace)
    if not pricing:
        return 0  # No pricing config -- silently skip

    prompt = read_user_prompt()

    # ── Safety: sensitive-prompt scan (this DOES block) ─────────────────
    if prompt:
        patterns = build_sensitive_patterns(workspace)
        hits = scan_sensitive(prompt, patterns)
        if hits:
            sys.stderr.write(
                f"[{brand} security] Prompt contains a hard-stop pattern; refusing to send to Claude.\n"
                f"Detected: {', '.join(hits)}\n"
                "If the file path is informational only, paraphrase it (e.g. 'the SAML JKS file' instead of the literal path).\n"
                "Secrets, private keys, and access tokens must NEVER be pasted into a prompt.\n"
            )
            return 1

    # Non-interactive (CI / scheduled run): silent, telemetry only
    is_tty = sys.stdout.isatty() if hasattr(sys.stdout, "isatty") else True

    if not prompt:
        # Nothing to estimate -- telemetry the empty fire, exit
        emit_telemetry(workspace, {
            "v": 1,
            "ts": _dt.datetime.utcnow().isoformat() + "Z",
            "user": hashed_user_id(workspace),
            "role": os.environ.get("CLAUDE_ROLE", "unknown"),
            "tool": "_cost_estimate",
            "meta": {"reason": "no_prompt_payload"}
        })
        return 0

    # ── Tokenize -- use FULL context window, not just new prompt ─────────
    carrier = int(pricing.get("thresholds", {}).get("carrier_token_overhead", 15_000))
    user_tokens, input_tokens, tok_src = estimate_full_context_tokens(prompt, carrier)

    # ── Output range from prompt class ────────────────────────────────
    cls, out_min, out_max = classify_prompt(prompt, pricing)
    out_mid = (out_min + out_max) // 2

    # ── Cost calc for active model ────────────────────────────────────
    model_id = os.environ.get("CLAUDE_MODEL") or pricing.get("models", {}).get("default", {}).get("label", "default")
    if not model_id:
        model_id = "default"
    if model_id in ("opus",):    model_id = "claude-opus-4-7"
    if model_id in ("sonnet",):  model_id = "claude-sonnet-4-6"
    if model_id in ("haiku",):   model_id = "claude-haiku-4-5"

    cost_min = cost_for_model(pricing, model_id, input_tokens, out_min)
    cost_max = cost_for_model(pricing, model_id, input_tokens, out_max)

    # ── Thresholds (with env overrides) ──────────────────────────────
    warn_usd  = env_override_float("TITAN_COST_THRESHOLD_USD", float(pricing.get("thresholds", {}).get("warn_cost_usd",  0.05)))
    warn_tok  = env_override_int  ("TITAN_COST_THRESHOLD_TOKENS", int(pricing.get("thresholds", {}).get("warn_tokens", 10000)))
    loud_usd  = env_override_float("TITAN_COST_LOUD_USD",      float(pricing.get("thresholds", {}).get("loud_cost_usd", 1.00)))
    always    = env_truthy("TITAN_COST_ALWAYS_SHOW")

    # ── Mode-aware: skip warn for high-cost modes like /arch-mode ────
    role = os.environ.get("CLAUDE_ROLE", "")
    mode_cfg = pricing.get("modes", {}).get(role, {})
    skip_warn_for_mode = bool(mode_cfg.get("skip_warn", False))

    should_show = always or (cost_max >= warn_usd) or (input_tokens >= warn_tok)
    if skip_warn_for_mode and cost_max < loud_usd:
        should_show = always

    # ── Running session cost ─────────────────────────────────────────
    session_id = (os.environ.get("CLAUDE_SESSION_ID", "") or "noop")[:32]
    sess = update_session_cost(workspace, session_id, cost_min, cost_max) or {}

    # ── Telemetry: every fire ─────────────────────────────────────────
    emit_telemetry(workspace, {
        "v": 1,
        "ts": _dt.datetime.utcnow().isoformat() + "Z",
        "user": hashed_user_id(workspace),
        "role": role or "unknown",
        "tool": "_cost_estimate",
        "session": session_id,
        "meta": {
            "user_tokens": user_tokens,
            "input_tokens": input_tokens,
            "out_min": out_min,
            "out_max": out_max,
            "cost_min_usd": round(cost_min, 6),
            "cost_max_usd": round(cost_max, 6),
            "model": model_id,
            "class": cls,
            "tokenizer": tok_src,
            "shown_to_user": bool(should_show and is_tty),
        }
    })

    if not is_tty:
        return 0
    if not should_show:
        return 0

    # ── Build the notice ─────────────────────────────────────────────
    loud = cost_max >= loud_usd
    model_label = pricing.get("models", {}).get(model_id, {}).get("label", model_id)

    comparisons = all_model_costs(pricing, input_tokens, out_mid)
    other_models = [(mid, lbl, c) for (mid, lbl, c) in comparisons if mid != model_id][:3]

    lines = []
    if loud:
        lines.append(f"[{brand} cost -- loud warning]")
    else:
        lines.append(f"[{brand} cost estimate]")
    lines.append(f"  Model:      {model_label}")
    lines.append(f"  Input:      ~{input_tokens:,} tokens ({tok_src})")
    lines.append(f"  Output:     ~{out_min:,} - {out_max:,} tokens (class: {cls})")
    lines.append(f"  Cost:       ${cost_min:.4f} - ${cost_max:.4f}")
    if sess:
        lines.append(f"  Session:    {sess.get('prompts', 0)} prompts so far, ~${sess.get('est_max', 0):.2f} total")

    lines.append("")
    lines.append("  Cheaper alternatives:")
    for mid, lbl, c in other_models:
        lines.append(f"    - {lbl:<14} ~${c:.4f}    /model {mid.split('-')[1] if '-' in mid else mid}")
    lines.append(f"    - {alt_chat} (free)    /common/copilot")

    if loud:
        lines.append("")
        lines.append("  This is a $1+ call. Confirm it needs Claude -- if it's general Q&A, use the free alternative.")
        lines.append("  Press Ctrl+C now to abort, or let it continue.")

    lines.append("")
    sys.stdout.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)  # absolute fail-silent
