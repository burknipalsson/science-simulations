#!/bin/sh
# build, then write a test copy (with the charset/viewport tags the artifact skeleton adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/fab86ba8-25f1-4aab-a494-ef82e4c1167e/scratchpad
cd /home/bp/workspace/claude/water && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat water.html; } > $SP/test.html
