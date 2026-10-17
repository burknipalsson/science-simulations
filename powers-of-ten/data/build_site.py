# The street-level rung around Hallgrimskirkja: terrain, buildings and ground features from measured data.
#  - terrain: ArcticDEM (WGS84 ellipsoidal heights, via the Mapzen/AWS Terrarium tiles at zoom 15, ~2.1 m pixels).
#    It is a surface model (roofs and trees included), so buildings are masked out and the bare ground is
#    recovered with a grey-scale opening; the difference between the two gives each building's measured height.
#  - buildings and ground: OpenStreetMap (ODbL), including the church's own 3D parts with surveyed heights.
#  - roof colours: Sentinel-2 cloudless 2024 (EOX) at the roof's centre where OSM has no roof colour.
# Writes ../site_data.js (PTEN_SITE). Positions are ENU metres about the site origin, an ellipsoidal height in metres.
import json, math, os, base64, gzip, io
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
LAT0, LON0 = 64.14167, -21.92667            # the landing point (scale.js SITE)
A, F = 6378137.0, 1 / 298.257223563; E2 = F * (2 - F)
D = math.pi / 180
def ecef(lat, lon, h):
    la, lo = lat * D, lon * D; N = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return np.array([(N + h) * math.cos(la) * math.cos(lo), (N + h) * math.cos(la) * math.sin(lo), (N * (1 - E2) + h) * math.sin(la)])
def enu_axes(lat, lon):
    la, lo = lat * D, lon * D
    e = np.array([-math.sin(lo), math.cos(lo), 0]); n = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    u = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    return np.stack([e, n, u])

