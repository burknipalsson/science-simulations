# quick look at dumped cell meshes: side and end views (usage: python3 plot_cell.py log png)
import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
d = json.loads([l for l in open(sys.argv[1]) if l.startswith('DUMP ')][-1][5:])
X, F = d['X'], d['F']
fig = plt.figure(figsize=(12, 4))
for k, (el, az, title) in enumerate([(0, -90, 'side (flow →)'), (0, 0, 'end-on'), (25, -60, 'oblique')]):
    ax = fig.add_subplot(1, 3, k + 1, projection='3d')
    ax.add_collection3d(Poly3DCollection([[X[i] for i in f] for f in F], facecolor='#c8443a', edgecolor='#5a1a14', linewidths=0.1, alpha=0.9))
    c = [sum(p[i] for p in X) / len(X) for i in range(3)]
    for s, cc in zip('xyz', c): getattr(ax, f'set_{s}lim')(cc - 5, cc + 5)
    ax.view_init(el, az); ax.set_box_aspect((1, 1, 1)); ax.set_title(title)
plt.tight_layout(); plt.savefig(sys.argv[2], dpi=90)
