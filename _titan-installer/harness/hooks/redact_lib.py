#!/usr/bin/env python3
"""
Titan -- shared PII/PHI pattern library + true masking.

Extracted from redact-customer-data.py (which only DETECTS patterns for the
Edit/Write hook) so the same regexes + allowlists can be reused by anything
that needs to MASK text before display -- specifically the log-debug skills
(/common/hybris-logs, /common/aem-logs), which pipe raw log excerpts through
this module before showing them to the user.

redact-customer-data.py imports scan()/is_test_path()/has_fixture_marker()
from here so there is exactly one place the patterns live -- keeping the
Edit/Write hook and the log-display path in sync by construction, not by
convention.

CLI mode (for a skill to shell out to, or for manual testing):
    python redact_lib.py < raw_log_excerpt.txt > masked.txt
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None


def _org_email_suffixes() -> tuple[str, ...]:
    """('@<org-email-domain>', '@example.com', '@test.com', '@localhost').
    Reads titan.config.json org.email_domain live (small, fail-open lookup)
    rather than baking one org's domain into the pattern library."""
    suffixes = ["@example.com", "@test.com", "@localhost"]
    if titan_config:
        try:
            ws = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path.cwd())
            domain = titan_config.org(ws).get("email_domain")
            if domain:
                suffixes.insert(0, f"@{domain}")
        except Exception:
            pass
    return tuple(suffixes)

# ── Pattern definitions (identical to redact-customer-data.py) ────────────────

EMAIL_RE = re.compile(
    r"(?<![A-Za-z0-9_${{])"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"(?![A-Za-z0-9])"
)

PAN_RE = re.compile(
    r"\b[3-6]\d{3}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{1,7}\b"
)

SANDBOX_PANS = {
    "4111111111111111",
    "4242424242424242",
    "4000000000000002",
    "4000000000003220",
    "5555555555554444",
    "4000056655665556",
    "378282246310005",
    "6011111111111117",
}

SSN_RE = re.compile(r"\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b")

PHONE_RE = re.compile(
    r"\b(?:\+?1[\s\-.]?)?\(?[2-9]\d{2}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b"
)

IPV4_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)

SANDBOX_IPS = {"127.0.0.1", "0.0.0.0", "255.255.255.255", "10.0.0.0", "192.168.1.1"}

TEST_PATH_FRAGMENTS = (
    "/__tests__/",
    "/test/",
    "/src/test/",
    "/fixtures/",
    "/.claude/progress/",
    "/.claude/cost-tracking/",
)

APPROVED_NAMES = (
    "bright smile dental",
    "northgate family dental",
    "crestview orthodontics",
)


def is_test_path(file_path: str) -> bool:
    p = file_path.replace("\\", "/").lower()
    return any(frag in p for frag in TEST_PATH_FRAGMENTS)


def has_fixture_marker(content: str) -> bool:
    return ("TEST_FIXTURE" in content) or ("test-fixture" in content.lower())


def scan(content: str) -> list[str]:
    """Return a list of human-readable findings (empty if clean). Detection
    only -- does not modify content. Same behavior as the original
    redact-customer-data.py scan()."""
    findings = []

    stripped = content
    for safe_pan in SANDBOX_PANS:
        stripped = stripped.replace(safe_pan, "<sandbox-pan>")

    if EMAIL_RE.search(stripped):
        emails = EMAIL_RE.findall(stripped)
        suspicious = [
            e for e in emails
            if not e.lower().endswith(_org_email_suffixes())
            and not any(name in e.lower() for name in APPROVED_NAMES)
        ]
        if suspicious:
            findings.append(f"email-like value(s): {len(suspicious)} (sample: {suspicious[0]})")

    pan_hits = PAN_RE.findall(stripped)
    real_pans = [p for p in pan_hits if re.sub(r"[\s\-]", "", p) not in SANDBOX_PANS]
    if real_pans:
        findings.append(
            f"credit-card-like value(s): {len(real_pans)} (sample first 4: "
            f"{re.sub(chr(92) + 'd', '*', real_pans[0])[:4]}...)"
        )

    if SSN_RE.search(stripped):
        findings.append("SSN-like value(s) detected")

    phone_hits = PHONE_RE.findall(stripped)
    if phone_hits:
        real_phones = [
            p for p in phone_hits
            if "555-" not in p.replace(".", "-").replace(" ", "-")
            and "000-" not in p.replace(".", "-").replace(" ", "-")
        ]
        if real_phones:
            findings.append(f"phone-like value(s): {len(real_phones)} (sample: {real_phones[0]})")

    ip_hits = IPV4_RE.findall(stripped)
    real_ips = [ip for ip in ip_hits if ip not in SANDBOX_IPS and not ip.startswith(("10.", "192.168."))]
    if real_ips:
        findings.append(f"public IPv4 value(s): {len(real_ips)} (sample: {real_ips[0]})")

    return findings


# ── Masking (new — not in the original detector) ───────────────────────────
# Order matters: PAN before phone (a PAN can look like a long digit run that
# a looser phone pattern might partially match); IPv4 before nothing else
# conflicts. Sandbox/allowlisted values are left untouched, everything else
# real is replaced with a typed placeholder — never with the original value,
# not even truncated, since log excerpts get displayed to the user directly.

def redact(text: str) -> tuple[str, list[str]]:
    """Return (masked_text, findings). findings is the same shape as scan().
    Sandbox PANs/IPs, approved fixture emails, and 555-/000- test phone
    numbers are left as-is (they are not real customer data)."""
    if not text:
        return text, []

    findings = scan(text)
    masked = text

    def _mask_pan(m: re.Match) -> str:
        digits = re.sub(r"[\s\-]", "", m.group(0))
        return m.group(0) if digits in SANDBOX_PANS else "<redacted:pan>"

    masked = PAN_RE.sub(_mask_pan, masked)

    def _mask_email(m: re.Match) -> str:
        e = m.group(0)
        if e.lower().endswith(_org_email_suffixes()):
            return e
        if any(name in e.lower() for name in APPROVED_NAMES):
            return e
        return "<redacted:email>"

    masked = EMAIL_RE.sub(_mask_email, masked)
    masked = SSN_RE.sub("<redacted:ssn>", masked)

    def _mask_phone(m: re.Match) -> str:
        p = m.group(0)
        norm = p.replace(".", "-").replace(" ", "-")
        if "555-" in norm or "000-" in norm:
            return p
        return "<redacted:phone>"

    masked = PHONE_RE.sub(_mask_phone, masked)

    def _mask_ip(m: re.Match) -> str:
        ip = m.group(0)
        if ip in SANDBOX_IPS or ip.startswith(("10.", "192.168.")):
            return ip
        return "<redacted:ip>"

    masked = IPV4_RE.sub(_mask_ip, masked)

    return masked, findings


def main() -> int:
    raw = sys.stdin.read()
    masked, findings = redact(raw)
    sys.stdout.write(masked)
    if findings:
        sys.stderr.write(f"[redact_lib] {len(findings)} finding(s) masked:\n")
        for f in findings:
            sys.stderr.write(f"  - {f}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
