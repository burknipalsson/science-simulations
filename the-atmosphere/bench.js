const Spectral = require('./spectral.js');
for (const [M,nlat,nlon] of [[42,64,128],[85,128,256]]) {
  const S = new Spectral(M,nlat,nlon,6.371e6);
  const s=S.newSpec(), g=S.newGrid(), F=S.newF();
  for(let i=0;i<S.ns;i++){s.re[i]=Math.random();s.im[i]=Math.random();}
  for(let k=0;k<50;k++){S.legSyn(F,s.re,s.im,false,false,1);S.F2grid(F,g);}
  let t=performance.now(); for(let k=0;k<500;k++) S.legSyn(F,s.re,s.im,false,false,1); const tl=(performance.now()-t)/500;
  t=performance.now(); for(let k=0;k<500;k++) S.F2grid(F,g); const tf=(performance.now()-t)/500;
  t=performance.now(); for(let k=0;k<500;k++) S.legAna(F,s.re,s.im,false,false,1,null); const ta=(performance.now()-t)/500;
  console.log(`T${M}: legSyn ${tl.toFixed(4)} F2grid ${tf.toFixed(4)} legAna ${ta.toFixed(4)} ms`);
}
