"""Claude Code adapter — renders .claude/ overlay (CLAUDE.md, data/*.json, settings.json)."""
from __future__ import annotations

import json
from pathlib import Path

from scripts import titan_core as core


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
        (out_dir / ".render-manifest.json").write_text(
            json.dumps(manifest_doc, indent=2) + "\n", encoding="utf-8"
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
            if "{{" in text and "UNRESOLVED" in text:
                return False
        return True
