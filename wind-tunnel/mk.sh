#!/bin/sh
# build, then write a test copy (with the charset/viewport tags the artifact skeleton adds) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/8c606473-aa7d-46ba-b83f-fcf536a43dd5/scratchpad
cd /home/bp/workspace/claude/wind-tunnel && python3 build.py && { echo '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'; cat wind-tunnel.html; } > $SP/test.html
