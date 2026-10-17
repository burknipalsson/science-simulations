#!/bin/sh
cd /home/bp/workspace/claude/water
for T in 250 260 270 280 290 298 310 320; do for r in a b; do node run_npt.js $T 512 200 9 0.2 > logs/s1_rc9_${T}_$r.json & done; done
for T in 260 280 298 320; do node run_npt.js $T 512 200 10 0.2 > logs/s1_rc10_${T}.json & done
node run_npt.js 298 512 200 12 0.2 > logs/s1_rc12_298.json &
node run_npt.js 298 512 200 9 0.25 > logs/s1_rc9a25_298.json &
wait
