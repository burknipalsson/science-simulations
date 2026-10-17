#!/bin/sh
cd /home/bp/workspace/claude/blood
node gpu_run.js tube 20 50 0.2 60 20 300 '{"init":"rsa","every":20,"dump":1,"GsL":0.0005}' > r20c_re.log 2>&1
node gpu_run.js tube 20 50 0.2 60 10 300 '{"init":"rsa","every":20,"dump":1,"fill":0.33}' > r20c_fill.log 2>&1
