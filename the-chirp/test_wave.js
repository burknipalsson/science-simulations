const Wave = require('./wave.js');
function report(name, o){
  const w = Wave.build(o);
  const tAtF = F => { for (let i = 0; i < w.n; i++) if (w.f[i] >= F) return w.t[i]; return NaN; };
  const cyc = (fa, fb) => { let i0=-1,i1=-1; for (let i=0;i<w.n;i++){ if(i0<0&&w.f[i]>=fa)i0=i; if(i1<0&&w.f[i]>=fb)i1=i;} return (w.ph[i1]-w.ph[i0])/(2*Math.PI); };
  // smoothness: max relative jump in f and a between consecutive samples near the match
  let jf=0, ja=0; for (let i=1;i<w.n;i++){ jf=Math.max(jf,Math.abs(w.f[i]-w.f[i-1])/w.f[i]); ja=Math.max(ja,Math.abs(w.a[i]-w.a[i-1])/(w.a[i]+1e-30)); }
  const im = w.t.findIndex(t => t >= w.tMatch);
  const slope = k => (w.a[k+1]-w.a[k])/(w.t[k+1]-w.t[k]);
  console.log(`\n== ${name}: ${w.m1}+${w.m2} z=${w.z.toFixed(3)} D=${w.D.toFixed(0)} Mpc  samples ${w.n}`);
  console.log(`  start ${o.fStart} Hz at t = ${w.tStart.toFixed(4)} s   ; 35 Hz at t = ${tAtF(35).toFixed(4)} s ; 30 Hz at ${tAtF(30).toFixed(3)} s`);
  if (!w.bns) console.log(`  cycles 35→150 Hz: ${cyc(35,150).toFixed(1)}   peak |h| at f = ${w.fPeak.toFixed(1)} Hz   QNM f = ${w.fQNM.toFixed(1)} Hz, tau = ${(w.tauQNMs*1e3).toFixed(2)} ms`);
  console.log(`  final mass ${(w.Msrc*w.Mf).toFixed(1)}  spin ${w.af.toFixed(3)}  Erad fit ${w.Eradfit? (w.Eradfit*w.Msrc).toFixed(2):'-'}  model(22) ${(w.E22*w.Msrc).toFixed(2)}  scale ${w.eScale.toFixed(3)}`);
  console.log(`  peak |rh22/M| = ${w.aPeak.toFixed(4)} (= ${(w.aPeak/w.eta).toFixed(3)} η; NR equal-mass ≈ 1.57 η)  peak strain ${(w.aPeak*w.hScale).toExponential(2)}`);
  console.log(`  peak power ${w.Ppeak.toExponential(2)} W   match at t=${(w.tMatch*1e3).toFixed(2)} ms  bodies merge at ${(w.tMergeBodies*1e3).toFixed(2)} ms`);
  console.log(`  amp slope across match: ${slope(im-2).toExponential(3)} ${slope(im+1).toExponential(3)}   max jump f ${jf.toExponential(2)} a ${ja.toExponential(2)}`);
  console.log(`  f at t=-0.2s: ${w.f[Wave.idx(w,-0.2)].toFixed(1)} Hz  v/c at peak ${Math.pow(w.w[Wave.idx(w,0)]/2,1/3).toFixed(3)}  end t ${w.tEnd.toFixed(4)}`);
  return w;
}
const g = report('GW150914', {m1:36, m2:29, D:410, fStart:20});
report('GW150914 xMatch .12', {m1:36, m2:29, D:410, fStart:20, xMatch:0.12});
report('GW150914 xMatch .20', {m1:36, m2:29, D:410, fStart:20, xMatch:0.20});
report('equal 30+30', {m1:30, m2:30, D:410, fStart:20});
report('q=1/8 80+10', {m1:80, m2:10, D:410, fStart:20});
report('GW190521', {m1:85, m2:66, D:5300, fStart:11});
report('GW170817', {m1:1.46, m2:1.27, D:40, fStart:24});
