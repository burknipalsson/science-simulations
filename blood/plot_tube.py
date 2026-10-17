# side and end views of all cells in a tube dump (DUMPALL)
import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
d = json.loads([l for l in open(sys.argv[1]) if l.startswith('DUMPALL ')][-1][8:])
F = d['F']; R = d['R']; cc = d['cc']; L = d['nx']
fig = plt.figure(figsize=(14, 5))
cols = plt.cm.Reds([0.5 + 0.5 * (i % 7) / 7 for i in range(len(d['cells']))])
for k, (el, az) in enumerate([(0, -90), (0, 0)]):
    ax = fig.add_subplot(1, 2, k + 1, projection='3d')
    for i, X in enumerate(d['cells']):
        cx = sum(p[0] for p in X) / len(X); sh = -L * (cx // L)
        Xs = [[p[0] + sh, p[1], p[2]] for p in X]
        ax.add_collection3d(Poly3DCollection([[Xs[j] for j in f] for f in F[::2]], facecolor=cols[i], edgecolor='none', alpha=0.95))
    ax.set_xlim(0, L); ax.set_ylim(cc - R, cc + R); ax.set_zlim(cc - R, cc + R)
    ax.view_init(el, az); ax.set_box_aspect((L, 2 * R, 2 * R) if k == 0 else (1, 1, 1))
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=80)
