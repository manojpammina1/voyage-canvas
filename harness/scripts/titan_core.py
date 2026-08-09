#!/usr/bin/env python3
"""Titan governance core — shared render primitives and block generators.

Loaded by titan-render.py adapters. Zero third-party deps — no templating engine.
Two primitives:

1. Scalar substitution — {{org.name}}, {{platforms.scm.base_url}},
   {{contacts.areas.aem.primary.0.name}}. Dotted paths, ``.N`` for array
   index, and any ``contacts.people`` id encountered mid-path is
   auto-dereferenced to ``.name``. Same convention as titan-config.py's
   resolve_path — ported here rather than diverged.
2. Named generated blocks — ``<!-- titan:block NAME -->`` ... content ...
   ``<!-- /titan:block NAME -->``. Only the content between the markers is
   replaced, so re-running the renderer is idempotent and hand-written prose
   around the markers is left alone.

"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
HARNESS_DIR = SCRIPTS_DIR.parent
GOVERNANCE_DIR = HARNESS_DIR / "governance"
CLAUDE_TEMPLATES_DIR = HARNESS_DIR / "adapters" / "claude" / "templates"
LEGACY_TEMPLATES_DIR = HARNESS_DIR / "templates"


def _resolve_templates_dir(templates_dir: Path | None = None) -> Path:
    if templates_dir is not None:
        return templates_dir
    if (CLAUDE_TEMPLATES_DIR / "CLAUDE.md.tmpl").is_file():
        return CLAUDE_TEMPLATES_DIR
    return LEGACY_TEMPLATES_DIR


def _load_yaml(path: Path) -> dict:
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8")
    return _parse_simple_yaml(text)


def _parse_simple_yaml(text: str) -> dict:
    """Minimal YAML subset loader (stdlib only) — enough for controls/model-tiers."""
    try:
        import yaml  # noqa: F401 — not available; fall through
    except ImportError:
        pass
    # Hand-rolled parser for our flat list-of-maps YAML files
    if path_looks_like_json(text):
        return json.loads(text)
    return _hand_parse_yaml(text)


def path_looks_like_json(text: str) -> bool:
    t = text.lstrip()
    return t.startswith("{") or t.startswith("[")


def _hand_parse_yaml(text: str) -> dict:
    """Parse the small governance YAML files without PyYAML."""
    result: dict = {}
    current_key = None
    current_list: list | None = None
    current_item: dict | None = None
    nested_key: str | None = None
    nested_dict: dict | None = None

    def flush_item():
        nonlocal current_item, current_list
        if current_item is not None and current_list is not None:
            current_list.append(current_item)
            current_item = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" ") and line.endswith(":") and ": " not in line:
            flush_item()
            current_key = line[:-1]
            current_list = None
            nested_key = None
            nested_dict = None
            if current_key not in result:
                result[current_key] = None
            continue
        if line.startswith("  - ") and current_key:
            flush_item()
            if current_list is None:
                current_list = []
                result[current_key] = current_list
            val = line[4:].strip()
            if val.endswith(":"):
                current_item = {}
            elif ": " in val:
                current_item = {}
                k, v = val.split(": ", 1)
                current_item[k] = _yaml_scalar(v)
            else:
                current_list.append(_yaml_scalar(val))
            continue
        if line.startswith("    ") and current_item is not None:
            stripped = line.strip()
            if ": " in stripped:
                k, v = stripped.split(": ", 1)
                current_item[k] = _yaml_scalar(v)
            continue
        if line.startswith("  ") and ": " in line and current_key and current_list is None:
            k, v = line.strip().split(": ", 1)
            if result.get(current_key) is None or not isinstance(result[current_key], dict):
                result[current_key] = {}
            result[current_key][k] = _yaml_scalar(v)
    flush_item()
    return result


def _yaml_scalar(val: str):
    val = val.strip().strip('"').strip("'")
    if val in ("true", "false"):
        return val == "true"
    if val == "none" or val == "null":
        return None
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [_yaml_scalar(x.strip()) for x in inner.split(",")]
    return val


class Core:
    """Agent-neutral governance core loaded from governance/."""

    def __init__(self, harness_dir: Path | None = None):
        self.harness_dir = harness_dir or HARNESS_DIR
        self.governance_dir = self.harness_dir / "governance"
        self.version = "1.0"
        controls_doc = _load_yaml(self.governance_dir / "controls.yaml")
        self.controls = _load_controls_catalog(self.governance_dir / "controls.yaml") or controls_doc.get("controls") or []
        self.model_tiers = _load_yaml(self.governance_dir / "model-tiers.yaml")
        self.roles = _load_yaml(self.governance_dir / "roles" / "roles.yaml")
        self.orchestration = _load_yaml(self.governance_dir / "reviewers" / "orchestration.yaml")

    def policy_text(self, name: str) -> str:
        path = self.governance_dir / "policies" / f"{name}.md"
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def reviewer_files(self) -> list[str]:
        reviewers_dir = self.governance_dir / "reviewers"
        if not reviewers_dir.is_dir():
            return []
        return sorted(p.name for p in reviewers_dir.glob("*.md"))

    def enforcement_manifest(self) -> list[dict]:
        return _load_controls_catalog(self.governance_dir / "controls.yaml")


# --------------------------------------------------------------------------
# Path resolution — ported verbatim (in spirit) from titan-config.py so the
# two tools never diverge on what a dotted path / person-id means.
# --------------------------------------------------------------------------

def _load_controls_catalog(path: Path) -> list[dict]:
    """Parse governance/controls.yaml — nested claude/codex/cursor blocks."""
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    controls: list[dict] = []
    current: dict | None = None
    agent_key: str | None = None
    agent_block: dict | None = None

    def flush_agent():
        nonlocal agent_key, agent_block, current
        if current is not None and agent_key and agent_block is not None:
            current[agent_key] = dict(agent_block)
        agent_key = None
        agent_block = None

    def flush_control():
        nonlocal current
        flush_agent()
        if current is not None:
            controls.append(current)
        current = None

    for raw in lines:
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line.startswith("  ") and line.strip().endswith(":") and ": " not in line.strip():
            key = line.strip()[:-1]
            if current is not None and key in ("claude", "codex", "cursor"):
                flush_agent()
                agent_key = key
                agent_block = {}
            continue
        if line.startswith("  - id:"):
            flush_control()
            current = {"id": line.split(": ", 1)[1].strip().strip('"')}
            continue
        if current is None:
            continue
        if agent_block is not None and line.startswith("      ") and ": " in line.strip():
            k, v = line.strip().split(": ", 1)
            agent_block[k] = _yaml_scalar(v)
            continue
        if agent_block is not None and line.startswith("    ") and ": " in line.strip():
            k, v = line.strip().split(": ", 1)
            agent_block[k] = _yaml_scalar(v)
            continue
        if line.startswith("    ") and ": " in line.strip() and agent_block is None:
            k, v = line.strip().split(": ", 1)
            current[k] = _yaml_scalar(v)
    flush_control()
    return controls


def resolve_path(config: dict, dotted: str):
    """Resolve a dotted path, e.g. contacts.areas.aem.primary.0.name or
    contacts.areas.aem.primary.0 (auto-dereferenced through contacts.people).
    Raises KeyError on any miss — callers decide how to handle it."""
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


def person_name(config: dict, pid: str) -> str:
    """Resolve a contacts.people id to a display name; falls back to the raw
    id if it isn't a known person (fail-soft, never raises)."""
    people = config.get("contacts", {}).get("people", {})
    person = people.get(pid)
    if isinstance(person, dict) and "name" in person:
        return person["name"]
    return pid


