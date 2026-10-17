const pi=Math.PI, GE=0.5772156649;
function run(m1,m2,z,fA,xEnd,mode){
  const eta=m1*m2/(m1+m2)**2, M=(m1+m2)*(1+z)*4.925491e-6;
  const F=x=>32/5*eta*eta*x**5*(1+(-1247/336-35/12*eta)*x+4*pi*x**1.5+(-44711/9072+9271/504*eta+65/18*eta*eta)*x*x+(-8191/672-583/24*eta)*pi*x**2.5
    +(6643739519/69854400+16/3*pi*pi-1712/105*GE-856/105*Math.log(16*x)+(-134543/7776+41/48*pi*pi)*eta-94403/3024*eta*eta-775/324*eta**3)*x**3
    +(-16285/504+214745/1728*eta+193385/3024*eta*eta)*pi*x**3.5);
  const e1=-3/4-eta/12, e2=-27/8+19/8*eta-eta*eta/24, e3=-675/64+(34445/576-205/96*pi*pi)*eta-155/96*eta*eta-35/5184*eta**3;
  const dE=x=>-eta/2*(1+2*e1*x+3*e2*x*x+4*e3*x**3);
  const W=require('./wave.js');
  let x=Math.pow(pi*fA*M,2/3),t=0,ph=0;
  while(x<xEnd){const dx=-F(x)/dE(x); const dt=2e-3*x/dx; x+=dx*dt; ph+=2*x**1.5*dt; t+=dt;}
  return `T1: ${fA} Hz → x=${xEnd}: ${(t*M).toFixed(4)} s, ${(ph/2/pi).toFixed(2)} GW cycles`;
}
console.log('GW150914', run(36,29,0.087,35,0.16));
const W=require('./wave.js'); const w=W.build({m1:36,m2:29,D:410,fStart:35});
console.log('T4 (model) 35 Hz → x=0.16:', (w.tMatch-w.tStart).toFixed(4),'s', (w.ph[w.t.findIndex(t=>t>=w.tMatch)]/2/pi).toFixed(2),'cycles; then to peak', (-w.tMatch).toFixed(4),'s');
