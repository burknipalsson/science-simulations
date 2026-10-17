# Sentinel-2 cloudless 2024 (EOX, CC BY-NC-SA 4.0) mosaics around Hallgrimskirkja, in Web Mercator tiles.
import math, urllib.request, io, sys, os
from PIL import Image
lat, lon = 64.14167, -21.92667
out = os.path.join(os.path.dirname(__file__), 'tex')
def tile(z, x, y):
    u = f'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg'
    return Image.open(io.BytesIO(urllib.request.urlopen(u).read())).convert('RGB')
meta = {}
for z, n in ((11, 8), (13, 6)):
    N = 2 ** z; fx = (lon + 180) / 360 * N
    fy = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * N
    x0, y0 = int(fx - n / 2 + 0.5), int(fy - n / 2 + 0.5)
    im = Image.new('RGB', (256 * n, 256 * n))
    for j in range(n):
        for i in range(n): im.paste(tile(z, x0 + i, y0 + j), (256 * i, 256 * j))
    im.save(f'{out}/rvk_z{z}.jpg', quality=84)
    meta[z] = (x0, y0, n)
    print(z, x0, y0, n, 'site at tile', fx - x0, fy - y0)
print(meta)
