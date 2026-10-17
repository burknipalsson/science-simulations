#!/bin/sh
# build, then copy a test copy (with the charset and viewport tags the artifact skeleton normally adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/953aad10-51c2-4576-8d67-5b09579d9df8/scratchpad
cd /home/bp/workspace/claude/solar-system && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat the-clockwork.html; } > $SP/test.html
