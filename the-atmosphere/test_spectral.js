const Spectral = require('./spectral.js');
function rnd(){return Math.random()*2-1;}
for (const [M,nlat,nlon] of [[42,64,128],[63,96,192],[85,128,256]]) {
  const S = new Spectral(M,nlat,nlon,6.371e6);
  // FFT check
  const N=nlon, re=new Float64Array(N), im=new Float64Array(N);
  for(let i=0;i<N;i++){re[i]=rnd();im[i]=rnd();}
  const r0=re.slice(), i0=im.slice(); S.fft(re,im); let e=0;
  for(let k=0;k<N;k++){let sr=0,si=0;for(let n=0;n<N;n++){const t=-2*Math.PI*k*n/N;sr+=r0[n]*Math.cos(t)-i0[n]*Math.sin(t);si+=r0[n]*Math.sin(t)+i0[n]*Math.cos(t);} e=Math.max(e,Math.abs(sr-re[k]),Math.abs(si-im[k]));}
  // weights sum
  let ws=0; for(const x of S.w) ws+=x;
  // round trip
  const s=S.newSpec(), s2=S.newSpec(), g=S.newGrid();
  for(let i=0;i<S.ns;i++){s.re[i]=rnd(); s.im[i]=S.mOf[i]?rnd():0;}
  S.toGrid(s.re,s.im,g); S.toSpec(g,s2.re,s2.im);
  let e2=0; for(let i=0;i<S.ns;i++) e2=Math.max(e2,Math.abs(s.re[i]-s2.re[i]),Math.abs(s.im[i]-s2.im[i]));
  // solid body rotation winds
  const a=S.a,u0=20, z=S.newSpec(), d=S.newSpec(); z.re[S.off[0]+1]=2*u0/(a*Math.sqrt(1.5));
  const U=S.newGrid(),V=S.newGrid(); S.uv(z.re,z.im,d.re,d.im,U,V);
  let e3=0; for(let j=0;j<nlat;j++)for(let i=0;i<nlon;i++){e3=Math.max(e3,Math.abs(U[j*nlon+i]-u0*(1-S.mu[j]**2)),Math.abs(V[j*nlon+i]));}
  // div/curl identity with random vort/div (scaled)
  for(let i=0;i<S.ns;i++){ const sc=1e-5/(1+S.nOf[i]); z.re[i]=rnd()*sc; z.im[i]=S.mOf[i]?rnd()*sc:0; d.re[i]=rnd()*sc; d.im[i]=S.mOf[i]?rnd()*sc:0;}
  z.re[0]=0; d.re[0]=0;
  S.uv(z.re,z.im,d.re,d.im,U,V);
  const dd=S.newSpec(), zz=S.newSpec(); S.divAdd(U,V,dd.re,dd.im,1);
  const mU=U.map(x=>-x); S.divAdd(V,mU,zz.re,zz.im,1);
  let e4=0,e5=0,mx=0; for(let i=0;i<S.ns;i++){mx=Math.max(mx,Math.abs(d.re[i])); e4=Math.max(e4,Math.abs(dd.re[i]-d.re[i]),Math.abs(dd.im[i]-d.im[i])); e5=Math.max(e5,Math.abs(zz.re[i]-z.re[i]),Math.abs(zz.im[i]-z.im[i]));}
  // gradient: grad of mu (P10) should give gm=(1-mu^2)/a
  const f=S.newSpec(); f.re[S.off[0]+1]=1/Math.sqrt(1.5); const gl=S.newGrid(),gm=S.newGrid(); S.grad(f.re,f.im,gl,gm);
  let e6=0; for(let j=0;j<nlat;j++) e6=Math.max(e6,Math.abs(gm[j*nlon+3]-(1-S.mu[j]**2)/a));
  // timing: 100 round trips
  let t=performance.now(); for(let k=0;k<100;k++){S.toGrid(s.re,s.im,g); S.toSpec(g,s2.re,s2.im);} t=(performance.now()-t)/100;
  console.log(`T${M}: fft ${e.toExponential(1)} wsum ${ws.toFixed(12)} roundtrip ${e2.toExponential(1)} solidbody ${e3.toExponential(1)} div ${(e4/mx).toExponential(1)} curl ${(e5/mx).toExponential(1)} grad ${(e6*a).toExponential(1)}  syn+ana ${t.toFixed(3)} ms`);
}
