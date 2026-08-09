#!/usr/bin/env python3
"""
Titan -- PHI / PII redaction hook (PreToolUse on Edit/Write).

Scans the proposed file content for patterns that look like customer PHI / PII
(emails, full PANs, SSNs, phone numbers, IPs, full names tagged with role).
If found in production-support context, BLOCKS the write and tells the user
to redact first.

Activation logic:
  - Always runs (covers all roles)
  - When CLAUDE_ROLE=prodsupport, BLOCKS the write on any PHI hit
  - In other roles, WARNS but allows (PHI may legitimately appear in fixture
    test data marked with TEST_ / FIXTURE_ comment markers; allow those)

Approved exceptions (never blocked):
  - File path under **/__tests__/, **/test/, **/src/test/, **/fixtures/
  - Inline comment markers // TEST_FIXTURE or # TEST_FIXTURE
  - Stripe / CyberSource sandbox test PANs (4111 1111 1111 1111 etc.)
  - Fictional dental practice names from the approved QA fixture list

Hook output:
  - Exit 0 = allow the tool call
  - Exit 1 with message on stderr = block the tool call

Reads tool input from $CLAUDE_TOOL_INPUT (JSON string).

Patterns/allowlists live in redact_lib.py -- shared with the log-debug skills
(/common/hybris-logs, /common/aem-logs), which mask log excerpts with the same
rules via redact_lib.redact() before ever displaying them.
"""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from redact_lib import scan, is_test_path, has_fixture_marker  # noqa: E402
try:
    import titan_config
except Exception:
    titan_config = None


def main() -> int:
    workspace = Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd())
    brand = titan_config.brand(workspace) if titan_config else "Titan"
    raw = os.environ.get("CLAUDE_TOOL_INPUT", "")
    if not raw:
        return 0  # Nothing to inspect — allow.

    try:
        tool_input = json.loads(raw)
    except Exception:
        return 0  # Malformed — fail open to avoid false-positive blocking.

    file_path = tool_input.get("file_path", "")
    content = tool_input.get("new_string", "") or tool_input.get("content", "")

    if not content or not isinstance(content, str):
        return 0

    if is_test_path(file_path):
        return 0  # Allowed test/fixture path.

    if has_fixture_marker(content):
        return 0  # Explicit fixture marker present.

    findings = scan(content)

    if not findings:
        return 0  # Clean — allow.

    role = os.environ.get("CLAUDE_ROLE", "").lower()
    summary = "\n  - ".join(findings)

    if role == "prodsupport":
        # Block.
        print(
            f"[{brand} PHI guard] Production-support role: refusing to write "
            "PHI / PII / payment data to a non-test file.\n"
            f"Target: {file_path}\nFindings:\n  - {summary}\n"
            "Redact the data first (replace with placeholders) OR move the write "
            "to a path under **/__tests__/ or **/fixtures/.",
            file=sys.stderr,
        )
        return 1

    # Other roles: warn but allow.
    print(
        f"[{brand} PHI guard] WARNING: customer-data-like patterns in non-test "
        "write — verify before commit.\n"
        f"Target: {file_path}\nFindings:\n  - {summary}\n"
        "Confirm this is approved test data with a TEST_FIXTURE comment marker, "
        "or redact before proceeding.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
