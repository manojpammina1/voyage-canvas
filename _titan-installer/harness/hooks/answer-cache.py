"""
Titan answer-cache hook (UserPromptSubmit) — the zero-token fast path.

Deterministic lookups are answered LOCALLY and the prompt is blocked before it
ever reaches Claude — zero tokens spent. Exact-match triggers only (v1):

    ?build [module]     build command for the current repo/module
                        (harness/data/build-map.json — ported from /common/aem-build)
    ?reviewers          owners for the current diff (git diff --name-only vs base)
                        (harness/data/reviewer-map.json — ported from /common/diff-risk)
    ?ki <id-or-word>    known-issue lookup, exact id / whole-word keyword only
                        (.claude/known-issues/registry.jsonl — /prodsupport/known-issues)
    ?gov <query>        governance lookup with citation (hard-stops, owners, build notes)
                        (.claude/scripts/gov-retrieve.py — /common/gov-lookup, Phase 2
                        of the orchestrator feature suite)

Design contract:
  - Anything that is not one of the four trigger prefixes: instant no-op (exit 0).
  - Any resolver failure (unknown repo, git error/timeout, no registry): no-op —
    the prompt proceeds to the model. NEVER block on an error.
  - Hit: print {"decision":"block","reason":"<answer>"} to stdout, exit 0.
    Claude Code shows the reason to the user and does not call the model.
  - Emits a metadata-only `_cache_hit` telemetry event per hit:
        meta = { cache_type, avoided_cost_usd, latency_ms }
    avoided_cost_usd = rolling avg cost of `_actual_usage` events (last 30 days)
    — an ESTIMATE (labeled as such on the dashboard); the hit count is the fact.
  - Kill switch: TITAN_CACHE_DISABLED=1.
  - Fail-silent everywhere; this hook must never break a prompt.
"""
from __future__ import annotations

import datetime as _dt
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None

TRIGGERS = ("?build", "?reviewers", "?ki", "?gov")
GIT_TIMEOUT_S = 3


# ─────────────────────────────────────────────────────────────────────────
# Shared plumbing (mirrors cost-estimate.py / telemetry-emit.py conventions)
# ─────────────────────────────────────────────────────────────────────────
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


def diff_bases(workspace: Path) -> tuple[str, ...]:
    """Candidate base branches for `git diff`. Sourced from
    config.repos[].branches.base when available (each contributes both the
    bare name and an origin/-prefixed form), falling back to the generic
    develop/main pair so an unconfigured workspace still works."""
    bases: list[str] = []
    if titan_config:
        try:
            cfg = titan_config.load_config(workspace)
            for r in cfg.get("repos", []) or []:
                b = (r.get("branches") or {}).get("base")
                if b:
                    bases.extend([f"origin/{b}", b])
        except Exception:
            pass
    bases.extend(["origin/develop", "origin/main", "develop", "main"])
    seen: set[str] = set()
    out: list[str] = []
    for b in bases:
        if b not in seen:
            seen.add(b)
            out.append(b)
    return tuple(out)


def emit_cache_hit(workspace: Path, cache_type: str, avoided_cost_usd: float,
                   latency_ms: int, session: str) -> None:
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
            "tool": "_cache_hit",
            "session": (session or os.environ.get("CLAUDE_SESSION_ID", ""))[:32],
            "meta": {
                "cache_type": cache_type,                       # build | reviewer | known-issue | governance
                "avoided_cost_usd": round(avoided_cost_usd, 6), # ESTIMATE basis
                "latency_ms": latency_ms,
            },
        }
        tel = workspace / ".claude" / "telemetry"
        tel.mkdir(parents=True, exist_ok=True)
        f = tel / f"events-{_dt.date.today().isoformat()}.jsonl"
        with f.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, separators=(",", ":")) + "\n")
    except Exception:
        pass


def load_data_file(workspace: Path, name: str) -> dict:
    """harness data files are deployed to <workspace>/.claude/data/ by the
    installer; fall back to the harness source tree for maintainer runs."""
    for p in (
        workspace / ".claude" / "data" / name,
        Path(__file__).resolve().parent.parent / "data" / name,
    ):
        try:
            if p.exists():
                return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def avg_prompt_cost(workspace: Path) -> float:
    """Rolling average cost per _actual_usage event over the last 30 days.
    Fallback: a conservative default when no exact data exists yet."""
    total, n = 0.0, 0
    try:
        tel = workspace / ".claude" / "telemetry"
        cutoff = _dt.date.today() - _dt.timedelta(days=30)
        for f in sorted(tel.glob("events-*.jsonl")):
            try:
                day = f.name.replace("events-", "").replace(".uploaded", "").replace(".jsonl", "")
                if _dt.date.fromisoformat(day) < cutoff:
                    continue
            except ValueError:
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                try:
                    e = json.loads(line)
                    if e.get("tool") == "_actual_usage":
                        total += float(e.get("meta", {}).get("cost_usd", 0.0))
                        n += 1
                except Exception:
                    continue
    except Exception:
        pass
    return (total / n) if n else 0.02  # conservative default