def join_names(config: dict, ids) -> str:
    return " + ".join(person_name(config, pid) for pid in (ids or []))


# --------------------------------------------------------------------------
# Primitive 1 — scalar substitution
# --------------------------------------------------------------------------

SCALAR_RE = re.compile(r"\{\{\s*([\w.]+)\s*\}\}")


def substitute_scalars(text: str, config: dict) -> str:
    def _sub(m: re.Match) -> str:
        dotted = m.group(1)
        try:
            value = resolve_path(config, dotted)
        except KeyError as e:
            return f"{{{{UNRESOLVED:{dotted}:{e}}}}}"
        value = dereference_person(config, value)
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return str(value)

    return SCALAR_RE.sub(_sub, text)


# --------------------------------------------------------------------------
# Primitive 2 — named generated blocks
# --------------------------------------------------------------------------

BLOCK_RE = re.compile(
    r"<!--\s*titan:block\s+(?P<name>[\w-]+)\s*-->\r?\n?"
    r"(?P<body>.*?)"
    r"<!--\s*/titan:block\s+(?P=name)\s*-->",
    re.S,
)


def render_blocks(text: str, config: dict) -> str:
    def _sub(m: re.Match) -> str:
        name = m.group("name")
        gen = BLOCK_GENERATORS.get(name)
        if gen is None:
            # Unknown block name — leave untouched rather than destroy content.
            return m.group(0)
        content = gen(config).rstrip("\n")
        return f"<!-- titan:block {name} -->\n{content}\n<!-- /titan:block {name} -->"

    return BLOCK_RE.sub(_sub, text)


