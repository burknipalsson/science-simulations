import re
strip = lambda src: re.sub(r"if \(typeof module !== 'undefined'\) module.exports = [^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
src = '\n'.join(strip(rd(f)) for f in ['lbm_gpu.js', 'shapes.js', 'viz.js', 'app.js', 'sections.js'])
assert '</script' not in src
assert s.count('/*SRC*/') == 1
s = s.replace('/*SRC*/', src)
open('wind-tunnel.html', 'w').write(s)
print(len(s) // 1024, 'KB')
