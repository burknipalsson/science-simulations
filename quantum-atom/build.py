import re
strip = lambda src: re.sub(r"if \(typeof module !== ['\"]undefined['\"]\)[^\n]*\n?", '', src)
rd = lambda f: open(f).read()
s = rd('page_head.html') + rd('page_body.html')
import os
sections = ''.join(rd(f) for f in ['sec_guide.html', 'sec_tunnel.html', 'sec_atom.html', 'sec_bond.html', 'sec_mri.html', 'sec_numbers.html'] if os.path.exists(f))
s = s.replace('<!--SECTIONS-->', sections)
FILES = ['tdse_cpu.js', 'tdse_gpu.js', 'scenes.js', 'wave_viz.js', 'hydrogen.js', 'h2plus.js', 'atom_data.js', 'bond_data.js', 'app.js']
import os
FILES += [f for f in ['tunnel.js', 'atom.js', 'atom_ui.js', 'bond.js', 'bloch.js', 'mri.js', 'sections.js'] if os.path.exists(f)]
src = '\n'.join(strip(rd(f)) for f in FILES)
assert '</script' not in src
assert s.count('/*SRC*/') == 1
s = s.replace('/*SRC*/', src)
open('quantum-atom.html', 'w').write(s)
print(len(s) // 1024, 'KB')
