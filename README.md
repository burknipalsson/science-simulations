# Science simulations made entirely by Claude Opus 5.5

A series of interactive physics and astronomy simulations, each a single self-contained HTML page that runs in the browser on the GPU (WebGL2). They are real simulations, not animations: each one was checked against published results or observations before the graphics went on, and each page says what it was checked against.

The series walks down the scale ladder, one simulation per rung, and ends with **Powers of Ten**, one continuous zoom through all of them: 41 powers of ten from a simulated cosmic web to Hallgrímskirkja in Reykjavík at 13:00 UTC on 16 October 2026, then into a person standing in that hour's wind, a capillary in the nail fold, a red blood cell, haemoglobin, water at body temperature, one molecule's electron cloud and a proton.

## The pages

Open the HTML files directly in a browser (a recent Chrome, Edge, Firefox or Safari with WebGL2; a discrete GPU helps). Each file is self-contained; only the web fonts load from Google Fonts.

| Simulation | Scale | Page | What it shows |
|---|---|---|---|
| Event Horizon | a black hole | [`Event Horizon.html`](Event%20Horizon.html) | Light bending round a Schwarzschild black hole and its disk, ray-traced exactly |
| Bridges & Tails | colliding galaxies | [`Bridges and Tails.html`](Bridges%20and%20Tails.html) | Tidal bridges and tails in restricted N-body, after Toomre & Toomre (1972) |
| The Cosmic Web | the universe | [`cosmic-web/cosmic-web.html`](cosmic-web/cosmic-web.html) | Dark matter growing into filaments and clusters, particle-mesh gravity in an expanding box |
| The Chirp | gravitational waves | [`the-chirp/the-chirp.html`](the-chirp/the-chirp.html) | Two black holes spiralling together and the wave they send out |
| The Clockwork | the solar system | [`solar-system/the-clockwork.html`](solar-system/the-clockwork.html) | Planets, moons and asteroids integrated with relativity, checked against JPL's ephemeris |
| The Atmosphere | a planet's weather | [`the-atmosphere/the-atmosphere.html`](the-atmosphere/the-atmosphere.html) | A spectral global circulation model running live: jet streams, storms, climates of other worlds |
| The Wind Tunnel | ~1 m flows | [`wind-tunnel/wind-tunnel.html`](wind-tunnel/wind-tunnel.html) | 3D lattice-Boltzmann air past wings, a cyclist, a car, a tower, and blood through a narrowed artery |
| The Hydrogen Bond | ~1 nm water | [`water/water.html`](water/water.html) | Molecular dynamics of water: ice melting, crystals growing, why ice floats |
| The Quantum Atom | ~0.1 nm | [`quantum-atom/quantum-atom.html`](quantum-atom/quantum-atom.html) | The double slit and tunnelling solved live, exact hydrogen orbitals and the H₂⁺ bond, MRI |
| Inside a Drop of Blood | ~10 µm cells | [`blood/blood.html`](blood/blood.html) | Elastic red cells in flowing plasma: parachutes in capillaries, the Fåhræus–Lindqvist effect, sickle cells, malaria |
| Powers of Ten | 10²⁵ m → 10⁻¹⁵ m | [`powers-of-ten/powers-of-ten.html`](powers-of-ten/powers-of-ten.html) | The whole ladder in one zoom, with side trips to the black hole at the Galaxy's centre and to the Milky Way–Andromeda collision |

## How each page is built

Each simulation lives in its own folder: the page template (`page.html`, or `page_head.html` + `page_body.html` with `sec_*.html` sections) and plain JavaScript modules for the physics, the rendering and the page. `python3 build.py` in a folder inlines everything into the single HTML file, with data embedded (gzip + base64).

The physics modules also run in Node, and the `test_*.js` files check them headlessly against reference results, for example:

```
cd powers-of-ten && node test_zoom.js && node test_sgr.js && node test_m31.js
cd solar-system && node test_ephem.js
cd quantum-atom && node test_hydrogen.js
```

GPU validation cases run in headless Chromium through Playwright (`gpu_run.js` with `gpu_cases.js` in the wind tunnel, blood and water folders). The `mk.sh` scripts only copy a test build to a local scratch folder.

Some data scripts fetch from public services (JPL Horizons, NASA image servers, OpenStreetMap's Overpass API, the AWS terrain tiles, RCSB PDB, arXiv). Their raw downloads and a few large intermediate files are not committed (see `.gitignore`); the packed data the pages use is. The quantum-chemistry step in `powers-of-ten/data/qc` needs PySCF.

## Data and credits

Every page lists its own sources and credits in a section near the end. The imagery and data embedded in the pages keep their own licences, including:

- NASA Blue Marble, Black Marble and lunar imagery (NASA Earth Observatory, public domain)
- Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data), CC BY-NC-SA 4.0
- OpenStreetMap data © OpenStreetMap contributors, ODbL
- ArcticDEM (Polar Geospatial Center, University of Minnesota)
- HYG star database (D. Nash), CC BY-SA
- Local Volume Database (A. B. Pace)
- RCSB Protein Data Bank entry 2DN1 (Park et al. 2006)
- JPL Horizons and the JPL Small-Body Database
- Published measurements cited on each page (Reid et al. 2019, Gillessen et al. 2017, GRAVITY 2019, van der Marel et al. 2012 and 2019, and many more)

The simulations were built with Claude (Anthropic) in Claude Code.