# --------------------------------------------------------------------------
# Block generators — one function per named block. Each takes the loaded
# config dict and returns markdown built ONLY from config data. Generic,
# org-neutral catalog data (e.g. what "/dev-mode" means) is not a company
# fact and may live here as a constant — it is identical for every adopter.
# --------------------------------------------------------------------------

MODE_CATALOG = {
    "dev-mode": ("/dev-mode", "All developers", "Writing code, fixing bugs, features, tests, PRs, offshore briefs"),
    "lead-review": ("/lead-review", "Tech Lead", "PR review"),
    "arch-mode": ("/arch-mode", "Lead Architect", "Architecture, deployments"),
    "grill-me": ("/grill-me", "Any developer", "Stress-test a plan before coding starts — one question at a time"),
    "qa-mode": ("/qa-mode", "QA Tester", "Pull a Jira story, write functional test cases, export a CSV for manual import into Zephyr/Xray"),
    "qa-automation": ("/qa-automation", "QA Automation Engineer", "Jest/JUnit/Mocha test code, code coverage audits, regression matrices, fixtures"),
    "security-mode": ("/security-mode", "Security reviewer (any senior)", "AppSec / OWASP / secret scan / MCP audit"),
    "sre-mode": ("/sre-mode", "SRE / Cloud Manager / Lead Architect", ".cloudmanager/, Adobe I/O Runtime, deploy / rollback, perf triage"),
    "prodsupport-mode": ("/prodsupport-mode", "Production support / L2-L3 / on-call", "Customer ticket triage, runbook-driven, ADO ticket drafting (READ-ONLY)"),
    "po-mode": ("/po-mode", "Product Owner / Manager", "User stories, acceptance criteria, backlog"),
    "designer-mode": ("/designer-mode", "Frontend / Design engineer", "Figma → React, brand tokens, stylesheet, a11y"),
}

# Generic, stack-driven (not org-driven) path-sensitivity filler rows —
# identical for every adopter, so they belong in code, not config.
GENERIC_REVIEW_RULES = [
    {"glob": "**/__tests__/**", "sensitivity": "LOW", "why": "Tests don't ship"},
    {"glob": "**/*Test.java", "sensitivity": "LOW", "why": "Tests don't ship"},
    {"glob": "**/*.test.tsx", "sensitivity": "LOW", "why": "Tests don't ship"},
    {"glob": "**/*.md", "sensitivity": "LOW", "why": "Docs"},
]


