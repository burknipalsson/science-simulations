#!/bin/sh
# build, then write a test copy (with the charset/viewport tags the artifact skeleton adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/c54b9fb6-22c5-41af-892d-7d2c65ae016b/scratchpad
cd /home/bp/workspace/claude/the-atmosphere && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat the-atmosphere.html; } > $SP/test.html
