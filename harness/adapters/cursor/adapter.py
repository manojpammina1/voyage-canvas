"""Cursor adapter — renders .cursor/rules + hooks + shared AGENTS.md."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from adapters.codex.adapter import CodexAdapter, _inject_policies, render_codex_blocks, gen_advisory_controls, gen_protected_paths_summary, gen_reviewer_list, gen_model_tiers, CODEX_BLOCK_GENERATORS
from scripts import titan_core as core

CURSOR_DIR = Path(__file__).resolve().parent


CURSOR_BLOCK_GENERATORS = dict(CODEX_BLOCK_GENERATORS)
CURSOR_BLOCK_GENERATORS["advisory-controls"] = lambda cfg: gen_advisory_controls(core.Core())
CURSOR_BLOCK_GENERATORS["protected-paths-summary"] = gen_protected_paths_summary


def render_cursor_blocks(text: str, config: dict) -> str:
    import re
    block_re = core.BLOCK_RE

    def _sub(m: re.Match) -> str:
        name = m.group("name")
        gen = CURSOR_BLOCK_GENERATORS.get(name)
        if gen is None:
            return m.group(0)
        content = gen(config).rstrip("\n")
        return f"<!-- titan:block {name} -->\n{content}\n<!-- /titan:block {name} -->"

    return block_re.sub(_sub, text)


class CursorAdapter:
    name = "cursor"

    def render(self, config: dict, gov: core.Core, out_dir: Path) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        written: list[Path] = []

        # AGENTS.md (shared shape with Codex)
        codex = CodexAdapter()
        codex_paths = codex.render(config, gov, out_dir)
        written.extend(codex_paths)

        # Staged as cursor-pack/ — deploy-harness.sh maps to .cursor/ (some environments block writing .cursor during render)
        pack = out_dir / "cursor-pack"
        rules_dir = pack / "rules"
        rules_dir.mkdir(parents=True, exist_ok=True)
        tmpl = (CURSOR_DIR / "rules" / "governance.mdc.tmpl").read_text(encoding="utf-8")
        tmpl = _inject_policies(tmpl, gov, config)
        tmpl = render_cursor_blocks(tmpl, config)
        tmpl = core.substitute_scalars(tmpl, config)
        rule_path = rules_dir / "governance.mdc"
        rule_path.write_text(tmpl, encoding="utf-8")
        written.append(rule_path)

        review_tmpl = (CURSOR_DIR / "rules" / "review-standards.mdc.tmpl")
        if review_tmpl.is_file():
            rt = _inject_policies(review_tmpl.read_text(encoding="utf-8"), gov, config)
            rp = rules_dir / "review-standards.mdc"
            rp.write_text(rt, encoding="utf-8")
            written.append(rp)
        else:
            rp = rules_dir / "review-standards.mdc"
            rp.write_text(
                "---\ndescription: Review standards\nalwaysApply: false\n---\n\n"
                + gov.policy_text("review-standards"),
                encoding="utf-8",
            )
            written.append(rp)

        hooks_dir = pack / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(CURSOR_DIR / "hooks" / "pre-tool-guard.sh", hooks_dir / "pre-tool-guard.sh")
        (hooks_dir / "pre-tool-guard.sh").chmod(0o755)
        written.append(hooks_dir / "pre-tool-guard.sh")

        hooks_json = core.substitute_scalars(
            (CURSOR_DIR / "hooks.json.tmpl").read_text(encoding="utf-8"), config
        )
        hooks_path = pack / "hooks.json"
        hooks_path.write_text(hooks_json, encoding="utf-8")
        written.append(hooks_path)
        written.append(pack)

        return written

    def verify(self, out_dir: Path) -> bool:
        pack = out_dir / "cursor-pack"
        if not (pack / "rules" / "governance.mdc").is_file():
            return False
        if not (pack / "hooks.json").is_file():
            return False
        return CodexAdapter().verify(out_dir)