def _area_rows(config: dict):
    return list(config.get("contacts", {}).get("areas", {}).items())


def gen_contacts(config: dict) -> str:
    rows = ["| Area | Contact |", "|------|---------|"]
    for key, area in _area_rows(config):
        label = area.get("label", key)
        contact = join_names(config, area.get("primary", [])) or "—"
        secondary = area.get("secondary")
        if secondary:
            contact += f" (secondary: {join_names(config, secondary)})"
        rows.append(f"| {label} | {contact} |")
    return "\n".join(rows)


def gen_repo_map(config: dict) -> str:
    rows = ["| Repo | Module naming | Risk |", "|------|---------------|------|"]
    for repo in config.get("repos", []):
        naming = ", ".join(f"`{m}`" for m in repo.get("module_naming", [])) or "—"
        risk = ", ".join(repo.get("risk_notes", [])) or "—"
        rows.append(f"| `{repo.get('dir', repo.get('id', ''))}/` | {naming} | {risk} |")
    return "\n".join(rows)


def gen_contract_registry(config: dict) -> str:
    repos_by_id = {r["id"]: r for r in config.get("repos", [])}

    def disp(rid: str) -> str:
        return repos_by_id.get(rid, {}).get("display", rid)

    rows = ["| Contract | Owner repo | Consumer repos | Contact |", "|----------|-----------|----------------|---------|"]
    for c in config.get("contracts", []):
        consumers = ", ".join(disp(cr) for cr in c.get("consumer_repos", [])) or "—"
        contact = join_names(config, c.get("owners", [])) or "—"
        rows.append(f"| {c.get('name', '')} | {disp(c.get('owner_repo', ''))} | {consumers} | {contact} |")
    if len(rows) == 2:
        return "_No cross-repo contracts configured._"
    return "\n".join(rows)


def gen_hard_stops(config: dict) -> str:
    lines = []
    for p in config.get("protected_paths", []):
        if not p.get("enforcement", {}).get("hard_stop"):
            continue
        owners = join_names(config, p.get("owners", [])) or "—"
        globs = ", ".join(f"`{g}`" for g in p.get("globs", [])) or "(command-pattern only)"
        parts = [f"`{p.get('id', '')}`", f"({p.get('severity', '')})", globs, f"-> {owners}."]
        if p.get("why"):
            parts.append(f"{p['why']}.")
        if p.get("message"):
            parts.append(p["message"])
        lines.append("- " + " ".join(parts))
    return "\n".join(lines) if lines else "_No hard-stop paths configured._"


def gen_pr_reviewers(config: dict) -> str:
    rows = ["| Repo | Required reviewer(s) |", "|------|---------------------|"]
    for repo in config.get("repos", []):
        reviewers = join_names(config, repo.get("default_reviewers", [])) or "—"
        rows.append(f"| {repo.get('display', repo.get('id', ''))} | {reviewers} |")
        note = repo.get("reviewer_note")
        if note:
            rows.append(f"| {repo.get('display', repo.get('id', ''))} (note) | {note} |")
    return "\n".join(rows)


def gen_roles_permissions(config: dict) -> str:
    rows = ["| Role | Code | Deploy | PR Review | Edit governance |", "|------|------|--------|-----------|-----------------|"]
    for role, d in config.get("roles", {}).get("definitions", {}).items():
        code_val = d.get("code")
        code = "Read-only" if code_val is False else ("Yes" if code_val else "No")

        def yn(k: str) -> str:
            return "Yes" if d.get(k) else "No"

        edit_gov = yn("edit_governance")
        rows.append(f"| `{role}` | {code} | {yn('deploy')} | {yn('pr_review')} | **{edit_gov}** |")
    return "\n".join(rows)


