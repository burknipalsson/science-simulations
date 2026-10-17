#!/bin/sh
# build, then write a test copy (with the charset/viewport tags the artifact skeleton adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/252ea527-5c0f-4e10-abec-2c475371f89c/scratchpad
cd /home/bp/workspace/claude/blood && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat blood.html; } > $SP/test.html
