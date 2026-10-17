import re,sys
s=open('page.html').read()
for tag,f in [('/*COSMO*/','cosmo.js'),('/*ENGINE*/','engine.js'),('/*APP*/','app.js')]:
    s=s.replace(tag,open(f).read().replace("if (typeof module !== 'undefined') module.exports = Cosmo;\n",""))
open('cosmic-web.html','w').write(s)
print(len(s),'bytes')