def gen_governance_lock(config: dict) -> str:
    owner_name = person_name(config, config.get("roles", {}).get("governance_owner", ""))
    locked = ", ".join(f"`{p}`" for p in config.get("governance", {}).get("locked_paths", [])) or "`.claude/`, `CLAUDE.md`"
    intro = (
        f"All files under {locked} are **locked**. Only the `super` role "
        f"({owner_name} — toolkit maintainer) may edit them. Leads and architects have deploy and "
        "review authority but **cannot modify governance files**."
    )
    outro = (
        f"To request a change to the toolkit: raise it with {owner_name}. Changes go through review "
        "before being applied. If user only wants to navigate code, activate `/dev-mode` and note it."
    )
    return f"{intro}\n\n{gen_roles_permissions(config)}\n\n{outro}"


def gen_escalation_alert(config: dict) -> str:
    parts = []
    for key, area in _area_rows(config):
        label = area.get("label", key)
        owner = join_names(config, area.get("primary", [])) or "—"
        parts.append(f"{label} -> {owner}")
    contact_line = " | ".join(parts) if parts else "—"
    return (
        "```\n"
        "ESCALATION REQUIRED -- STOP WORK\n"
        "Reason:  [trigger]  |  Area: [file/module]\n"
        f"Contact: {contact_line}\n"
        "Action:  Stop > Contact lead > Get approval > Record approval ref in PR description\n"
        "```"
    )


def gen_environments(config: dict) -> str:
    env = config.get("environments", {})
    lines = []
    for key in ("staging", "production"):
        e = env.get(key)
        if isinstance(e, dict) and e.get("url"):
            lines.append(f"- **{key.capitalize()}**: {e['url']}")
    qa = env.get("qa")
    if isinstance(qa, dict):
        if qa.get("stage_url"):
            lines.append(f"- **QA staging**: {qa['stage_url']}")
        if qa.get("login_note"):
            lines.append(f"- Login: {qa['login_note']}")
        if qa.get("phi_reminder"):
            lines.append(f"- PHI/PII: {qa['phi_reminder']}")
    if env.get("qa_notes"):
        lines.append(f"- {env['qa_notes']}")
    return "\n".join(lines) if lines else "_No environments configured._"


def gen_mode_picker(config: dict) -> str:
    modes = config.get("modes", {})
    active = modes.get("active", [])
    hidden = modes.get("hidden", [])

    lines = ["Before any work this session, confirm a mode is active. If not, ask:", ""]
    rows = ["| Command | Who | When |", "|---------|-----|------|"]
    for mode in active:
        cmd, who, when = MODE_CATALOG.get(mode, (f"/{mode}", "—", "—"))
        rows.append(f"| `{cmd}` | {who} | {when} |")
    lines.extend(rows)
    lines.append("")
    lines.append("No files, code, or commands until mode is selected.")

    if hidden:
        lines.append("")
        lines.append(
            "**Hidden modes** (not active; code preserved for future re-enable). The skill files remain "
            "on disk and still work if typed manually. They are not advertised in the mode picker or "
            "UserPromptSubmit reminder."
        )
        lines.append("")
        hrows = ["| Command | Who | When |", "|---------|-----|------|"]
        for mode in hidden:
            cmd, who, when = MODE_CATALOG.get(mode, (f"/{mode}", "—", "—"))
            hrows.append(f"| `{cmd}` | {who} | {when} |")
        lines.extend(hrows)
    return "\n".join(lines)


def gen_plugin_policy_summary(config: dict) -> str:
    pp = config.get("governance", {}).get("plugin_policy", {})

    def fmt(items):
        return ", ".join(f"`{x}`" for x in items) if items else "none"

    return (
        f"Approved: {fmt(pp.get('approved'))}. Pending: {fmt(pp.get('pending'))}. "
        f"Blocked: {fmt(pp.get('blocked'))}. Full registry + proposal process: `/common/plugin-policy`."
    )


