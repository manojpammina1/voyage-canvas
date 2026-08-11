#!/usr/bin/env python3
"""Regression tests for adapter verify() guards (D2) and LF write helper (D1)."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HARNESS))
sys.path.insert(0, str(HARNESS / "scripts"))

from adapters.claude.adapter import ClaudeAdapter, _has_unresolved_placeholders  # noqa: E402
from adapters.codex.adapter import CodexAdapter  # noqa: E402
from titan_core import normalize_lf, render_claude_overlay, write_text  # noqa: E402


class NormalizeLfTests(unittest.TestCase):
    def test_strips_crlf_and_bare_cr(self) -> None:
        self.assertEqual(normalize_lf("a\r\nb\rc\n"), "a\nb\nc\n")

    def test_write_text_is_lf_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.md"
            write_text(path, "line1\r\nline2\r\n")
            data = path.read_bytes()
            self.assertNotIn(b"\r", data)
            self.assertEqual(data, b"line1\nline2\n")


class ClaudeVerifyTests(unittest.TestCase):
    def _write_required(self, out: Path, claude_body: str) -> None:
        (out / "data").mkdir(parents=True, exist_ok=True)
        files = {
            "CLAUDE.md": claude_body,
            "settings.json": "{}\n",
            "data/build-map.json": "{}\n",
            "data/protected-paths.json": "{}\n",
            "data/qa-env.json": "{}\n",
            "data/reviewer-map.json": "{}\n",
        }
        for rel, body in files.items():
            write_text(out / rel, body)

    def test_placeholder_detector_matches_codex_semantics(self) -> None:
        self.assertTrue(_has_unresolved_placeholders("hello REPLACE_ME world"))
        self.assertTrue(_has_unresolved_placeholders("{{org.name}}"))
        self.assertTrue(_has_unresolved_placeholders("{{UNRESOLVED:x}}"))
        self.assertFalse(_has_unresolved_placeholders("clean rendered text"))

    def test_verify_fails_on_replace_me(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self._write_required(out, "# Org REPLACE_ME\n")
            self.assertFalse(ClaudeAdapter().verify(out))

    def test_verify_fails_on_replace_me_without_unresolved_token(self) -> None:
        """Old bug required '{{' AND 'UNRESOLVED' — REPLACE_ME alone must fail."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self._write_required(out, "still has REPLACE_ME left\n")
            self.assertFalse(ClaudeAdapter().verify(out))

    def test_verify_passes_clean_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self._write_required(out, "# Riverstone Outfitters\n")
            self.assertTrue(ClaudeAdapter().verify(out))

    def test_placeholder_config_render_fails_verify(self) -> None:
        """Rendering a config that still contains REPLACE_ME must fail verify()."""
        cfg = {
            "org": {
                "name": "REPLACE_ME",
                "short_name": "X",
                "display_name": "REPLACE_ME Corp",
                "email_domain": "example.com",
                "harness_brand": "Titan",
                "workspace_note": "note",
            },
            "contacts": {"people": {}, "areas": {}},
            "roles": {"governance_owner": "", "definitions": {}},
            "modes": {"active": ["dev-mode"], "hidden": []},
            "stack": {
                "aem": {"enabled": False},
                "commerce": {"enabled": False},
                "cif": {"enabled": False},
                "search": {"enabled": False},
                "frontend": {"react": False, "redux_patterns": [], "stylesheets": []},
                "i18n": False,
            },
            "repos": [],
            "protected_paths": [],
            "contracts": [],
            "environments": {},
            "platforms": {
                "scm": {"kind": "github", "base_url": "", "collection": "", "pat_url": ""},
                "issue_tracker": {"kind": "none", "site": "", "ticket_regex": ""},
                "general_chat_alternative": "chat",
            },
            "governance": {
                "locked_paths": [],
                "plugin_policy": {"approved": [], "pending": [], "blocked": []},
            },
            "telemetry": {"salt": "x", "enabled": False, "upload": {"kind": "none"}},
            "data_files": {},
            "docs": {},
            "branding": {"logo_path": "", "product_name": "Titan", "accent": "#000"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            render_claude_overlay(cfg, out)
            self.assertFalse(ClaudeAdapter().verify(out))


class CodexVerifyTests(unittest.TestCase):
    def test_verify_fails_on_replace_me_in_agents(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            write_text(out / "AGENTS.md", "Hello REPLACE_ME\n")
            (out / ".codex").mkdir()
            write_text(out / ".codex" / "review.mjs", "// ok\n")
            self.assertFalse(CodexAdapter().verify(out))


if __name__ == "__main__":
    unittest.main()
