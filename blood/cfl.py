# radial distribution of membrane vertices in a tube dump, and the cell-free layer (wall gap to the outermost membrane)
import json, sys, math
d = json.loads([l for l in open(sys.argv[1]) if l.startswith('DUMPALL ')][-1][8:])
R, cc, L = d['R'], d['cc'], d['nx']
rs = [math.hypot(p[1] - cc, p[2] - cc) for X in d['cells'] for p in X]
nb = 20; h = [0] * nb
for r in rs: h[min(nb - 1, int(r / R * nb))] += 1
for i, c in enumerate(h): print(f"r {i / nb * R:5.2f}-{(i + 1) / nb * R:5.2f} µm  {'#' * int(60 * c / max(h))}  {c}")
# CFL: in 1 µm axial bins, the outermost membrane radius; layer = R - that, averaged
bins = {}
for X in d['cells']:
    for p in X:
        b = int((p[0] % L) // 1.0); r = math.hypot(p[1] - cc, p[2] - cc)
        bins[b] = max(bins.get(b, 0), r)
w = [R - v for v in bins.values()]
print(f"cell-free layer: mean {sum(w) / len(w):.2f} µm (min {min(w):.2f}, max {max(w):.2f}) over {len(w)} axial 1-µm bins")