def gen_stack_skills(config: dict) -> str:
    """Stack-conditional cross-cutting-skill table rows. Unlike the base
    cross-cutting-skills table (org-neutral, always present, lives verbatim
    in the template), these two rows name a specific stack technology
    (a commerce platform, AEM) and must self-suppress when that part of the
    stack is disabled — otherwise an adopter with no commerce platform (e.g.
    the github-generic fixture) gets a rendered CLAUDE.md that still talks
    about Hybris/OCC log triage, which is both wrong and a residual-brand
    leak of the reference implementation's stack choice."""
    stack = config.get("stack", {})
    rows = []
    if stack.get("aem", {}).get("enabled"):
        rows.append(
            "| `/common/aem-logs` | Triage an AEM (author/publish/CIF/local SDK) log symptom — "
            "same redaction contract, branches by AEMaaCS/local/legacy CQ |"
        )
    commerce = stack.get("commerce", {})
    if commerce.get("enabled"):
        platform = commerce.get("platform") or "commerce platform"
        rows.append(
            f"| `/common/hybris-logs` | Triage a {platform.title()}/OCC log symptom — locates the log "
            "source per environment, redacts via `redact_lib.py`, classifies to an owner. Never reads "
            "commerce-platform config paths |"
        )
    if not rows:
        return "_No stack-specific log-triage skills active (commerce and AEM are both disabled in `stack`)._"
    return "\n".join(rows)


def gen_data_policy(config: dict) -> str:
    lines = [
        "No PHI/PII or other regulated personal data in code, tests, logs, or comments. "
        "Mock data must be fictional."
    ]
    for p in config.get("protected_paths", []):
        for g in p.get("globs", []):
            if "options.json" in g:
                lines.append(f"Never commit `{g}`.")
    qa = config.get("environments", {}).get("qa", {})
    if isinstance(qa, dict) and qa.get("phi_reminder"):
        lines.append(qa["phi_reminder"])
    return " ".join(lines)


BLOCK_GENERATORS = {
    "contacts": gen_contacts,
    "repo-map": gen_repo_map,
    "contract-registry": gen_contract_registry,
    "hard-stops": gen_hard_stops,
    "pr-reviewers": gen_pr_reviewers,
    "roles-permissions": gen_roles_permissions,
    "governance-lock": gen_governance_lock,
    "escalation-alert": gen_escalation_alert,
    "environments": gen_environments,
    "mode-picker": gen_mode_picker,
    "plugin-policy-summary": gen_plugin_policy_summary,
    "data-policy": gen_data_policy,
    "stack-skills": gen_stack_skills,
}


# --------------------------------------------------------------------------
# Data-file generators (JSON outputs, not markdown)
# --------------------------------------------------------------------------

