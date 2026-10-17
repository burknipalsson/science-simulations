# radial distribution of cell centres (and vertices) in a tube dump, in units of R
import json, sys, math
d = json.loads([l for l in open(sys.argv[1]) if l.startswith('DUMPALL ')][-1][8:])
R, cc = d['R'], d['cc']
rc = sorted(math.hypot(sum(p[1] for p in X) / len(X) - cc, sum(p[2] for p in X) / len(X) - cc) / R for X in d['cells'])
print('cell centre r/R:', ' '.join(f'{r:.2f}' for r in rc))
nb = 5; h = [0] * nb
for r in rc: h[min(nb - 1, int(r * nb))] += 1
area = [((i + 1) ** 2 - i ** 2) / nb ** 2 for i in range(nb)]
print('number density per area (relative):', ' '.join(f'{h[i] / area[i] / len(rc):.2f}' for i in range(nb)))
# Poiseuille-weighted mean speed of centres: 2(1 - r^2)
print('mean of 2(1-r^2) over centres:', round(sum(2 * (1 - r * r) for r in rc) / len(rc), 3))