# ─────────────────────────────────────────────────────────────────────────
# Repo detection — config.repos[].dir first, then whatever the calling
# resolver already knows about (build-map / reviewer-map keys), so
# ?reviewers still resolves a repo even when it has no build-map entry.
# ─────────────────────────────────────────────────────────────────────────
def detect_repo(cwd: str, workspace: Path, extra_names: list[str] | None = None) -> str | None:
    """Walk up from cwd; first path component whose name matches a known repo
    directory name."""
    names: set[str] = set(extra_names or [])
    if titan_config:
        try:
            names.update(titan_config.repo_dirs(workspace))
        except Exception:
            pass
    try:
        p = Path(cwd).resolve()
        for candidate in (p, *p.parents):
            if candidate.name in names:
                return candidate.name
    except Exception:
        pass
    return None


def git_root(cwd: str) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=GIT_TIMEOUT_S,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip())
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────────────
# Resolver: ?build
# ─────────────────────────────────────────────────────────────────────────
def resolve_build(cwd: str, arg: str, workspace: Path) -> str | None:
    data = load_data_file(workspace, "build-map.json")
    repos = data.get("repos", {})  # keyed by repo id; each entry carries "dir"
    if not repos:
        return None
    dir_to_id = {v.get("dir"): k for k, v in repos.items() if isinstance(v, dict) and v.get("dir")}
    repo_dir = detect_repo(cwd, workspace, extra_names=list(dir_to_id.keys()))
    if not repo_dir:
        return None
    repo_id = dir_to_id.get(repo_dir, repo_dir)
    entry = repos.get(repo_id)
    if not entry:
        return None

    label, commands, matched = "Default build", entry.get("default", []), False
    if arg:
        for m in entry.get("modules", []):
            if any(fnmatch.fnmatch(arg.lower(), pat.lower()) for pat in m.get("match", [])):
                label, commands, matched = m.get("label", arg), m.get("commands", []), True
                break
        if not matched:
            return None  # unknown module arg — let the full skill handle it
    if not commands:
        return None

    lines = [f"?build — {repo_dir} — {label}", ""]
    lines += [f"  {c}" for c in commands]
    notes = entry.get("notes", [])
    if notes:
        lines += [""] + [f"NOTE: {n}" for n in notes]
    blocked = data.get("blocked_for_offshore", [])
    if blocked:
        lines += ["", "Blocked for offshore developers:"] + [f"  - {b}" for b in blocked]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────
# Resolver: ?reviewers
# ─────────────────────────────────────────────────────────────────────────
def changed_files(root: Path, workspace: Path) -> list[str] | None:
    for base in diff_bases(workspace):
        try:
            chk = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "--verify", "--quiet", base],
                capture_output=True, text=True, timeout=GIT_TIMEOUT_S,
            )
            if chk.returncode != 0:
                continue
            out = subprocess.run(
                ["git", "-C", str(root), "diff", "--name-only", f"{base}...HEAD"],
                capture_output=True, text=True, timeout=GIT_TIMEOUT_S,
            )
            if out.returncode == 0:
                files = [l.strip() for l in out.stdout.splitlines() if l.strip()]
                if files:
                    return files
        except Exception:
            continue
    return None


def resolve_reviewers(cwd: str, workspace: Path) -> str | None:
    data = load_data_file(workspace, "reviewer-map.json")
    paths = data.get("paths", [])
    if not paths:
        return None
    root = git_root(cwd)
    if not root:
        return None
    files = changed_files(root, workspace)
    if not files:
        return None

    repo = detect_repo(str(root), workspace, extra_names=list(data.get("default_reviewers_by_repo", {}).keys()))
    owners: dict[str, int] = {}
    hard_stops: list[str] = []
    for f in files:
        norm = f.replace("\\", "/")
        matched_any = False
        for rule in paths:
            if fnmatch.fnmatch(norm, rule["glob"]) or fnmatch.fnmatch("/" + norm, "*/" + rule["glob"].lstrip("*/")):
                matched_any = True
                for o in rule.get("owners", []):
                    owners[o] = owners.get(o, 0) + 1
                if rule.get("sensitivity") == "CRITICAL":
                    hard_stops.append(f"{norm}  ({rule.get('why', '')})")
                break  # first (most specific, list-ordered) rule wins per file
        if not matched_any:
            pass  # falls to repo default below
    for o in data.get("default_reviewers_by_repo", {}).get(repo or "", []):
        owners.setdefault(o, 0)

    if not owners:
        return None
    lines = [f"?reviewers — {repo or root.name} — {len(files)} changed file(s) vs base", ""]
    for o, cnt in sorted(owners.items(), key=lambda kv: -kv[1]):
        lines.append(f"  {o}" + (f"  ({cnt} matched path(s))" if cnt else "  (repo default)"))
    if hard_stops:
        lines += ["", "HARD-STOP paths in this diff — Escalation Alert applies before PR:"]
        lines += [f"  ! {h}" for h in hard_stops]
    lines += ["", "Full risk scoring: /common/diff-risk"]
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────
# Resolver: ?ki
# ─────────────────────────────────────────────────────────────────────────
def known_issues_paths(workspace: Path) -> list[Path]:
    """Config-configurable location first, then the historical default."""
    candidates: list[Path] = []
    if titan_config:
        try:
            cfg = titan_config.load_config(workspace)
            rel = (cfg.get("data_files") or {}).get("known_issues")
            if rel:
                candidates.append(workspace / ".claude" / rel)
        except Exception:
            pass
    candidates.append(workspace / ".claude" / "known-issues" / "registry.jsonl")
    return candidates