def build_reviewer_map(config: dict) -> dict:
    repos = config.get("repos", [])
    default_reviewers_by_repo = {
        repo.get("dir", repo.get("id", "")): [person_name(config, pid) for pid in repo.get("default_reviewers", [])]
        for repo in repos
    }

    paths = []
    for p in config.get("protected_paths", []):
        owners = [person_name(config, pid) for pid in p.get("owners", [])]
        for g in p.get("globs", []):
            paths.append({"glob": g, "sensitivity": p.get("severity", ""), "owners": owners, "why": p.get("why", "")})

    for repo in repos:
        for rule in repo.get("extra_reviewer_rules", []):
            paths.append({
                "glob": rule.get("glob", ""),
                "sensitivity": rule.get("sensitivity", ""),
                "owners": [person_name(config, pid) for pid in rule.get("owners", [])],
                "why": rule.get("why", ""),
            })

    # Generic AEM-maven module-shape rules — stack-generic (any aem-maven repo
    # has core/ui.apps/ui.content/ui.frontend modules), emitted once globally
    # rather than per repo since the glob patterns themselves are repo-agnostic
    # (`*-core/...`) and this is how the original harness modelled them too.
    if any(r.get("kind") == "aem-maven" for r in repos):
        ui_area = config.get("contacts", {}).get("areas", {}).get("ui", {})
        frontend_owner_names = [person_name(config, pid) for pid in ui_area.get("primary", [])]
        paths.append({"glob": "*-core/src/main/java/**", "sensitivity": "MODERATE", "owners": [], "why": "OSGi services — repo default reviewer"})
        if config.get("stack", {}).get("frontend", {}).get("react"):
            paths.append({"glob": "*-ui.frontend/src/main/webpack/app/react/**", "sensitivity": "LOW-MODERATE", "owners": frontend_owner_names, "why": "React/Redux UI"})
        paths.append({"glob": "*-ui.apps/**", "sensitivity": "LOW-MODERATE", "owners": [], "why": "HTL / JCR content — repo default reviewer"})
        paths.append({"glob": "*-ui.content/**", "sensitivity": "LOW-MODERATE", "owners": [], "why": "HTL / JCR content — repo default reviewer"})

    for rule in GENERIC_REVIEW_RULES:
        paths.append(dict(rule, owners=[]))

    notes = {repo["id"]: repo["reviewer_note"] for repo in repos if repo.get("reviewer_note")}

    out = {
        "_description": (
            "Deterministic path->owner lookup for the ?reviewers fast path (answer-cache.py). "
            "Generated by titan-render.py from titan.config.json protected_paths[] + repos[]. "
            "Hand-edit titan.config.json, not this file."
        ),
        "default_reviewers_by_repo": default_reviewers_by_repo,
        "paths": paths,
    }
    if notes:
        out["notes"] = notes
    return out


def build_protected_paths(config: dict) -> dict:
    entries = []
    for p in config.get("protected_paths", []):
        entries.append({
            "id": p.get("id", ""),
            "globs": p.get("globs", []),
            "command_patterns": p.get("command_patterns", []),
            "reader_guard_dirs": p.get("reader_guard_dirs", []),
            "severity": p.get("severity", ""),
            "rotatable": p.get("rotatable", True),
            "owners": p.get("owners", []),
            "owner_names": [person_name(config, pid) for pid in p.get("owners", [])],
            "why": p.get("why", ""),
            "enforcement": p.get("enforcement", {}),
            "message": p.get("message", ""),
        })
    return {
        "_description": (
            "Compiled enforcement view of titan.config.json protected_paths[], flattened for hook "
            "consumption (protect-secrets.py, cost-estimate.py, gov-retrieve.py). Generated — do not "
            "hand-edit; edit titan.config.json protected_paths[] instead."
        ),
        "paths": entries,
    }


def build_qa_env(config: dict) -> dict:
    qa = config.get("environments", {}).get("qa", {})
    out = {
        "_description": (
            "QA Tester (/qa-mode) running-app context source — generated from titan.config.json "
            "environments.qa. Shared, non-secret default so the wizard does not need a per-tester "
            "onboarding step."
        ),
    }
    if isinstance(qa, dict):
        if qa.get("stage_url"):
            out["stageUrl"] = qa["stage_url"]
        if qa.get("login_note"):
            out["loginNote"] = qa["login_note"]
        if qa.get("phi_reminder"):
            out["phiReminder"] = qa["phi_reminder"]
    return out


_KIND_DEFAULT_COMMANDS = {
    "aem-maven": ["mvn clean install -DskipTests"],
    "node-lerna": ["yarn install", "yarn test"],
    "hybris": ["# build commands are environment-specific — see repo README"],
    "generic": ["# no default build command configured for this repo kind"],
}


def build_build_map(config: dict) -> dict:
    repos_out = {}
    for repo in config.get("repos", []):
        kind = repo.get("kind", "generic")
        default_cmds = [f"cd {repo.get('dir', repo.get('id', ''))}"] + _KIND_DEFAULT_COMMANDS.get(kind, _KIND_DEFAULT_COMMANDS["generic"])
        repos_out[repo["id"]] = {
            "dir": repo.get("dir", ""),
            "kind": kind,
            "default": default_cmds,
            "modules": [],
            "notes": repo.get("risk_notes", []),
        }
    return {
        "_description": (
            "Deterministic build-command lookup for the ?build fast path (answer-cache.py). Generated "
            "from titan.config.json repos[] — generic per-kind defaults only. Per-module build commands "
            "are repo-specific detail beyond the shared config's scope; add them by hand under "
            "repos.<id>.modules if a repo needs finer-grained matching."
        ),
        "repos": repos_out,
    }


