#!/usr/bin/env python3
"""
Titan harness -- Pre-write credential and PHI scanner
Hooked into Claude Code PreToolUse for Write and Edit tools.
Blocks file writes that contain credentials, tokens, or PHI patterns.
Fails open (exit 0) if Python itself errors -- never blocks legitimate work silently.
"""
import sys
import json
import re
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import titan_config
except Exception:
    titan_config = None

# Patterns that indicate a real credential or PHI value.
# Each entry: (regex, human-readable label)
# Patterns require an assignment operator ([=:]) followed by a non-trivial value
# to avoid false positives in documentation and comments.
CREDENTIAL_PATTERNS = [
    (r'(?i)password\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{3,}',       'hardcoded password'),
    (r'(?i)passwd\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{3,}',         'hardcoded passwd'),
    (r'(?i)secret\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}',         'hardcoded secret'),
    (r'(?i)api[_-]?key\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}',   'API key'),
    (r'(?i)access[_-]?token\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}', 'access token value'),
    (r'(?i)auth[_-]?token\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}', 'auth token value'),
    (r'(?i)client[_-]?secret\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}', 'client secret'),
    (r'(?i)private[_-]?key\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}',   'private key value'),
    (r'(?i)occ[_-]?token\s*[=:]\s*(?![\s\'\"\{<])[^\s\'\",\}]{8,}',     'OCC token value'),
    (r'sk-[a-zA-Z0-9]{32,}',                                              'API key (sk- format)'),
    (r'(?i)bearer\s+[a-zA-Z0-9\-_\.]{30,}',                              'Bearer token value'),
    (r'-----BEGIN (?:RSA |EC )?PRIVATE KEY-----',                         'PEM private key block'),
]

# Platform-specific high-risk patterns (flag even without assignment). Renamed
# from HYBRIS_PATTERNS -- the regexes themselves are file-format/naming facts
# that stay as-is; only the org-specific label changed.
PLATFORM_PATTERNS = [
    (r'(?i)hybris[._-]system[._-]token\s*[=:]\s*\S', 'system token value'),
    (r'(?i)options\.json',                             'options.json reference (must not be committed)'),
]

# PHI / PII patterns
PHI_PATTERNS = [
    (r'(?i)patient[_\s-]?name\s*[=:]\s*[A-Za-z]{2,}',         'patient name (PHI)'),
    (r'(?i)date[_\s-]?of[_\s-]?birth\s*[=:]\s*\d',            'date of birth (PHI)'),
    (r'(?i)\bssn\b\s*[=:]\s*\d{3}',                            'SSN (PHI)'),
    (r'(?i)social[_\s-]?security\s*[=:]\s*\d',                 'social security number (PHI)'),
    (r'(?i)dental[_\s-]?practice[_\s-]?data\s*[=:]\s*\S',     'dental practice data (PHI)'),
]

# Known-safe placeholders -- suppress matches that contain these
SAFE_PLACEHOLDERS = [
    r'(?i)TEST_TOKEN',
    r'(?i)PLACEHOLDER',
    r'(?i)YOUR[_\s]TOKEN',
    r'(?i)<token>',
    r'(?i)example\.com',
    r'(?i)oakview\s+dental',
    r'(?i)\*{3,}',
    r'(?i)xxxxxx',
    r'(?i)\[redacted\]',
    r'(?i)\$\{.*?\}',   # environment variable substitution -- not a hardcoded value
    r'(?i)process\.env\.',
    r'(?i)System\.getenv\(',
    r'(?i)@Value\(',
]


def is_safe_placeholder(text: str) -> bool:
    return any(re.search(p, text) for p in SAFE_PLACEHOLDERS)


def scan(content: str) -> list:
    findings = []
    all_patterns = CREDENTIAL_PATTERNS + PLATFORM_PATTERNS + PHI_PATTERNS
    for pattern, label in all_patterns:
        for match in re.finditer(pattern, content):
            matched_text = match.group(0)
            if not is_safe_placeholder(matched_text):
                # Truncate for display -- never log the full value
                display = matched_text[:50] + ('...' if len(matched_text) > 50 else '')
                findings.append((label, display))
    return findings


def main():
    # CLI modes for git pre-commit / CI (same scan logic as Claude hook)
    if len(sys.argv) > 1 and sys.argv[1] in ("--scan-file", "--scan-stdin"):
        if sys.argv[1] == "--scan-file":
            if len(sys.argv) < 3:
                sys.stderr.write("usage: credential-scan.py --scan-file <path>\n")
                sys.exit(2)
            path = Path(sys.argv[2])
            if not path.is_file():
                sys.exit(0)
            content = path.read_text(encoding="utf-8", errors="replace")
        else:
            content = sys.stdin.read()
        findings = scan(content)
        if not findings:
            sys.exit(0)
        sys.stderr.write("\n[SECURITY BLOCK] Credential or PHI detected\n")
        for label, display in findings:
            sys.stderr.write(f"  {label}: {display}\n")
        sys.exit(1)

    try:
        raw = sys.stdin.read()
        data = json.loads(raw)
    except Exception:
        sys.exit(0)  # fail open -- do not block if hook input is malformed

    tool_input = data.get('tool_input', {})

    # Write tool -> 'content' field; Edit tool -> 'new_string' field
    content = tool_input.get('content') or tool_input.get('new_string') or ''

    if not content or not isinstance(content, str):
        sys.exit(0)

    findings = scan(content)

    if not findings:
        sys.exit(0)

    # Block the write -- output to stderr so Claude Code surfaces it
    sys.stderr.write('\n')
    sys.stderr.write('=' * 60 + '\n')
    sys.stderr.write('[SECURITY BLOCK] Credential or PHI detected\n')
    sys.stderr.write('=' * 60 + '\n')
    for label, display in findings:
        sys.stderr.write(f'  {label}: {display}\n')
    sys.stderr.write('\n')
    sys.stderr.write('Action required:\n')
    sys.stderr.write('  1. Remove the sensitive value from the content\n')
    sys.stderr.write('  2. Use a placeholder (TEST_TOKEN, ${ENV_VAR}, @Value)\n')
    contact = ''
    if titan_config:
        try:
            workspace = Path(os.environ.get('CLAUDE_PROJECT_DIR') or os.getcwd())
            info = titan_config.contacts_for(workspace, 'security')
            names = info.get('primary') or []
            contact = ', '.join(names)
        except Exception:
            contact = ''
    sys.stderr.write(f"  3. If this is a false positive, contact {contact or 'the security area owner (see `?gov security`)'}\n")
    sys.stderr.write('=' * 60 + '\n\n')
    sys.exit(1)


if __name__ == '__main__':
    main()
