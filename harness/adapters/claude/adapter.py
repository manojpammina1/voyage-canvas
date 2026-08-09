"""Claude Code adapter — renders .claude/ overlay (CLAUDE.md, data/*.json, settings.json)."""
from __future__ import annotations

import json
from pathlib import Path

from scripts import titan_core as core


def _has_unresolved_placeholders(text: str) -> bool:
    """True when render left template holes or adoption placeholders (D2)."""
    return "{{" in text or "REPLACE_ME" in text or "UNRESOLVED" in text


class ClaudeAdapter:
    name = "claude"

    def render(self, config: dict, gov: core.Core, out_dir: Path) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        manifest = core.render_claude_overlay(config, out_dir)
        manifest_doc = {
            "_description": "Claude adapter render manifest.",
            "adapter": self.name,
            "files": manifest,
        }
        core.write_text(
            out_dir / ".render-manifest.json",
            json.dumps(manifest_doc, indent=2) + "\n",
        )
        return [out_dir / f["path"] for f in manifest]

    def verify(self, out_dir: Path) -> bool:
        required = [
            "CLAUDE.md",
            "settings.json",
            "data/build-map.json",
            "data/protected-paths.json",
            "data/qa-env.json",
            "data/reviewer-map.json",
        ]
        for rel in required:
            if not (out_dir / rel).is_file():
                return False
            text = (out_dir / rel).read_text(encoding="utf-8")
            if _has_unresolved_placeholders(text):
                return False
        return True
