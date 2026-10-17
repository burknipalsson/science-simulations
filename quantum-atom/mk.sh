#!/bin/sh
# build, then write a test copy (with the charset/viewport tags the artifact skeleton adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/0d0a3e2d-f998-4bfd-ba6b-319a3e10fcef/scratchpad
cd /home/bp/workspace/claude/quantum-atom && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat quantum-atom.html; } > $SP/test.html
