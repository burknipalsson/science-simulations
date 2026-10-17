// count GW cycles 35→150 Hz and time 35 Hz → x=0.2 for different truncations of dx/dt
const eta = 36*29/65/65, M = 65*1.087*4.925491e-6, pi = Math.PI, GE = 0.5772156649;
function coeffs(x){
  return [1, -743/336 - 11/4*eta, 4*pi, 34103/18144 + 13661/2016*eta + 59/18*eta*eta,
    (-4159/672 - 189/8*eta)*pi,
    16447322263/139708800 - 1712/105*GE + 16/3*pi*pi - 856/105*Math.log(16*x) + (-56198689/217728 + 451/48*pi*pi)*eta + 541/896*eta*eta - 5605/2592*eta**3,
    (-4415/4032 + 358675/6048*eta + 91495/1512*eta*eta)*pi];
}
function run(order){
  const xf = f => Math.pow(pi*f*M, 2/3);
  let x = xf(35), t = 0, ph = 0; const x150 = xf(150);
  let cyc = null;
  while (x < 0.31){
    const c = coeffs(x); let s = 0; const pw=[0,1,1.5,2,2.5,3,3.5]; for (let k = 0; k < pw.length; k++) if (pw[k] <= order) s += c[k] * Math.pow(x, pw[k]);
    const dx = 64/5*eta*x**5*s, dt = 1e-3*x/dx;
    ph += 2*x**1.5*dt; x += dx*dt; t += dt;
    if (cyc === null && x >= x150) cyc = ph/2/pi;
  }
  return `order ${order}PN: cycles 35-150 = ${cyc.toFixed(2)}, time to x=0.31 = ${(t*M).toFixed(4)} s`;
}
for (const o of [0,1,1.5,2,2.5,3,3.5]) console.log(run(o));
