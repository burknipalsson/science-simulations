// Powers of Ten: the page. One number, L = log10(view width in metres), drives everything.
(function () {
  const S = PTEN, Z = PTEN_ZOOM, RD = PTEN_RENDER, LY = PTEN_LAYERS;
  const $ = id => document.getElementById(id);
  const canvas = $('sky');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the rungs: where the film stops, what it says ----
  const MAIN_RUNGS = [
    { L: 25.2, name: 'The cosmic web', clock: 'cosmic', link: 'https://claude.ai/artifact/WgnUu4Yr1KaP951tsosNFN', sim: 'The Cosmic Web',
      text: '<b>A billion light-years of universe</b>, grown from the faint ripples of the early universe to today by the engine of <i>The Cosmic Web</i>. Each dot is dark matter weighing half a trillion suns. Galaxies form in the knots and along the threads. Light takes a billion years to cross this view.' },
    { L: 23.0, name: 'The Local Group', clock: 'galaxy',
      text: '<b>Our galactic neighbourhood, at real positions.</b> The Milky Way and Andromeda are the two big spirals, 2.5 million light-years apart and falling toward each other at 110 km/s. Around them swarm dozens of dwarf galaxies, each plotted where telescopes have measured it.' },
    { L: 21.0, name: 'The Milky Way', clock: 'galaxy', link: 'https://claude.ai/artifact/7nAXFvzXgzTmTw1uUA2pHj', sim: 'Event Horizon',
      text: '<b>The Galaxy, drawn from its measured shape:</b> a central bar 10,000 parsecs long, and spiral arms traced by radio masers in young star clusters (Reid et al. 2019). The clock now runs at 2 million years per second. The Sun takes about 210 million years to go round once. Young blue stars are born in the arms, drift out of them and burn out.' },
    { L: 19.6, name: 'The Sun’s neighbourhood', clock: 'stars',
      text: '<b>From model to catalogue.</b> Here the stars are real ones from the Hipparcos, Yale and Gliese catalogues: every star within 25 parsecs (80 light-years), plus the luminous giants out to 2,000 light-years. They drift on their measured velocities.' },
    { L: 16.4, name: 'The nearest stars', clock: 'stars',
      text: '<b>Our nearest neighbours.</b> Proxima Centauri is 4.2 light-years away. At the speed of Voyager 1 that is 73,000 years of travel. Each star moves on its measured path through space, at tens of km/s.' },
    { L: 13.3, name: 'The solar system', clock: 'solar', link: 'https://claude.ai/artifact/1LFZu6uDUjnDRNmWkfTgkE', sim: 'The Clockwork',
      text: '<b>The planets where they really are today</b>, on orbits from JPL’s ephemeris. The whole solar system, out to Neptune, fits inside a light-year a thousand times over.' },
    { L: 11.6, name: 'Earth’s orbit', clock: 'solar',
      text: '<b>Earth, moving at 30 km/s</b>, a quarter of the way round from the September equinox. The camera rides along with it.' },
    { L: 9.0, name: 'Earth and Moon', clock: 'solar',
      text: '<b>The Earth and the Moon, at true scale and true distance</b>: 384,000 km, or thirty Earths. Today the Moon is nearly new, almost between us and the Sun, so we see its dark side.' },
    { L: 7.3, name: 'Earth', clock: 'solar', link: 'https://claude.ai/artifact/Ef45tXiR52txc37t7tXzJW', sim: 'The Atmosphere',
      text: '<b>The Earth as the Sun lights it at this moment</b>, 16 October 2026. The surface is NASA’s Blue Marble for October. Reykjavík sits at the centre, in the early afternoon.' },
    { L: 5.6, name: 'Iceland', clock: 'solar',
      text: '<b>Iceland, 500 km across.</b> The white patches are the ice caps: Vatnajökull, Langjökull, Hofsjökull and Mýrdalsjökull. Each pixel of this NASA image is 500 m wide.' },
    { L: 3.0, name: 'Reykjavík', clock: 'solar',
      text: '<b>Reykjavík from 1 km up</b>, at 13:00 UTC. 64.14° N, 21.93° W. The Sun is 16.8° above the southern horizon (JPL agrees to 0.001°).' },
    { L: 2.25, name: 'Hallgrímskirkja', clock: 'solar',
      text: '<b>Hallgrímskirkja, every building at its measured height.</b> Footprints and the church’s stepped columns come from OpenStreetMap. Heights are tagged or measured from the ArcticDEM surface model, and the bare ground beneath is from the same survey. The tower is 73 m tall. The shadows fall where the Sun really put them at 13:00.' },
    { L: 1.05, name: 'On Hallgrímstorg', clock: 'solar',
      text: '<b>Someone standing on the square in front of the church</b>, 40 m above the sea. The forecast for this hour: 7.6 °C, overcast, wind from the south-west at 6 m/s (Open-Meteo), about 3.5 m/s at head height.' },
    { L: 0.35, name: 'A person', clock: 'solar', link: 'https://claude.ai/artifact/Gz2ttAcu7XQKk7mLVX4zjg', sim: 'The Wind Tunnel',
      text: '<b>The wind around a person</b>, computed by the lattice-Boltzmann engine of <i>The Wind Tunnel</i>: 17 million cells of air, 1 cm apart. The smoke shows the air parting around the body and tumbling into the turbulent wake behind it.' },
    { L: -0.85, name: 'A hand', clock: 'solar',
      text: '<b>A hand, 19 cm from wrist to fingertip.</b> Its proportions are adult averages. The view now narrows toward the nail of the index finger, which grows about 3.5 mm a month.' },
    { L: -1.75, name: 'A fingertip', clock: 'solar',
      text: '<b>The fingernail</b>: a plate of keratin about half a millimetre thick, 10 mm wide. At its root, a fold of skin covers the growing edge.' },
    { L: -2.6, name: 'The nail fold', clock: 'solar',
      text: '<b>The nail fold</b>, the strip of skin just behind the cuticle. Here, unusually, the smallest blood vessels run parallel to the surface, close under thin skin. A doctor with a microscope can watch blood flow in them. That is <i>nailfold capillaroscopy</i>.' },
    { L: -3.35, name: 'Capillary loops', clock: 'solar', link: 'https://claude.ai/artifact/8CRDJPovWFi6refGv9ioCw', sim: 'Inside a Drop of Blood',
      text: '<b>What a capillaroscope sees</b> at ×200: a row of hairpin capillaries, about nine per millimetre, each some 0.3 mm long. Blood climbs the thinner arterial limb (7.4 µm), turns at the apex and returns down the venous limb (8.8 µm), at about 0.65 mm per second, in real time here. Wider loops (over 20 µm) or “giant” ones (over 50 µm) are early signs of systemic sclerosis.' },
    { L: -5.0, name: 'A red blood cell', clock: 'solar',
      text: '<b>A red cell squeezing through</b>, 7.8 µm across at rest. Pushed by the plasma and held back at its rim, it folds into a parachute, recorded from the fine-grid engine of <i>Inside a Drop of Blood</i>: 2,562-point elastic membranes in flowing plasma, at 0.6 mm/s. The cells travel 1.2 times faster than the plasma on average.' },
    { L: -6.0, name: 'The cell membrane', clock: 'solar',
      text: '<b>The red cell’s skin</b>: a film of fat molecules about 4–5 nm thick, studded with band 3 proteins, about 8,600 per square micrometre (1.2 million per cell). Beneath it hangs a net of spectrin, roughly 64 nm across each mesh, that lets the cell fold and spring back each time it squeezes through a capillary, some hundreds of thousands of times in its 120-day life. Their positions here are random; their numbers are measured.' },
    { L: -7.0, name: 'Haemoglobin', clock: 'solar',
      text: '<b>Inside the cell: a crowd of haemoglobin.</b> About 280 million molecules per cell, at 33 g per 100 ml, filling a quarter of the volume, one every 7 nm. Each is the real crystal structure of oxygenated human haemoglobin (PDB 2DN1), placed at random but never overlapping.' },
    { L: -8.0, name: 'Among the atoms', clock: 'solar',
      text: '<b>Atoms of haemoglobin</b>: carbon grey, nitrogen blue, oxygen red, sulphur yellow, and in each of the four haem groups one iron atom (orange) that holds an oxygen molecule. Each haemoglobin has 4,524 atoms besides its hydrogens, which are too small to place from X-ray data and are not drawn.' },
    { L: -9.0, name: 'Water', clock: 'solar', link: 'https://claude.ai/artifact/2edgeA6wtLQ2vUEisxZsE7', sim: 'The Hydrogen Bond',
      text: '<b>Water at body temperature</b>, from the molecular-dynamics engine of <i>The Hydrogen Bond</i> (TIP4P/2005, 310 K). Each molecule makes about 3.6 hydrogen bonds that break and re-form in picoseconds. The clock now runs about a trillion times slower than real time.' },
    { L: -9.45, name: 'A water molecule', clock: 'solar', link: 'https://claude.ai/artifact/CmPLT4z2Yu6dTNU5hy7aV4', sim: 'The Quantum Atom',
      text: '<b>One water molecule’s electron cloud</b>, computed from quantum mechanics (coupled-cluster CCSD theory). Its electric dipole comes out at 1.853 debye; the measured value is 1.855. The bright knots are the oxygen and two hydrogen nuclei. Time has stopped: this is a stationary state.' },
    { L: -10.8, name: 'Inside the electron cloud', clock: 'solar',
      text: '<b>Falling into a hydrogen atom.</b> From here down there is nothing to see but the faint, even glow of the electron’s probability cloud. The nucleus is about 60,000 times smaller across than the atom: four powers of ten of almost empty space.' },
    { L: -14.6, name: 'A proton', clock: 'solar',
      text: '<b>A proton</b>, the nucleus of the hydrogen atom: its charge spread over a radius of 0.8408 femtometres (muonic hydrogen, Antognini 2013), drawn with the exponential profile its measured form factor implies. Inside are three quarks bound by gluons, which no picture can show as points. The cosmic web we started from is 40 powers of ten larger.' },
    { L: -4.15, name: 'One capillary', clock: 'solar',
      text: '<b>Single file.</b> The arterial limb is narrower than a red cell, so the cells pass one at a time, with gaps of plasma between them. The clock is slowing down so the eye can follow them.' },
  ];
  const L_TOP = 25.3, L_BOTTOM = -14.6, LAD_TOP = 26, LAD_BOT = -15;
  // side trips branch off the main zoom at a rung and have their own rungs, layers and clock below it
  const TRIP = {
    sgr: { branch: 21.4, bottom: 11.25, first: 15.6, layers: new Set(['web', 'galaxies', 'milkyway', 'nsc', 'sstars', 'sgrA']), label: 'Side trip: the black hole at the Galaxy’s centre',
      // log10 of the trip clock's seconds per second against L
      rate: [[17.2, 9.3], [15.6, 8.5], [14.1, 7.5], [12.4, 4.0], [11.25, 2.6]],
      rungs: [
        { L: 18.3, name: 'The Galactic Centre', clock: 'trip',
          text: '<b>The middle of the Milky Way</b>, 26,700 light-years from the Sun, behind dust that hides it from visible light; infrared and radio telescopes see through. Here the nuclear star cluster packs some 25 million suns’ worth of stars, half their light within 4.2 parsecs (14 light-years), flattened along the Galactic plane (Schödel et al. 2014). Positions are random; size and shape are measured.' },
            { L: 15.6, name: 'The S-stars', clock: 'trip',
          text: '<b>Forty stars orbiting nothing visible</b>, followed since 1992 by the VLT and Keck. Their orbits are the fits of Gillessen et al. (2017), each star moving where its ellipse says it is today. They all circle a point of 4 million solar masses: the evidence that won the 2020 Nobel Prize (Genzel, Ghez).' },
        { L: 14.1, name: 'The orbit of S2', clock: 'trip',
          text: '<b>S2</b> goes round in 16 years, coming within 120 AU of the black hole at 2.7% of the speed of light. At its 2018 pass GRAVITY measured both the gravitational redshift and, over the orbit, the precession that general relativity predicts. Here it runs on its fitted Kepler ellipse; the next pass is in 2034.' },
        { L: 11.25, name: 'Sgr A*', clock: 'trip', link: 'https://claude.ai/artifact/7nAXFvzXgzTmTw1uUA2pHj', sim: 'Event Horizon',
          text: '<b>Sagittarius A*</b>, 4.15 million suns (GRAVITY 2019). Its shadow, ray-traced here with the exact light-bending equation of <i>Event Horizon</i>, is 52 µas across as seen from Earth; the Event Horizon Telescope measured a ring of 51.8 µas in 2022. The glowing disk is drawn as a thin disk would look. The real flow is faint and hot, and the EHT images are false-coloured orange.' },
      ] },
  };
  TRIP.m31 = { branch: 23.0, bottom: 21.0, first: 22.55, layers: new Set(['web', 'merger']), label: 'Time trip: Andromeda meets the Milky Way', time: true,
    rate: [[22.85, 15.8], [20.0, 15.8]], max: 12.5 * 3.15576e16,
    rungs: [
      { L: 22.55, name: 'Andromeda meets the Milky Way', clock: 'trip', link: 'https://claude.ai/artifact/W7a5NPP4u4DVThdoPoryfi', sim: 'Bridges & Tails',
        text: '<b>The next 12 billion years, at 200 million years per second.</b> Andromeda falls toward us at 109 km/s, but also drifts sideways at 57 km/s (Gaia). In this model the two pass 120 kpc apart in 4.6 billion years, swing out, and merge at about 10 billion. The orbit uses dark haloes and dynamical friction that reproduce van der Marel’s 2012 simulations (3.9 and 5.9 Gyr for a near head-on fall). Stars are test particles, as in <i>Bridges &amp; Tails</i>. Within the errors on that sideways speed the merger may come sooner or not at all: Sawala et al. (2025) put the odds at about 50% within 10 billion years.' },
    ] };
  let RUNGS = MAIN_RUNGS;
  const bottom = () => st.trip ? TRIP[st.trip].bottom : L_BOTTOM;
  const visible = l => st.trip ? TRIP[st.trip].layers.has(l.name) : !l.trip;
  function tripRate(L) {
    const t = TRIP[st.trip]; if (!t || L >= t.rate[0][0]) return 0;
    const R2 = t.rate; for (let i = 1; i < R2.length; i++) if (L >= R2[i][0]) { const [a, la] = R2[i - 1], [b, lb] = R2[i]; return Math.pow(10, la + (lb - la) * (L - a) / (b - a)); }
    return Math.pow(10, R2[R2.length - 1][1]);
  }

  // ---- state ----
  const st = { L: L_TOP, target: null, orbit: { yaw: 0, pitch: 0 }, film: false, filmT: 0, last: performance.now(), clocks: { galaxy: 0, stars: 0, solar: 0, inner: 0, trip: 0 }, rungShown: -1, trip: null, pending: null };
  // below the street the clock is the second hand of 13:00 UTC, slowing with each power of ten so that motion stays
  // watchable: real time for people and wind, ~1/50 for red cells, picoseconds per second for water molecules,
  // and stopped for the electron cloud (a stationary state). log10(seconds per second) against L:
  const INNER_RATE = [[-3.8, 0], [-5, -1.7], [-6, -3.0], [-7, -5.0], [-8, -8.5], [-8.7, -12.3], [-9.6, -12.6], [-10.3, -14.5], [-10.6, -16]];
  function innerRate(L) {
    if (L >= INNER_RATE[0][0]) return 1;
    for (let i = 1; i < INNER_RATE.length; i++) if (L >= INNER_RATE[i][0]) { const [a, la] = INNER_RATE[i - 1], [b, lb] = INNER_RATE[i]; return Math.pow(10, la + (lb - la) * (L - a) / (b - a)); }
    return 0;
  }
  window.PTEN_CLOCKS = st.clocks;

  // clock rate (per real second) for the current scale
  function rates(L) {
    const w = Math.pow(10, L), r = { galaxy: 0, stars: 0, solar: 0 };
    if (L >= 19.8 && L < 23.4) r.galaxy = 2;                                  // Myr per second
    if (L >= 15.3 && L < 19.8) r.stars = 0.05 * (w / S.PC) / 20;              // Myr per second: ~5% of the view per second at 20 km/s
    if (L < 15.5) {
      // characteristic speed: planets 30 km/s, the Moon 1 km/s, the Earth's surface turning 0.2 km/s
      const v = L > 9.6 ? 3e4 : L > 7.8 ? 1e3 : 2e2;
      r.solar = Math.min(40, Math.max(1 / 86400, 0.025 * w / v / 86400));     // days per second
    }
    return r;
  }
  function stepClocks(dt) {
    const r = rates(st.L);
    // the trip clock runs from today below the S-stars' scale and drifts back to today above it
    if (st.trip) {
      const q = tripRate(st.L), T = TRIP[st.trip];
      if (q > 0) st.clocks.trip = Math.min(T.max || Infinity, st.clocks.trip + q * dt);
      else if (!T.time) st.clocks.trip -= st.clocks.trip * Math.min(1, dt * 1.5);
    } else st.clocks.trip = 0;
    // below Reykjavík the inner clock (seconds after 13:00:00, double precision) drives the solar clock
    if (st.L < 3.0) { st.clocks.inner += innerRate(st.L) * dt; } else st.clocks.inner = st.clocks.solar * 86400;
    for (const k of ['galaxy', 'stars', 'solar']) {
      if (st.trip && k !== 'galaxy') { st.clocks[k] -= st.clocks[k] * Math.min(1, dt * 1.5); continue; }
      if (k === 'solar' && st.L < 3.0) { st.clocks.solar = st.clocks.inner / 86400; continue; }
      if (r[k] > 0) st.clocks[k] += r[k] * dt;
      if (k === 'stars') st.clocks.stars = Math.max(-2, Math.min(2, st.clocks.stars));
      else st.clocks[k] -= st.clocks[k] * Math.min(1, dt * 1.5);            // out of its range, the clock returns to today
    }
    // in the film the clocks reach today as each rung is left; below Reykjavík (13:00:00) time runs on from there
    if (st.film && !st.trip) for (const k of ['galaxy', 'stars', 'solar']) if (r[k] > 0 && (k !== 'solar' || st.L >= CLOCK_END.solar)) { st.clocks[k] = filmClock(k, st.L); if (k === 'solar') st.clocks.inner = st.clocks.solar * 86400; }
    S.setTime(st.clocks.solar);
    // frames that move with the recorded simulations (the red cell the camera rides)
    if (window.PTEN_FOLLOW) { const f = PTEN_FOLLOW(st.clocks.inner); if (f) PTEN_INNER.setMembrane(f); }
    if (window.PTEN_WATER_UPDATE) PTEN_WATER_UPDATE(st.clocks.inner);
  }

  // ---- film: a fixed route down the ladder, slowing at each rung ----
  function filmSpeed(L) {
    let s = 0.30;
    for (const r of RUNGS) { const d = Math.abs(L - r.L); if (d < 0.6) s = Math.min(s, 0.06 + 0.24 * Math.min(1, d / 0.6)); }
    return s;
  }
  // In the film every clock counts up to today and reaches it as the zoom leaves its rung, so the stars are
  // today's stars when the solar system appears, and the landing is at exactly 13:00 UTC. clock(L) = -∫ rate/speed dL.
  const CLOCK_END = { galaxy: 19.8, stars: 15.3, solar: 3.0 };
  const filmTable = (() => {
    const dL = 0.0005, n = Math.ceil((L_TOP - L_BOTTOM) / dL) + 1, T = { galaxy: new Float64Array(n), stars: new Float64Array(n), solar: new Float64Array(n) };
    for (const k of Object.keys(T)) {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const L = L_BOTTOM + i * dL;
        if (L > CLOCK_END[k]) acc += rates(L - dL / 2)[k] / filmSpeed(L - dL / 2) * dL;
        T[k][i] = -acc;
      }
    }
    return { dL, T };
  })();
  const filmClock = (k, L) => { const t = (L - L_BOTTOM) / filmTable.dL, i = Math.max(0, Math.min(filmTable.T[k].length - 2, Math.floor(t))), f = t - i; return filmTable.T[k][i] * (1 - f) + filmTable.T[k][i + 1] * f; };
  function startFilm() {
    st.film = true; st.target = null;
    if (st.trip) { if (st.L <= bottom() + 0.01) st.L = TRIP[st.trip].branch; }
    else if (st.L <= L_BOTTOM + 0.01 || (st.L < 15.6 && st.L > 3.1)) st.L = L_TOP;
    syncFilm();
  }
  function syncFilm() { $('playBtn').innerHTML = st.film ? '<span aria-hidden="true">❚❚</span> Pause the film' : '<span aria-hidden="true">▶</span> Play the film'; $('playBtn').setAttribute('aria-pressed', st.film); }

  // ---- render setup ----
  let R = null, layers = [], siteLayer = null;
  try { R = RD.make(canvas); } catch (e) { console.error(e); }
  if (!R) { $('nogl').hidden = false; return; }
  const gl = R.gl;
  function loadImg(b64, type) { return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = `data:${type};base64,${b64}`; }); }
  Promise.all(['earth', 'iceland', 'moon', 'night', 'rvk11', 'rvk13'].map(k => loadImg(PTEN_TEX[k], 'image/jpeg'))).then(([earth, iceland, moon, night, rvk11, rvk13]) => {
    layers = LY.build(R, { earth, iceland, moon, night, rvk11, rvk13 });
    if (window.PTEN_LAYERS_TRIP) layers.push(...PTEN_LAYERS_TRIP.build(R));
    siteLayer = null;
    if (window.PTEN_LAYERS_SITE) { const extra = PTEN_LAYERS_SITE.build(R, { rvk13 }); siteLayer = extra.find(l => l.name === 'site'); layers.push(...extra);
      if (window.PTEN_LAYERS_BLOOD) layers.push(...PTEN_LAYERS_BLOOD.build(R));
      if (window.PTEN_LAYERS_MOL) layers.push(...PTEN_LAYERS_MOL.build(R));
      if (window.PTEN_LAYERS_PERSON) layers.push(...PTEN_LAYERS_PERSON.build(R, siteLayer)); }
    $('loading').hidden = true;
    requestAnimationFrame(frame);
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  }

  // ---- labels (HTML, projected) ----
  const tagPool = [], tagsEl = $('tags');
  function project(cam, frame, p) {
    const o = Z.place(cam, frame, p).off, cz = o[2] - R.EYE;
    if (cz >= -1e-6) return null;
    const f = canvas.clientHeight / 2 / Math.tan(R.FOV / 2);
    return [canvas.clientWidth / 2 + o[0] / -cz * f, canvas.clientHeight / 2 - o[1] / -cz * f, -cz];
  }
  function drawLabels(cam) {
    let n = 0;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    for (const l of layers) {
      if (!l.labels || !visible(l)) continue;
      let list = l.labels(cam).filter(x => x.a > 0.04);
      if (l.maxLabels) {
        list = list.map(x => { const q = project(cam, x.frame, x.p); return q && { ...x, q, app: x.lum / (q[2] * q[2]) }; }).filter(Boolean)
          .sort((a, b) => b.app - a.app).slice(0, l.maxLabels);
      }
      for (const x of list) {
        if (Math.hypot(...Z.place(cam, x.frame, x.p).off) > (x.far || 3)) continue;
        const q = x.q || project(cam, x.frame, x.p); if (!q || q[0] < -50 || q[0] > W + 50 || q[1] < 0 || q[1] > H) continue;
        let el = tagPool[n]; if (!el) { el = document.createElement('div'); tagsEl.appendChild(el); tagPool.push(el); }
        el.className = 'tag ' + (x.cls || ''); el.textContent = x.t; el.style.opacity = Math.min(1, x.a).toFixed(2);
        el.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) translate(8px, -50%)`; el.hidden = false; n++;
      }
    }
    for (let i = n; i < tagPool.length; i++) tagPool[i].hidden = true;
  }

  // ---- HUD ----
  const sup = n => String(n).replace(/-/g, '−').split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || (c === '−' ? '⁻' : c)).join('');
  const sig = (x, n = 2) => x >= 100 ? Math.round(x).toLocaleString('en') : +x.toPrecision(n) + '';
  function lightTime(m) {
    const s = m / 299792458;
    if (s < 1e-21) return `${sig(s * 1e24)} ys`; if (s < 1e-18) return `${sig(s * 1e21)} zs`; if (s < 1e-15) return `${sig(s * 1e18)} as`; if (s < 1e-12) return `${sig(s * 1e15)} fs`;
    if (s < 1e-9) return `${sig(s * 1e12)} ps`; if (s < 1e-6) return `${sig(s * 1e9)} ns`;
    if (s < 1e-3) return `${sig(s * 1e6)} µs`; if (s < 1) return `${sig(s * 1e3)} ms`; if (s < 120) return `${sig(s)} s`;
    if (s < 7200) return `${sig(s / 60)} min`; if (s < 2 * 86400) return `${sig(s / 3600)} h`; if (s < 2 * 3.156e7) return `${sig(s / 86400)} days`;
    const y = s / 3.156e7; return y < 1e6 ? `${Math.round(y).toLocaleString('en')} years` : y < 1e9 ? `${(y / 1e6).toPrecision(3)} million years` : `${(y / 1e9).toPrecision(3)} billion years`;
  }
  function yrs(t) { const y = t / 3.15576e7; return y >= 1e9 ? `${(y / 1e9).toFixed(2)} billion years` : y >= 1e6 ? `${(y / 1e6).toPrecision(3)} million years` : y >= 2 ? `${sig(y, 3)} years` : t >= 2 * 86400 ? `${sig(t / 86400, 3)} days` : t >= 7200 ? `${sig(t / 3600, 3)} hours` : t >= 120 ? `${sig(t / 60, 3)} minutes` : `${sig(t, 3)} seconds`; }
  function rateText(L) {
    if (st.trip && (L < 19.8 || TRIP[st.trip].time)) { const q = tripRate(L); return q > 0 ? `${yrs(q)} per second` : 'paused at today'; }
    const r = rates(L);
    if (r.galaxy) return `${r.galaxy} million years per second`;
    if (r.stars) return `${sig(r.stars * 1e6)} years per second`;
    if (L < 3.0) {
      const q = innerRate(L); if (q >= 0.999) return 'real time'; if (q <= 0) return 'stopped (a stationary state)';
      const k = 1 / q; if (k < 1e5) return `slowed ${sig(k).replace(/,/g, '\u2009')}×`;
      const e = Math.floor(Math.log10(k)), m = k / 10 ** e; return `slowed ${m.toFixed(1)} × 10${sup(e)} ×`;
    }
    if (r.solar) { const d = r.solar; return d >= 1 ? `${sig(d)} days per second` : d * 24 >= 1 ? `${sig(d * 24)} hours per second` : d * 1440 >= 1.05 ? `${sig(d * 1440)} minutes per second` : 'real time'; }
    return 'frozen at today';
  }
  function clockText(L) {
    if (st.trip && (L < 19.8 || TRIP[st.trip].time)) return st.clocks.trip < 1 ? 'today' : `today + ${yrs(st.clocks.trip)}`;
    const r = rates(L);
    const rel = (t, unit) => Math.abs(t) < 1e-9 ? 'today' : `${t < 0 ? 'today − ' : 'today + '}${unit(Math.abs(t))}`;
    if (r.galaxy || (L >= 19.8 && L < 23.4)) return rel(st.clocks.galaxy, t => `${t.toFixed(1)} million years`);
    if (r.stars) return rel(st.clocks.stars, t => `${Math.round(t * 1e6).toLocaleString('en')} years`);
    if (L < 3.0) {
      // seconds after 13:00:00 with as many decimals as the slowed clock makes worth reading (to the femtosecond)
      const t = Math.max(0, st.clocks.inner), q = innerRate(L), dec = q >= 0.999 ? 1 : q === 0 ? 15 : Math.min(15, Math.max(2, Math.ceil(-Math.log10(q)) + 2));
      const whole = Math.floor(t), mm = Math.floor(whole / 60), ss = whole % 60;
      let frac = (t - whole).toFixed(dec).slice(2).replace(/(\d{3})(?=\d)/g, '$1\u2009');
      return `13:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${frac} UTC`;
    }
    if (L < 15.5) { const d = new Date(Date.UTC(2026, 9, 16, 13) + st.clocks.solar * 86400e3); return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
    return 'today (z = 0)';
  }
  const ladder = $('ladder');
  function buildLadder() {
    for (let p = LAD_TOP; p >= LAD_BOT; p--) {
      const t = document.createElement('div'); t.className = 'tick' + (p % 5 === 0 ? ' major' : ''); t.style.top = pct(p) + '%';
      t.innerHTML = `<span>10${sup(p)}</span>`; ladder.appendChild(t);
    }
    buildRungs();
  }
  function buildRungs() {
    ladder.querySelectorAll('.rung').forEach(b => b.remove());
    RUNGS.forEach((r, i) => {
      const b = document.createElement('button'); b.className = 'rung' + (r.clock === 'trip' ? ' tripr' : ''); b.style.top = pct(r.L) + '%'; b.textContent = r.name;
      b.addEventListener('click', () => { st.film = false; syncFilm(); st.target = r.L; });
      ladder.appendChild(b); r.btn = b;
    });
    st.rungShown = -1; declutter();
  }
  // enter or leave a side trip: switch paths at the branch rung (the paths are identical above it)
  function setTrip(k) {
    if (window.PTEN_MERGER) { if (k === 'm31') PTEN_MERGER.start(); else PTEN_MERGER.stop(); }
    st.autoZoom = k === 'm31';
    st.clocks.trip = 0;
    st.trip = k; RUNGS = k ? MAIN_RUNGS.filter(r => r.L >= TRIP[k].branch).concat(TRIP[k].rungs) : MAIN_RUNGS;
    buildRungs(); syncTrip();
  }
  function goTrip(k) {
    st.film = false; syncFilm();
    const t = TRIP[k || st.trip];
    if (k) { if (st.L >= t.branch) { setTrip(k); st.target = t.first; } else { st.target = t.branch + 0.02; st.pending = { trip: k, then: t.first }; } }
    else { if (st.L >= t.branch) { setTrip(null); st.target = t.branch; } else { st.target = t.branch + 0.02; st.pending = { trip: null, then: null }; } }
  }
  function syncTrip() {
    for (const [id, k] of [['tripBtn', 'sgr'], ['trip2Btn', 'm31']]) {
      const b = $(id); if (!b) continue;
      b.hidden = !!st.trip && st.trip !== k;
      b.innerHTML = st.trip === k ? '<span aria-hidden="true">↩</span> Back to the main zoom' : '<span aria-hidden="true">↳</span> ' + TRIP[k].label;
    }
  }
  // hide rung names that would overlap their upper neighbour (the ladder is 41 powers of ten tall)
  function declutter() {
    const h = ladder.clientHeight || 600; let last = -1e9;
    for (const r of RUNGS) { const y = pct(r.L) / 100 * h; const show = y - last >= 15; r.btn.hidden = !show; if (show) last = y; }
  }
  window.addEventListener('resize', () => declutter());
  const pct = L => (LAD_TOP - L) / (LAD_TOP - LAD_BOT) * 100;
  buildLadder();

  function hud(cam) {
    const w = cam.w;
    $('pow').innerHTML = `10<sup>${String(Math.floor(cam.L + 1e-9)).replace('-', '−')}</sup> m`;
    $('width').textContent = Z.human(w);
    $('fam').textContent = Z.familiar(w) || '';
    $('light').textContent = lightTime(w);
    $('rate').textContent = rateText(cam.L);
    $('when').textContent = clockText(cam.L);
    $('marker').style.top = pct(Math.max(LAD_BOT, Math.min(LAD_TOP, cam.L))) + '%';
    // caption: the nearest rung
    let best = 0; for (let i = 0; i < RUNGS.length; i++) if (Math.abs(RUNGS[i].L - cam.L) < Math.abs(RUNGS[best].L - cam.L)) best = i;
    if (best !== st.rungShown || !$('rungName').textContent) {
      if (st.rungShown >= 0 && RUNGS[st.rungShown].btn) RUNGS[st.rungShown].btn.classList.remove('on');
      st.rungShown = best; const r = RUNGS[best];
      if (r.btn) { r.btn.classList.add('on'); r.btn.hidden = false; }
      $('rungName').textContent = r.name;
      $('caption').innerHTML = r.text + (r.link ? ` <a href="${r.link}" target="_blank" rel="noopener">Open ${r.sim} →</a>` : '');
    }
  }

  // ---- the frame ----
  function frame(now) {
    const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
    resize();
    if (st.film) {
      st.L -= filmSpeed(st.L) * dt * (reduceMotion ? 0.6 : 1);
      st.orbit.yaw *= 1 - Math.min(1, dt * 0.8); st.orbit.pitch *= 1 - Math.min(1, dt * 0.8);
      if (st.L <= bottom()) { st.L = bottom(); st.film = false; if (!st.trip) st.clocks.solar = 0; syncFilm(); }
    } else if (st.target !== null) {
      const d = st.target - st.L; st.L += d * Math.min(1, dt * 2.5); if (Math.abs(d) < 0.002) { st.L = st.target; st.target = null;
        if (st.pending) { const p = st.pending; st.pending = null; setTrip(p.trip); st.target = p.then; } }
    }
    // on the Andromeda time trip the view follows the two galaxies in, until the reader takes over
    if (st.trip === 'm31' && st.autoZoom && st.target === null && !st.pending && window.PTEN_MERGER) {
      const sep = PTEN_MERGER.separation(PTEN_MERGER.simTime()), Lt = Math.log10(Math.max(1.5 * sep, 70) * S.KPC);
      st.L += (Math.min(22.55, Lt) - st.L) * Math.min(1, dt * 0.8);
    }
    st.L = Math.max(bottom(), Math.min(L_TOP, st.L));
    stepClocks(dt);
    const cam = Z.camera(st.L, st.orbit, st.trip);
    R.begin();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    // below ~40 km the sky is no longer black
    if (siteLayer) { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); siteLayer.drawSky(cam, PTEN_LAYERS.band(cam.L, -1.6, 3.6, 0.6, 1.0)); }
    for (const l of layers) {
      if (!visible(l)) continue;
      const a = st.trip && l.tripAlpha ? l.tripAlpha(cam.L) : l.alpha(cam.L); if (a < 0.003) continue;
      if (l.name === 'bodies' || l.opaque) gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.ONE, gl.ONE);
      l.draw(cam, a, st.clocks);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(true);
    }
    R.end(1.0);
    drawLabels(cam);
    hud(cam);
    window.PTEN_STATE = st;
    requestAnimationFrame(frame);
  }

  // ---- input: wheel/pinch zooms, drag orbits ----
  canvas.addEventListener('wheel', e => {
    e.preventDefault(); st.film = false; syncFilm(); st.target = null; st.autoZoom = false;
    const k = e.deltaMode === 1 ? 0.05 : 0.0015; st.L = Math.max(bottom(), Math.min(L_TOP, st.L + e.deltaY * k));
  }, { passive: false });
  const ptrs = new Map(); let pinch0 = null;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), L: st.L }; } });
  canvas.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); st.L = Math.max(bottom(), Math.min(L_TOP, pinch0.L - Math.log10(d / pinch0.d) * 1.5)); st.film = false; syncFilm(); return; }
    st.orbit.yaw -= (e.clientX - prev[0]) * 0.005; st.orbit.pitch = Math.max(-1.2, Math.min(1.2, st.orbit.pitch - (e.clientY - prev[1]) * 0.005));
  });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', () => { st.film = false; syncFilm(); st.target = Math.max(bottom(), st.L - 1); });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.key === '+' || e.key === '=') st.target = Math.max(bottom(), (st.target ?? st.L) - 1);
    if (e.key === '-') st.target = Math.min(L_TOP, (st.target ?? st.L) + 1);
  });
  if ($('tripBtn')) { $('tripBtn').addEventListener('click', () => goTrip(st.trip ? null : 'sgr')); }
  if ($('trip2Btn')) { $('trip2Btn').addEventListener('click', () => goTrip(st.trip ? null : 'm31')); }
  syncTrip();
  $('playBtn').addEventListener('click', () => { if (st.film) { st.film = false; syncFilm(); } else startFilm(); });
  $('topBtn').addEventListener('click', () => { st.film = false; syncFilm(); if (st.trip) goTrip(null); st.target = L_TOP; if (st.pending) st.pending.then = L_TOP; });
  $('resetView').addEventListener('click', () => { st.orbit.yaw = 0; st.orbit.pitch = 0; });
  // test hooks
  window.PTEN_GO = (L, clocks, trip) => { st.film = false; st.target = null; if (trip !== undefined && trip !== st.trip) setTrip(trip); st.L = L; if (clocks) Object.assign(st.clocks, clocks); };
  if (!reduceMotion) setTimeout(() => { if (st.L === L_TOP && !st.film && !location.hash.includes('still')) startFilm(); }, 1200);
  window.PTEN_LAYERS_LIST = () => layers;
})();