def _command_pattern_to_bash_denies(cp: str) -> list:
    """Best-effort mapping of a verbatim `regex:` command_pattern to one or
    more Bash(...) settings.json deny tokens. Not a general regex->glob
    compiler — just handles the shapes seen in protected_paths (word-boundary
    literals separated by \\s+ / alternation), matching the two patterns the
    original harness hand-authored (openssl pkcs12, keytool -list|-export)."""
    if not cp.startswith("regex:"):
        return []
    pattern = cp[len("regex:"):]
    alt_match = re.match(r"^([\w-]+)\\s\+-\(([\w|]+)\)$", pattern)
    if alt_match:
        base, alts = alt_match.groups()
        return [f"Bash({base} -{a}*)" for a in alts.split("|")]
    literal = re.sub(r"\\s\+", " ", pattern)
    literal = re.sub(r"[\\]", "", literal)
    return [f"Bash({literal.strip()}*)"]


def generated_deny_rules(config: dict) -> list:
    rules: list = []
    for p in config.get("protected_paths", []):
        if not p.get("enforcement", {}).get("deny_in_settings"):
            continue
        for g in p.get("globs", []):
            rules.append(f"Bash(cat *{g}*)")
        for cp in p.get("command_patterns", []):
            rules.extend(_command_pattern_to_bash_denies(cp))
    # de-dupe, preserve order
    seen = set()
    out = []
    for r in rules:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def build_settings(config: dict, templates_dir: Path | None = None) -> dict:
    template_path = _resolve_templates_dir(templates_dir) / "settings.json.tmpl"
    text = template_path.read_text(encoding="utf-8")
    text = substitute_scalars(text, config)
    settings = json.loads(text)

    deny = settings.get("permissions", {}).get("deny", [])
    placeholder = "__TITAN_GENERATED_DENY__"
    if placeholder in deny:
        idx = deny.index(placeholder)
        settings["permissions"]["deny"] = deny[:idx] + generated_deny_rules(config) + deny[idx + 1:]
    return settings


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_file(out_dir: Path, rel_path: str, content: str, manifest: list) -> None:
    dest = out_dir / rel_path
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = content.encode("utf-8")
    dest.write_bytes(data)
    manifest.append({"path": rel_path.replace("\\", "/"), "sha256": sha256(data), "bytes": len(data)})


def render_claude_overlay(config: dict, out_dir: Path, templates_dir: Path | None = None) -> list:
    manifest: list = []
    td = _resolve_templates_dir(templates_dir)

    tmpl = (td / "CLAUDE.md.tmpl").read_text(encoding="utf-8")
    tmpl = substitute_scalars(tmpl, config)
    tmpl = render_blocks(tmpl, config)
    write_file(out_dir, "CLAUDE.md", tmpl, manifest)

    write_file(out_dir, "data/reviewer-map.json", json.dumps(build_reviewer_map(config), indent=2) + "\n", manifest)
    write_file(out_dir, "data/protected-paths.json", json.dumps(build_protected_paths(config), indent=2) + "\n", manifest)
    write_file(out_dir, "data/qa-env.json", json.dumps(build_qa_env(config), indent=2) + "\n", manifest)
    write_file(out_dir, "data/build-map.json", json.dumps(build_build_map(config), indent=2) + "\n", manifest)

    settings = build_settings(config, templates_dir=td)
    write_file(out_dir, "settings.json", json.dumps(settings, indent=2) + "\n", manifest)

    return manifest
