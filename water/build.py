import re
strip = lambda src: re.sub(r"if \(typeof module !== 'undefined'\)[^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
src = '\n'.join(strip(rd(f)) for f in ['data.js', 'states.js', 'ice.js', 'md_gpu.js', 'viz.js', 'scenes.js', 'app.js', 'sections.js'])
assert '</script' not in src
assert s.count('/*SRC*/') == 1
s = s.replace('/*SRC*/', src)
open('water.html', 'w').write(s)
print(len(s) // 1024, 'KB')
