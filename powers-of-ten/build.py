import re, os, base64
strip = lambda src: re.sub(r"if \(typeof module !== ['\"]undefined['\"]\)[^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
s = s.replace('<!--SECTIONS-->', ''.join(rd(f) for f in sorted(os.listdir('.')) if f.startswith('sec_') and f.endswith('.html')))
b64 = lambda f: base64.b64encode(open(f, 'rb').read()).decode()
TEX = {'earth': 'earth_oct_4096.jpg', 'iceland': 'iceland_500m.jpg', 'moon': 'moon.jpg', 'night': 'earth_night.jpg', 'rvk11': 'rvk_z11.jpg', 'rvk13': 'rvk_z13.jpg'}
tex = 'globalThis.PTEN_TEX = {%s};\n' % ', '.join('%s: "%s"' % (k, b64('data/tex/' + f)) for k, f in TEX.items())
FILES = ['data.js', 'sstars_data.js'] + (['web_data.js'] if os.path.exists('web_data.js') else []) + ['site_data.js', 'wind_data.js', 'blood_data.js', 'hb_data.js', 'water_data.js', 'qc_data.js', 'scale.js', 'sgr.js', 'm31.js', 'person.js', 'inner.js', 'zoom.js', 'galaxy.js', 'density.js', 'render.js', 'layers.js', 'layers_trip.js', 'layers_site.js', 'layers_blood.js', 'layers_mol.js', 'layers_person.js', 'app.js']
src = tex + '\n'.join(strip(rd(f)) for f in FILES)
assert '</script' not in src
assert s.count('/*SRC*/') == 1
s = s.replace('/*SRC*/', src)
open('powers-of-ten.html', 'w').write(s)
print(len(s) // 1024, 'KB')
