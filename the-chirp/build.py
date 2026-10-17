import re
s = open('page.html').read()
for tag, f in [('/*WAVE*/', 'wave.js'), ('/*ENGINE*/', 'engine.js'), ('/*APP*/', 'app.js')]:
    s = s.replace(tag, re.sub(r"if \(typeof module !== 'undefined'\) module.exports = \w+;\n?", '', open(f).read()))
open('the-chirp.html', 'w').write(s)
print(len(s), 'bytes')