def resolve_ki(term: str, workspace: Path) -> str | None:
    if not term:
        return None
    reg = None
    for cand in known_issues_paths(workspace):
        if cand.exists():
            reg = cand
            break
    if not reg:
        return None
    entries = []
    for line in reg.read_text(encoding="utf-8", errors="ignore").splitlines():
        try:
            entries.append(json.loads(line))
        except Exception:
            continue
    if not entries:
        return None

    tl = term.lower()
    exact = [e for e in entries if str(e.get("id", "")).lower() == tl]
    if not exact:
        # whole-word keyword match on symptom only — no fuzzy matching in v1
        exact = [
            e for e in entries
            if tl in str(e.get("symptom", "")).lower().replace(",", " ").replace(".", " ").split()
        ]
    if not exact:
        return None
    if len(exact) > 3:
        lines = [f"?ki — {len(exact)} matches for '{term}' — refine the term:", ""]
        lines += [f"  {e.get('id')}: {e.get('symptom', '')[:100]}" for e in exact[:3]]
        lines += ["  ...", "", "Full lookup: /prodsupport/known-issues"]
        return "\n".join(lines)

    lines = [f"?ki — {len(exact)} match(es) for '{term}'", ""]
    for e in exact:
        lines += [
            f"  id:         {e.get('id', '?')}   status: {e.get('status', '?')}",
            f"  symptom:    {e.get('symptom', '')}",
            f"  root cause: {e.get('rootCause', '')}",
            f"  workaround: {e.get('workaround', '')}",
            f"  fix:        {e.get('fixVersion', '')}   runbook: {e.get('runbook', '')}",
            "",
        ]
    lines.append("Full registry workflow: /prodsupport/known-issues")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────
# Resolver: ?gov — shells out to gov-retrieve.py (Phase 2). Kept as a separate
# process rather than an import so this hook has zero new import-time
# dependency on scripts/ existing at every deploy target; a missing script is
# just a resolver miss (None), never an error surfaced to the user.
# ─────────────────────────────────────────────────────────────────────────
def resolve_gov(term: str, workspace: Path) -> str | None:
    if not term:
        return None
    script = None
    for p in (
        workspace / ".claude" / "scripts" / "gov-retrieve.py",
        Path(__file__).resolve().parent.parent / "scripts" / "gov-retrieve.py",
    ):
        if p.exists():
            script = p
            break
    if not script:
        return None
    try:
        out = subprocess.run(
            [sys.executable, str(script), "--query", term, "--top-k", "3", "--format", "md"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=GIT_TIMEOUT_S,
        )
        if out.returncode != 0:
            return None
        text = out.stdout.strip()
        if not text or text.startswith("[gov-retrieve] No governance match"):
            return None  # miss — let the full model path try instead of asserting "not found" via cache
        return text
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────
def read_payload() -> dict:
    try:
        data = sys.stdin.read()
        if data:
            parsed = json.loads(data)
            if isinstance(parsed, dict):
                return parsed
    except Exception:
        pass
    return {}


def main() -> int:
    if os.environ.get("TITAN_CACHE_DISABLED", "").lower() in ("1", "true", "yes"):
        return 0

    payload = read_payload()
    prompt = str(payload.get("prompt") or payload.get("user_prompt") or "").strip()
    if not prompt or not prompt.startswith(TRIGGERS):
        return 0

    cwd = str(payload.get("cwd") or os.getcwd())
    session = str(payload.get("session_id") or "")
    workspace = workspace_root()
    t0 = time.monotonic()

    answer, cache_type = None, ""
    try:
        if prompt.startswith("?build"):
            cache_type = "build"
            answer = resolve_build(cwd, prompt[len("?build"):].strip(), workspace)
        elif prompt.startswith("?reviewers"):
            cache_type = "reviewer"
            answer = resolve_reviewers(cwd, workspace)
        elif prompt.startswith("?ki"):
            cache_type = "known-issue"
            answer = resolve_ki(prompt[len("?ki"):].strip(), workspace)
        elif prompt.startswith("?gov"):
            cache_type = "governance"
            answer = resolve_gov(prompt[len("?gov"):].strip(), workspace)
    except Exception:
        return 0  # resolver blew up — never block the prompt

    if not answer:
        return 0  # miss — prompt proceeds to the model

    latency_ms = int((time.monotonic() - t0) * 1000)
    emit_cache_hit(workspace, cache_type, avg_prompt_cost(workspace), latency_ms, session)
    print(json.dumps({
        "decision": "block",
        "reason": f"[answer-cache] zero-token deterministic answer ({latency_ms} ms)\n\n{answer}",
    }))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        sys.exit(0)