# ---- DEM mosaic (zoom 15, tiles x 14385..14391, y 8706..8713) ----
Z = 15; NT = 2 ** Z; TX0, TY0, NTX, NTY = 14385, 8706, 7, 8
def tile(x, y):
    a = np.asarray(Image.open(f'{HERE}/dl/dem/15_{x}_{y}.png').convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
dsm = np.block([[tile(x, y) for x in range(TX0, TX0 + NTX)] for y in range(TY0, TY0 + NTY)])
def merc(lat, lon):  # global pixel coordinates at zoom 15
    return ((lon + 180) / 360 * NT * 256, (1 - math.log(math.tan(lat * D) + 1 / math.cos(lat * D)) / math.pi) / 2 * NT * 256)
def unmerc(px, py):
    lon = px / (NT * 256) * 360 - 180; lat = math.atan(math.sinh(math.pi * (1 - 2 * py / (NT * 256)))) / D
    return lat, lon
PX0, PY0 = TX0 * 256, TY0 * 256
def dsm_px(lat, lon):
    x, y = merc(lat, lon); return x - PX0, y - PY0

# ---- OSM ----
els = json.load(open(f'{HERE}/dl/osm/site.json'))['elements']
# the church's 3D parts are multipolygon relations, fetched separately
seen = {(e['type'], e['id']) for e in els}
els += [e for e in json.load(open(f'{HERE}/dl/osm/church_rel.json'))['elements'] if (e['type'], e['id']) not in seen]
nodes = {e['id']: (e['lat'], e['lon']) for e in els if e['type'] == 'node'}
ways = {e['id']: e for e in els if e['type'] == 'way'}
O = ecef(LAT0, LON0, 0); RT = enu_axes(LAT0, LON0)
def to_en(lat, lon):
    v = RT @ (ecef(lat, lon, 0) - O); return v[0], v[1]
R_EXT = 1000.0                                 # half-width of the modelled square (m)
def ring_en(ids): return [to_en(*nodes[i]) for i in ids if i in nodes]

# building footprints mask on the DSM grid (dilated) -> bare-earth model
blds = []
def tags_of(e): return e.get('tags', {})
for e in els:
    t = tags_of(e)
    if e['type'] == 'way' and ('building' in t or 'building:part' in t) and e['nodes'][0] == e['nodes'][-1]:
        blds.append(dict(id=e['id'], tags=t, ll=[nodes[i] for i in e['nodes'] if i in nodes]))
    if e['type'] == 'relation' and ('building' in t or t.get('building:part', 'no') != 'no'):
        for m in e['members']:
            w = ways.get(m['ref'])
            if m['type'] == 'way' and m['role'] == 'outer' and w and w['nodes'][0] == w['nodes'][-1]:
                blds.append(dict(id=w['id'], tags=t, ll=[nodes[i] for i in w['nodes'] if i in nodes]))
        # multipolygon outers made of many open ways: stitch them
        outer = [ways[m['ref']]['nodes'] for m in e['members'] if m['type'] == 'way' and m['role'] == 'outer' and m['ref'] in ways and ways[m['ref']]['nodes'][0] != ways[m['ref']]['nodes'][-1]]
        while outer:
            ring = list(outer.pop(0)); grown = True
            while grown and ring[0] != ring[-1]:
                grown = False
                for k, w in enumerate(outer):
                    if w[0] == ring[-1]: ring += w[1:]; outer.pop(k); grown = True; break
                    if w[-1] == ring[-1]: ring += w[::-1][1:]; outer.pop(k); grown = True; break
            if ring[0] == ring[-1] and len(ring) > 3: blds.append(dict(id=e['id'], tags=t, ll=[nodes[i] for i in ring if i in nodes]))
mask = Image.new('L', (dsm.shape[1], dsm.shape[0]), 0)
from PIL import ImageDraw
dr = ImageDraw.Draw(mask)
for b in blds: dr.polygon([dsm_px(*p) for p in b['ll']], fill=255)
mask = np.asarray(mask) > 0
mask_d = ndimage.binary_dilation(mask, iterations=2)
# bare earth: remove buildings (fill from the nearest unmasked ground), then a grey opening (trees, cars), then smooth
g = dsm.copy(); g[g < -1] = 0          # sea at 0 (geoid) in the source; land is ellipsoidal there: fixed below
idx = ndimage.distance_transform_edt(mask_d, return_distances=False, return_indices=True)
g = g[tuple(idx)]
g = ndimage.grey_opening(g, size=(9, 9))            # ~19 m: removes trees and vehicles
g = ndimage.gaussian_filter(g, 1.5)
# the terrarium tiles put open sea at ~0 (geoid) but ArcticDEM land at ellipsoidal heights (+~66 m): the
# sea surface sits at the geoid, N = 66.0 m here (EGM2008 at Reykjavik ~ 65.9-66.4 m). Land below the sea surface is set to it.
GEOID = 66.0
sea = dsm < 20
# DEM blunders over the harbour water (bright blobs well above any shore land) touching the sea are sea too
lab, nl = ndimage.label(~sea & (dsm > 118))
near = ndimage.binary_dilation(sea, iterations=3)
for k in range(1, nl + 1):
    comp = lab == k
    if (comp & near).any() and comp.sum() < 40000: sea |= comp
sea = ndimage.binary_fill_holes(sea) | sea
g[sea] = GEOID
g = np.maximum(g, GEOID)

def bilin(a, x, y):
    x0, y0 = int(math.floor(x)), int(math.floor(y)); fx, fy = x - x0, y - y0
    return (a[y0, x0] * (1 - fx) + a[y0, x0 + 1] * fx) * (1 - fy) + (a[y0 + 1, x0] * (1 - fx) + a[y0 + 1, x0 + 1] * fx) * fy
h0 = bilin(g, *dsm_px(LAT0, LON0))
print('ground at the origin: %.1f m ellipsoidal = %.1f m above sea (geoid %.1f)' % (h0, h0 - GEOID, GEOID))

# terrain grid in ENU: STEP m, heights relative to h0, with Earth curvature folded in (z_enu = h - h0 - r^2/2R)
STEP = 4.0; NG = int(2 * R_EXT / STEP) + 1
# invert ENU -> lat/lon for the grid (small area: iterate)
def en_to_ll(e, n):
    lat, lon = LAT0, LON0
    for _ in range(3):
        de, dn = to_en(lat, lon); lat += (n - dn) / 111200; lon += (e - de) / (111200 * math.cos(lat * D))
    return lat, lon
Hg = np.zeros((NG, NG)); Dg = np.zeros((NG, NG))
for j in range(NG):
    for i in range(NG):
        e, n = -R_EXT + i * STEP, -R_EXT + j * STEP
        lat, lon = en_to_ll(e, n); x, y = dsm_px(lat, lon)
        Hg[j, i] = bilin(g, x, y); Dg[j, i] = bilin(dsm, x, y)
curv = ((np.arange(NG)[None, :] * STEP - R_EXT) ** 2 + (np.arange(NG)[:, None] * STEP - R_EXT) ** 2) / (2 * 6.36e6)
Zt = Hg - h0 - curv
print('terrain grid', NG, 'x', NG, 'z range %.1f .. %.1f m' % (Zt.min(), Zt.max()))

# ---- buildings: footprints in ENU, base on the bare ground, top from tags or the measured surface ----
s2 = Image.open(f'{HERE}/tex/rvk_z13.jpg').convert('RGB'); S2 = np.asarray(s2)
def s2col(lat, lon):
    n = 2 ** 13; x = (lon + 180) / 360 * n - 3594; y = (1 - math.log(math.tan(lat * D) + 1 / math.cos(lat * D)) / math.pi) / 2 * n - 2174
    px, py = int(x * 256), int(y * 256)
    if 0 <= px < S2.shape[1] and 0 <= py < S2.shape[0]: return S2[max(0, py - 1):py + 2, max(0, px - 1):px + 2].reshape(-1, 3).mean(0)
    return None
def colour(s, default):
    NAMED = {'white': (235, 235, 230), 'red': (170, 60, 50), 'silver': (190, 192, 196), 'black': (40, 40, 40), 'grey': (150, 150, 150), 'gray': (150, 150, 150),
             'yellow': (220, 200, 120), 'blue': (90, 120, 170), 'green': (90, 140, 100), 'brown': (120, 85, 60), 'beige': (220, 205, 175)}
    if not s: return default
    s = s.strip().lower()
    if s.startswith('#') and len(s) == 7: return tuple(int(s[k:k + 2], 16) for k in (1, 3, 5))
    return NAMED.get(s, default)
def num(x):
    try: return float(str(x).split()[0].replace(',', '.'))
    except Exception: return None
from matplotlib.path import Path as MPath
# parts belong to an outline if their centroid falls inside it; outlines with parts are drawn through their parts only
outs = [b for b in blds if 'building' in b['tags'] and b['tags'].get('building:part', 'no') == 'no']
parts = [b for b in blds if 'building:part' in b['tags'] and b['tags']['building:part'] != 'no']
for b in blds: b['en'] = [to_en(*p) for p in b['ll']]
has_parts = set()
for o in outs:
    P = MPath(o['en'])
    for p in parts:
        c = np.mean(p['en'], axis=0)
        if P.contains_point(c): has_parts.add(id(o))
out = []
nmeas = ntag = nlev = 0
for b in outs + parts:
    if id(b) in has_parts: continue
    en = b['en']; c = np.mean(en, axis=0)
    if abs(c[0]) > R_EXT - 10 or abs(c[1]) > R_EXT - 10 or len(en) < 4: continue
    t = b['tags']
    # ground: lowest bare-earth height under the footprint
    xs = [dsm_px(*p) for p in b['ll']]
    base = min(bilin(g, x, y) for x, y in xs) - h0
    H = num(t.get('height')); minh = num(t.get('min_height')) or 0.0
    lev = num(t.get('building:levels')); minlev = num(t.get('building:min_level')) or 0
    src = 'tag'
    if H is None:
        # measured: the surface model's upper roof level inside the footprint (eroded by a pixel) above the ground
        m = Image.new('L', (dsm.shape[1], dsm.shape[0]), 0); ImageDraw.Draw(m).polygon(xs, fill=255)
        mm = ndimage.binary_erosion(np.asarray(m) > 0, iterations=1)
        if 'building:part' in t or mm.sum() < 4:
            if lev is not None: H = lev * 3.2 + (1.5 if 'roof:shape' in t and t['roof:shape'] not in ('flat',) else 0); src = 'levels'
            else: H = 7.0; src = 'default'
        else:
            vals = dsm[mm]; gnd = g[mm]
            H = float(np.percentile(vals - gnd, 85)); src = 'measured'
            if H < 2.5 or H > 60: H = (lev or 2) * 3.2; src = 'levels'
    if lev is not None and minlev and not t.get('min_height'): minh = minlev * 3.2
    nmeas += src == 'measured'; ntag += src == 'tag'; nlev += src == 'levels'
    roofh = num(t.get('roof:height')) or 0.0
    wall = colour(t.get('building:colour'), (226, 222, 212))
    rc = colour(t.get('roof:colour'), None)
    if rc is None:
        sc = s2col(*np.mean(b['ll'], axis=0)); rc = tuple(int(x) for x in sc) if sc is not None else (120, 120, 120)
    church = b['id'] in (414884124,) or 'Hallgr' in t.get('name', '') or (t.get('building:colour') == '#CCCCCC')
    ring = en[:-1] if en[0] == en[-1] else en
    # counter-clockwise rings
    a2 = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    if a2 < 0: ring = ring[::-1]
    out.append(dict(r=[[round(x, 2), round(y, 2)] for x, y in ring], z0=round(base + minh, 2), z1=round(base + H - roofh, 2), rh=roofh,
                    rs=t.get('roof:shape', 'flat') if roofh > 0 else 'flat', w=wall, rc=rc, c=int(church)))
print('buildings', len(out), 'heights: tagged', ntag, 'measured', nmeas, 'levels', nlev)

# ---- ground features (vectors, rasterised in the page) ----
W = {'motorway': 14, 'trunk': 13, 'primary': 12, 'secondary': 10, 'tertiary': 8, 'residential': 6.5, 'unclassified': 6, 'living_street': 5,
     'service': 4, 'pedestrian': 5, 'footway': 2.2, 'path': 1.8, 'cycleway': 2.2, 'steps': 2.5, 'primary_link': 7, 'trunk_link': 7, 'secondary_link': 6, 'track': 3}
roads, areas = [], []
def inside(en): return any(abs(x) < R_EXT and abs(y) < R_EXT for x, y in en)
for e in els:
    if e['type'] != 'way': continue
    t = tags_of(e)
    en = [to_en(*nodes[i]) for i in e['nodes'] if i in nodes]
    if len(en) < 2 or not inside(en): continue
    pts = [[round(x, 1), round(y, 1)] for x, y in en]
    closed = e['nodes'][0] == e['nodes'][-1]
    hw = t.get('highway')
    if 'area:highway' in t and closed: areas.append(dict(k='paved', p=pts)); continue
    if hw and hw in W and not (closed and t.get('area') == 'yes'):
        roads.append(dict(k=hw, w=W[hw], p=pts, s=t.get('surface', ''))); continue
    if hw == 'pedestrian' and closed: areas.append(dict(k='paved', p=pts)); continue
    lu = t.get('landuse') or t.get('leisure') or t.get('natural') or t.get('amenity')
    if lu and closed:
        k = {'grass': 'grass', 'park': 'grass', 'recreation_ground': 'grass', 'grassland': 'grass', 'dog_park': 'grass', 'heath': 'grass', 'religious': 'grass',
             'wood': 'trees', 'scrub': 'trees', 'tree_row': 'trees', 'playground': 'play', 'pitch': 'pitch', 'swimming_pool': 'pool', 'water': 'water',
             'parking': 'paved', 'wetland': 'grass', 'outdoor_seating': 'paved'}.get(lu)
        if k: areas.append(dict(k=k, p=pts))
    elif t.get('natural') == 'tree_row': roads.append(dict(k='treerow', w=5, p=pts, s=''))
    elif t.get('natural') == 'coastline': roads.append(dict(k='coast', w=0, p=pts, s=''))
print('roads', len(roads), 'areas', len(areas))

def b64gz(arr): return base64.b64encode(gzip.compress(arr.tobytes(), 9)).decode()
zcm = np.round(Zt * 100).astype(np.int32)
# delta-encode rows for compression
d = np.diff(np.concatenate([np.zeros((NG, 1), np.int32), zcm], axis=1), axis=1).astype(np.int16)
sea_m = (Hg <= GEOID + 0.05).astype(np.uint8)
# the person stands on Hallgrimstorg in front of the tower; ground height there from the bare-earth model
PE, PN = -38.0, 70.0
fi, fj = (PE + R_EXT) / STEP, (PN + R_EXT) / STEP
pz = bilin(Zt, fi, fj)
print('person ground z %.2f m (relative to the origin)' % pz)
# affine map from site ENU metres to pixels of the Sentinel-2 zoom-13 mosaic (tex/rvk_z13.jpg, tiles x 3594.., y 2174..)
def s2px(lat, lon):
    n = 2 ** 13; return ((lon + 180) / 360 * n - 3594) * 256, ((1 - math.log(math.tan(lat * D) + 1 / math.cos(lat * D)) / math.pi) / 2 * n - 2174) * 256
p0 = np.array(s2px(LAT0, LON0)); pe = np.array(s2px(*en_to_ll(1000, 0))); pn = np.array(s2px(*en_to_ll(0, 1000)))
s2aff = [*(p0.tolist()), *((pe - p0) / 1000).tolist(), *((pn - p0) / 1000).tolist()]   # px = p0 + e*a + n*b
site = dict(s2aff=[round(x, 5) for x in s2aff], person=dict(e=PE, n=PN, z=round(float(pz), 3)), origin=dict(lat=LAT0, lon=LON0, h=round(float(h0), 2), geoid=GEOID), terrain=dict(n=NG, step=STEP, ext=R_EXT, dz=b64gz(d), sea=b64gz(sea_m)),
            bld=out, roads=roads, areas=areas)
# the vectors travel gzipped: the page inflates them with DecompressionStream
vec = json.dumps(dict(bld=out, roads=roads, areas=areas), separators=(',', ':'))
site.pop('bld'); site.pop('roads'); site.pop('areas'); site['vec'] = base64.b64encode(gzip.compress(vec.encode(), 9)).decode()
js = 'globalThis.PTEN_SITE = ' + json.dumps(site, separators=(',', ':')) + ';\n'
open(f'{HERE}/../site_data.js', 'w').write(js)
print('site_data.js', len(js) // 1024, 'KB')
