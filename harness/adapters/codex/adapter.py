"""Codex adapter — renders AGENTS.md + .codex/ enforcement wrappers."""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from scripts import titan_core as core

CODEX_DIR = Path(__file__).resolve().parent


def _inject_policies(text: str, gov: core.Core, config: dict) -> str:
    mapping = {
        "policies.hard_stops": gov.policy_text("hard-stops"),
        "policies.security": gov.policy_text("security"),
        "policies.definition_of_done": gov.policy_text("definition-of-done"),
        "policies.review_standards": gov.policy_text("review-standards"),
        "policies.escalation": gov.policy_text("escalation"),
        "core.version": gov.version,
    }
    for key, val in mapping.items():
        text = text.replace(f"{{{{{key}}}}}", val.strip())
    return core.substitute_scalars(text, config)


def gen_protected_paths_summary(config: dict) -> str:
    lines = []
    for p in config.get("protected_paths", []):
        globs = ", ".join(f"`{g}`" for g in p.get("globs", [])) or "(patterns only)"
        lines.append(f"- `{p.get('id', '')}` ({p.get('severity', '')}): {globs}")
    return "\n".join(lines) if lines else "_No protected paths configured._"


def gen_reviewer_list(gov: core.Core) -> str:
    files = [f for f in gov.reviewer_files() if f != "orchestration.yaml"]
    return "\n".join(f"- `{name}`" for name in files if name.endswith(".md"))


def gen_model_tiers(gov: core.Core) -> str:
    tiers = gov.model_tiers.get("tiers") or []
    if not isinstance(tiers, list):
        return "_No model tiers configured._"
    lines = []
    for t in tiers:
        if not isinstance(t, dict):
            continue
        lines.append(f"- **{t.get('id', '')}** — {t.get('summary', '')} → Codex: {t.get('codex', '')}")
    return "\n".join(lines) if lines else "_No model tiers configured._"


def gen_advisory_controls(gov: core.Core) -> str:
    lines = ["| Control | Codex enforcement | Note |", "|---------|-------------------|------|"]
    for ctrl in gov.enforcement_manifest():
        codex = ctrl.get("codex") or {}
        if isinstance(codex, dict) and codex.get("trigger") == "none":
            note = codex.get("note") or codex.get("via") or "Advisory only"
            lines.append(f"| `{ctrl.get('id', '')}` | advisory | {note} |")
    if len(lines) == 2:
        return "_All critical controls have Codex enforcement wired._"
    return "\n".join(lines)


CODEX_BLOCK_GENERATORS = {
    "mode-picker": core.gen_mode_picker,
    "hard-stops": core.gen_hard_stops,
    "protected-paths-summary": gen_protected_paths_summary,
    "data-policy": core.gen_data_policy,
    "reviewer-list": lambda cfg: gen_reviewer_list(core.Core()),
    "model-tiers": lambda cfg: gen_model_tiers(core.Core()),
    "plugin-policy-summary": core.gen_plugin_policy_summary,
    "contacts": core.gen_contacts,
    "escalation-alert": core.gen_escalation_alert,
    "repo-map": core.gen_repo_map,
    "contract-registry": core.gen_contract_registry,
    "advisory-controls": lambda cfg: gen_advisory_controls(core.Core()),
}


def render_codex_blocks(text: str, config: dict) -> str:
    block_re = core.BLOCK_RE

    def _sub(m: re.Match) -> str:
        name = m.group("name")
        gen = CODEX_BLOCK_GENERATORS.get(name)
        if gen is None:
            return m.group(0)
        content = gen(config).rstrip("\n")
        return f"<!-- titan:block {name} -->\n{content}\n<!-- /titan:block {name} -->"

    return block_re.sub(_sub, text)


class CodexAdapter:
    name = "codex"

    def render(self, config: dict, gov: core.Core, out_dir: Path) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []

        tmpl = (CODEX_DIR / "AGENTS.md.tmpl").read_text(encoding="utf-8")
        tmpl = _inject_policies(tmpl, gov, config)
        tmpl = render_codex_blocks(tmpl, config)
        tmpl = core.substitute_scalars(tmpl, config)
        agents_path = out_dir / "AGENTS.md"
        agents_path.write_text(tmpl, encoding="utf-8")
        written.append(agents_path)

        codex_out = out_dir / ".codex"
        codex_out.mkdir(parents=True, exist_ok=True)
        shutil.copy2(CODEX_DIR / "review.mjs", codex_out / "review.mjs")
        written.append(codex_out / "review.mjs")

        hooks_dir = codex_out / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        pre_commit_src = CODEX_DIR / "hooks" / "pre-commit"
        if pre_commit_src.is_file():
            shutil.copy2(pre_commit_src, hooks_dir / "pre-commit")
            written.append(hooks_dir / "pre-commit")

        ci_dir = out_dir / ".github" / "workflows"
        ci_dir.mkdir(parents=True, exist_ok=True)
        ci_src = CODEX_DIR / "ci" / "agent-governance.yml"
        if ci_src.is_file():
            ci_text = core.substitute_scalars(ci_src.read_text(encoding="utf-8"), config)
            ci_path = ci_dir / "agent-governance.yml"
            ci_path.write_text(ci_text, encoding="utf-8")
            written.append(ci_path)

        gov_link = out_dir / "governance"
        if not gov_link.exists():
            shutil.copytree(gov.governance_dir, gov_link, dirs_exist_ok=True)
            written.append(gov_link)

        return written

    def verify(self, out_dir: Path) -> bool:
        agents = out_dir / "AGENTS.md"
        if not agents.is_file():
            return False
        text = agents.read_text(encoding="utf-8")
        if "{{" in text or "REPLACE_ME" in text or "UNRESOLVED" in text:
            return False
        if not (out_dir / ".codex" / "review.mjs").is_file():
            return False
        return True
