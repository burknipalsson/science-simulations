#!/bin/sh
# build and copy a test copy (with charset) to the scratchpad server
SP=/tmp/claude-1000/-home-bp-workspace-claude/54522260-6f94-4757-9634-8d4190f7c481/scratchpad
python3 build.py && { echo '<meta charset="utf-8">'; cat the-chirp.html; } > $SP/test.html
