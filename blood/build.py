import re, os
strip = lambda src: re.sub(r"if \(typeof module !== ['\"]undefined['\"]\)[^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
sections = ''.join(rd(f) for f in ['sec_guide.html', 'sec_thin.html', 'sec_numbers.html', 'sec_how.html'] if os.path.exists(f))
s = s.replace('<!--SECTIONS-->', sections)
FILES = ['mesh.js', 'membrane.js', 'units.js', 'pries.js', 'pack.js', 'gpu.js', 'viz.js', 'states.js', 'replay.js', 'app.js', 'sections.js']
src = '\n'.join(strip(rd(f)) for f in FILES if os.path.exists(f))
assert '</script' not in src
assert s.count('/*SRC*/') == 1
s = s.replace('/*SRC*/', src)
open('blood.html', 'w').write(s)
print(len(s) // 1024, 'KB')
