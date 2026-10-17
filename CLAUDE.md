# Science simulations

This folder holds a series of interactive physics and astronomy simulations, each built as a single-page HTML artifact published on claude.ai. They are real simulations, not animations: every one is validated against published results or observations before the graphics go on. They are made to be explored and shared; the audience includes informed laypeople, so pages pitch real numbers and real physics in plain language, and a medical angle is welcome where it fits.

## The series so far

| Sim | Scale | Source | Link |
|---|---|---|---|
| Event Horizon | black hole | `Event Horizon.html` | https://claude.ai/artifact/7nAXFvzXgzTmTw1uUA2pHj |
| Bridges & Tails | colliding galaxies | `Bridges and Tails.html` | https://claude.ai/artifact/W7a5NPP4u4DVThdoPoryfi |
| The Cosmic Web | the universe | `cosmic-web/` | https://claude.ai/artifact/WgnUu4Yr1KaP951tsosNFN |
| The Chirp | gravitational waves | `the-chirp/` | https://claude.ai/artifact/8baECxjapREFAQdvyCNm8i |
| The Clockwork | solar system | `solar-system/` | https://claude.ai/artifact/1LFZu6uDUjnDRNmWkfTgkE |
| The Atmosphere | a planet's weather | `the-atmosphere/` | https://claude.ai/artifact/Ef45tXiR52txc37t7tXzJW |
| The Wind Tunnel | ~1 m flows, blood | `wind-tunnel/` | https://claude.ai/artifact/Gz2ttAcu7XQKk7mLVX4zjg |
| The Hydrogen Bond | ~1 nm water | `water/` | https://claude.ai/artifact/2edgeA6wtLQ2vUEisxZsE7 |
| The Quantum Atom | ~0.1 nm atom | `quantum-atom/` | https://claude.ai/artifact/CmPLT4z2Yu6dTNU5hy7aV4 |
| Inside a Drop of Blood | ~10 µm cells | `blood/` | https://claude.ai/artifact/8CRDJPovWFi6refGv9ioCw |
| Powers of Ten | 10²⁵ m → Reykjavík → a proton | `powers-of-ten/` | https://claude.ai/artifact/Qe6w1886jRt5GHVscDKxtN |

## Where we are going

We are walking down the scale ladder, one real simulation per rung, then tying them together:

1. **The Wind Tunnel** (~1 m), built 2026-10-06: a 3D lattice-Boltzmann fluid sim on the GPU. Air past a wing, cyclist, car and building; vortex streets, turbulence, stall, how lift works. Medical case: blood through a narrowed artery or heart valve, the jet and swirls a stethoscope hears as a murmur.
2. **Water, molecule by molecule** (~1 nm), built 2026-10-12 as The Hydrogen Bond: live TIP4P/2005 + mW molecular dynamics on the GPU; ice melting, a crystal growing from a seed, why ice floats, freezing-point depression.
3. **The Quantum Atom** (~0.1 nm), built 2026-10-13: live 2D split-operator Schrödinger solver on the GPU (double slit, which-path, tunnelling), exact hydrogen orbitals and spectrum, exact H₂⁺ bond, and an MRI (Bloch equation) medical aside.
4. **Inside a Drop of Blood** (~10 µm), built 2026-10-15: GPU lattice-Boltzmann plasma with elastic red-cell membranes (immersed boundary, viscosity contrast 5): capillary parachutes, the Fåhræus–Lindqvist effect validated against Pries 1992 and Fedosov 2010, sickle cells, malaria through a spleen-like slit. The white-cell chase was not built. A fine-grid (0.25 µm) record-and-replay of the arteriole was added the same day.
5. **Powers of Ten**, built 2026-10-16/17: one continuous zoom through all the sims, 41 powers of ten from the cosmic web to Hallgrímskirkja, Reykjavík at 13:00 UTC 16 Oct 2026, then into a person in that hour's wind, a nailfold capillary, a recorded red cell, haemoglobin, water at 310 K, a CCSD electron cloud and a proton. Side trips: the S-stars and the shadow of Sgr A*, and the Milky Way–Andromeda collision over 12 billion years.

## How each sim is built

- **Layout:** each multi-file sim lives in its own folder: `page.html` (or `page_head.html` + `page_body.html`) plus separate JS modules. `python3 build.py` inlines everything into one HTML file, and `./mk.sh` builds and copies a test version to the session scratchpad.
- **Physics first:** write the physics as plain JS modules that also run in node, and validate them headlessly against reference results before writing the graphics (`test_*.js` files). The Atmosphere, for example, passed the Held–Suarez and Jablonowski–Williamson benchmarks first.
- **Visual check:** look at the page through headless Chromium on the real GPU. Use playwright with the cached Chromium in `~/.cache/ms-playwright/chromium-1243` and `--use-angle=gl-egl --ignore-gpu-blocklist`. Serve the scratchpad over `python3 -m http.server`, and prepend a `<meta charset="utf-8">` to local test copies.
- **Artifact rules:** the page can't fetch data at runtime, so embed it (gzip + base64, decoded with DecompressionStream). Web Workers from blob URLs work. Keep pages under 16 MB.
- **Design:** dark single theme, Newsreader display serif, IBM Plex Sans and Mono, a warm accent. A live simulation stage with HUD readouts, then sections with "show me" buttons, a field guide, a table of real objects or a comparison with observations, and a "how it works" section.
- **Hardware:** the main machine has an RTX 4090 and 32 CPU threads, so big GPU workloads and many workers are fine. Pages should still scale down gracefully on ordinary laptops.

Detailed per-sim notes (architecture, validation numbers, bugs found) are kept in Claude's memory for this folder.
