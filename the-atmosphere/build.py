import re, base64, os
strip = lambda src: re.sub(r"if \(typeof module !== 'undefined'\) module.exports = [^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
b64 = lambda f: base64.b64encode(open(f, 'rb').read()).decode()
data = 'const PACK_B64 = "%s";\nconst IMG = { day: "data:image/jpeg;base64,%s", night: "data:image/jpeg;base64,%s", land: "data:image/png;base64,%s", elev: "data:image/png;base64,%s" };' % (
    open('data/pack.b64').read().strip(), b64('data/day4096.jpg'), b64('data/night2048.jpg'), b64('data/land4096.png'), b64('data/elev.png'))
wsrc = '\n'.join(strip(rd(f)) for f in ['spectral.js', 'model.js', 'physics.js', 'setup.js', 'simworker.js'])
assert '</script' not in wsrc
parts = {'/*WSRC*/': wsrc, '/*WSCOPE*/': 'function WorkerScope(self) {\n' + wsrc + '\n}', '/*DATA*/': data, '/*SPECTRAL*/': strip(rd('spectral.js')), '/*ENGINE*/': strip(rd('engine.js')),
         '/*APP*/': '\n'.join(strip(rd(f)) for f in ['app.js'] + (['sections.js'] if os.path.exists('sections.js') else []))}
for k, v in parts.items():
    assert s.count(k) == 1, k
    s = s.replace(k, v.replace('\\', '\\\\') if False else v)
open('the-atmosphere.html', 'w').write(s)
print(len(s) // 1024, 'KB')
