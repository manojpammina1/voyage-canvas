#!/usr/bin/env bash
# Titan -- thin wrapper so settings.json / check-hook-paths.mjs can keep
# invoking a shell entry point without knowing the hook is implemented in
# Python. All logic lives in session-start.py.
exec python "$(dirname "$0")/session-start.py"
