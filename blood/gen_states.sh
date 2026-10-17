#!/bin/sh
# developed suspension states for the page (coarse grid, lambda 5): tube D, haematocrit, run 400 ms
cd /home/bp/workspace/claude/blood
for spec in "10 0.17" "20 0.2" "30 0.2"; do set -- $spec
  node gpu_run.js tube $1 50 $2 60 20 400 '{"init":"rsa","every":50,"dump":1,"lambda":5}' > state_$1.log 2>&1
done
