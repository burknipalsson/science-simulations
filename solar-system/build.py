import re, sys
s = open('page.html').read()
strip = lambda src: re.sub(r"if \(typeof module !== 'undefined'\) module.exports = \w+;\n?", '', src)
for tag, files in [('/*DATA*/', ['data.js']), ('/*PHYS*/', ['phys.js']), ('/*ECL*/', ['eclipse.js']), ('/*AST*/', ['ast.js']), ('/*ENGINE*/', ['engine.js']), ('/*APP*/', ['app.js', 'sections.js'])]:
    s = s.replace(tag, '\n'.join(strip(open(f).read()) for f in files))
open('the-clockwork.html', 'w').write(s)
print(len(s), 'bytes')
