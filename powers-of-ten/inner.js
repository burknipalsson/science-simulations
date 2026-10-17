// Powers of Ten: the frames below 1 km. Each is a node of scale.js's tree, nested in its parent at a real
// position: the person on Hallgrímstorg, their right hand, the nail fold of the index finger, and (added by
// later layers) the capillaries under it, a red cell, the haemoglobin inside it, water, a molecule, a proton.
// Also the camera waypoints for this part of the zoom. Runs in node and the browser.
(function (root) {
  const S = root.PTEN || require('./scale.js'), P = root.PTEN_PERSON || require('./person.js');
  const SITE = root.PTEN_SITE || (typeof require !== 'undefined' ? (() => { try { require('./site_data.js'); return globalThis.PTEN_SITE; } catch (e) { return null; } })() : null);
  const D = Math.PI / 180, norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cols = (x, y, z) => [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];   // matrix with these columns

  // the person stands on the plaza facing the church tower (azimuth 147°); today's wind came from 226°
  // (Open-Meteo, 13:00 UTC: 6.0 m/s at 10 m, gusts 11.8 m/s, 7.6 °C, overcast)
  const PERSON = SITE ? SITE.person : { e: -38, n: 70, z: -2.35 };
  const FACE = 147, WIND_FROM = 226;
  const az = a => [Math.sin(a * D), Math.cos(a * D), 0];
  const fx = az(FACE), fy = [-fx[1], fx[0], 0];
  S.node('person', 'site', [PERSON.e, PERSON.n, PERSON.z], cols(fx, fy, [0, 0, 1]), { size: 2 });
  // wind direction (where it blows toward) in the person frame
  const wt = az(WIND_FROM + 180), windTheta = Math.atan2(wt[0] * fy[0] + wt[1] * fy[1], wt[0] * fx[0] + wt[1] * fx[1]);
  // the right hand: origin mid-palm, axes u (toward the fingers), v (toward the thumb), w (back of the hand)
  S.node('hand', 'person', P.hand.centre, cols(P.hand.u, P.hand.v, P.hand.w), { size: 0.2 });
  // the nail fold of the index finger: x toward the fingertip, y across, z out of the skin
  S.node('nail', 'person', P.nailfold.p, cols(P.nailfold.x, P.nailfold.y, P.nailfold.z), { size: 0.02 });

  // ---- the nail-fold capillaries (refs_inner.md): a row of hairpin loops lying parallel to the skin, apexes toward
  // the cuticle (1.2 mm distal of the nail-fold point), ~9 loops per mm, about 0.3 mm long, arterial limb 7.4 µm,
  // venous 8.8 µm, apex 11.5 µm wide, some 60 µm under the surface. Positions and wiggles are random (fixed seed);
  // the central loop's arterial limb is straight where the camera goes in.
  const CAP0 = [0.00080, 0, -0.00006];
  S.node('cap', 'nail', CAP0, S.I3, { size: 1e-3 });
  let seed = 16102026; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const loops = [];
  const NL = 31, PITCH = 1e-3 / 9;
  for (let k = 0; k < NL; k++) {
    const centre = k === (NL - 1) / 2, yc = (k - (NL - 1) / 2) * PITCH + (centre ? 0 : (rnd() - 0.5) * 0.35 * PITCH);
    const len = centre ? 0.30e-3 : 0.22e-3 + 0.16e-3 * rnd(), apexX = centre ? 0.15e-3 : 0.15e-3 + (rnd() - 0.5) * 0.12e-3;
    const half = centre ? 11e-6 : 9e-6 + 6e-6 * rnd(), side = centre ? -1 : rnd() < 0.5 ? -1 : 1;   // arterial limb on side * half
    const wig = [0, 1].map(() => ({ a: (centre ? 0 : 1) * (0.8e-6 + 2.2e-6 * rnd()), f: 0.8 + 1.6 * rnd(), p: 6.283 * rnd() }));
    loops.push({ yc, len, apexX, half, side, wig, rA: 3.7e-6, rV: 4.4e-6, rApex: 5.75e-6 });
  }
  // centreline of loop L: s in [0, 1] from the arterial end (deep, proximal) round the apex to the venous end.
  // Returns position (cap frame, m) and the local radius.
  function loopPoint(Lp, u) {
    const straight = Lp.len, arc = Math.PI * Lp.half, dive = 60e-6, total = 2 * (straight + dive) + arc;
    let s = u * total, x, y, z = 0, r;
    const yA = Lp.yc + Lp.side * Lp.half, yV = Lp.yc - Lp.side * Lp.half, x0 = Lp.apexX - straight;
    const w = t => Lp.wig.reduce((a, g) => a + g.a * Math.sin(g.f * t * 6.283 + g.p), 0) * Math.sin(Math.PI * t);
    if (s < dive) { const t = s / dive; x = x0 - dive * (1 - t) * 0.6; y = yA; z = -dive * (1 - t) * (1 - t) * 1.2; r = Lp.rA; }
    else if ((s -= dive) < straight) { const t = s / straight; x = x0 + s; y = yA + w(t); r = Lp.rA + (Lp.rApex - Lp.rA) * Math.max(0, t - 0.7) / 0.3; }
    else if ((s -= straight) < arc) { const a = s / arc * Math.PI; x = Lp.apexX + Lp.half * Math.sin(a); y = Lp.yc + Lp.side * Lp.half * Math.cos(a); r = Lp.rApex; }
    else if ((s -= arc) < straight) { const t = 1 - s / straight; x = x0 + straight * t; y = yV - w(t) * 0.8; r = Lp.rV + (Lp.rApex - Lp.rV) * Math.max(0, t - 0.7) / 0.3; }
    else { s -= straight; const t = s / dive; x = x0 - dive * t * 0.6; y = yV; z = -dive * t * t * 1.2; r = Lp.rV; }
    return { p: [x, y, z], r, total };
  }
  // the camera's way in: a straight stretch of the central loop's arterial limb (flow along +x)
  const CL = loops[(NL - 1) / 2];
  const TUBE0 = [CL.apexX - 0.16e-3, CL.yc + CL.side * CL.half, 0];
  S.node('tube', 'cap', TUBE0, S.I3, { size: 50e-6 });
  // the red cell the camera rides (its centre is set each frame from the replay, layers_blood.js)
  S.node('rbc', 'tube', [0, 0, 0], S.I3, { size: 8e-6 });
  // a patch of that cell's membrane (z out of the cell), and the cytoplasm 300 nm beneath it
  S.node('mem', 'rbc', [4e-6, 0, 0], cols([0, 0, -1], [0, 1, 0], [1, 0, 0]), { size: 1e-6 });
  S.node('hb', 'mem', [0, 0, -300e-9], S.I3, { size: 50e-9 });
  // one water molecule in the pocket (its centre of mass and orientation follow the molecular dynamics), and the
  // nucleus of one of its hydrogen atoms (TIP4P/2005 body frame: z along the bisector toward the H, x in the plane)
  S.node('mol', 'hb', [0, 0, 0], S.I3, { size: 3e-10 });
  const H_BODY = (() => { const r = 0.9572, th = 104.52 * D, mO = 15.9994, mH = 1.008, hx = r * Math.sin(th / 2), hz = r * Math.cos(th / 2), zc = 2 * mH * hz / (mO + 2 * mH);
    return { H1: [hx * 1e-10, 0, (hz - zc) * 1e-10], O: [0, 0, -zc * 1e-10], zc: zc * 1e-10 }; })();
  S.node('proton', 'mol', H_BODY.H1, S.I3, { size: 2e-15 });
  // set the membrane frame from the followed cell (called every frame)
  function setMembrane(f) {
    S.nodes.rbc.pos = [f.x, f.y, f.z];
    const z = f.normal; let x = [1 - z[0] * z[0], -z[0] * z[1], -z[0] * z[2]]; const xl = Math.hypot(...x) || 1; x = x.map(v => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    S.nodes.mem.pos = f.mem; S.nodes.mem.rot = cols(x, y, z);
  }

  const W = {
    site: 'site', person: 'person', hand: 'hand', nail: 'nail',
  };
  // waypoints below 1 km (appended to zoom.js's path)
  const path = [
    { L: 2.25, frame: 'site', pos: () => [-16, 32, 30], from: norm([-0.62, 0.55, 0.56]), up: [0, 0, 1], name: 'Hallgrímskirkja' },
    { L: 1.05, frame: 'person', pos: () => [0.1, 0, 1.0], from: norm([0.75, -0.95, 0.42]), up: [0, 0, 1], name: 'On Hallgrímstorg' },
    { L: 0.35, frame: 'person', pos: () => [0.03, -0.02, 0.92], from: norm([0.55, -1, 0.18]), up: [0, 0, 1], name: 'A person' },
    { L: -0.85, frame: 'hand', pos: () => [0.01, 0.006, 0.0], from: norm([-0.15, 0.25, 1]), up: [-1, 0, 0], name: 'A hand' },
    { L: -1.75, frame: 'nail', pos: () => [0.0045, 0, -0.0005], from: norm([0.12, 0, 1]), up: [-1, 0, 0], name: 'A fingertip' },
    { L: -2.6, frame: 'nail', pos: () => [0, 0, 0], from: [0, 0, 1], up: [-1, 0, 0], name: 'The nail fold' },
    { L: -3.35, frame: 'cap', pos: () => [0, 0, 0], from: [0, 0, 1], up: [-1, 0, 0], name: 'Capillary loops' },
    { L: -4.15, frame: 'tube', pos: () => [0, 0, 0], from: norm([0, 0.25, 1]), up: [-1, 0, 0], name: 'One capillary' },
    { L: -5.0, frame: 'rbc', pos: () => [0, 0, 0], from: norm([0.35, 0.3, 1]), up: [-1, 0, 0], name: 'A red blood cell' },
    { L: -6.0, frame: 'mem', pos: () => [0, 0, 0], from: norm([0.25, 0.2, 1]), up: [0, 1, 0], name: 'The cell membrane' },
    { L: -7.0, frame: 'hb', pos: () => [0, 0, 0], from: norm([0.3, 0.25, 1]), up: [0, 1, 0], name: 'Haemoglobin' },
    { L: -8.0, frame: 'hb', pos: () => [0, 0, 0], from: norm([0.35, 0.2, 1]), up: [0, 1, 0], name: 'Among the atoms' },
    { L: -9.0, frame: 'hb', pos: () => [0, 0, 0], from: norm([0.4, 0.2, 1]), up: [0, 1, 0], name: 'Water' },
    { L: -9.45, frame: 'mol', pos: () => [0, 0, 0], from: norm([0.2, 1, 0.12]), up: [0, 0, 1], name: 'A water molecule' },
    { L: -10.8, frame: 'proton', pos: () => [0, 0, 0], from: norm([0.2, 1, 0.12]), up: [0, 0, 1], name: 'Inside the electron cloud' },
    { L: -14.6, frame: 'proton', pos: () => [0, 0, 0], from: norm([0.2, 1, 0.12]), up: [0, 0, 1], name: 'A proton' },
  ];
  const api = { path, PERSON, FACE, WIND_FROM, windTheta, loops, loopPoint, NL, CAP0, TUBE0, setMembrane, H_BODY };
  root.PTEN_INNER = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
