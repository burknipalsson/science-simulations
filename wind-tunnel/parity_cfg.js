// shared config for the CPU/GPU parity test: small 3D sphere with LES, sponge, absorbing layers, slip walls
const PARITY = { nx: 64, ny: 32, nz: 32, nu: 0.0005, cs: 0.12, U: 0.05, steps: 400, xc: 18, yc: 15.7, zc: 15.4, R: 5.3,
  sponge: { len: 10, nu: 0.05 }, absorb: { inLen: 6, outLen: 10, sigma: 0.2 } };
if (typeof module !== 'undefined') module.exports = { PARITY };
