# RBC simulation reference numbers (verified 2026-10-14)

Tags: VERIFIED means I read the number in the primary paper or its PubMed abstract. SECONDARY means I read it in a reliable paper that cites the primary one. UNVERIFIED means I could not confirm it.

## 1. Evans & Fung 1972 shape
- **Shape formula (VERIFIED in Dao, Lim & Suresh 2003, which quotes Evans & Fung 1972).**
  Z = ±0.5·R0·sqrt(1−ρ²)·(C0 + C1ρ² + C2ρ⁴), where ρ = r/R0.
  - R0 = 3.91 µm.
  - Dimensionless coefficients: C0 = 0.207161, C1 = 2.002558, C2 = −1.122762.
  - Source: J Mech Phys Solids 51:2259 (2003), eq. 7. https://www.mit.edu/~mingdao/papers/JMPS_2003_Red_Blood_Cell.pdf
- **Same formula in micrometres (VERIFIED in Dodson & Dimitrakopoulos 2010, Biophys J 99:2906, eq. 1).**
  Half-thickness f(r) = ½·sqrt(1−ρ²)·(C0 + C2ρ² + C4ρ⁴), with R0 = 3.91, C0 = 0.81, C2 = 7.83, C4 = −4.39 µm.
  - These are the dimensionless values above multiplied by R0: 3.91 × 2.002558 = 7.83 and 3.91 × −1.122762 = −4.39.
  - https://terpconnect.umd.edu/~dimitrak/Papers/PD_2010_BPJ_RBC_Cytoskeleton.pdf
- **Your form has one R0 too many.**
  - If C is in µm, use z = ±0.5·sqrt(1−ρ²)·(C0 + C2ρ² + C4ρ⁴), with no R0 in front.
  - Use 0.5·R0 in front only with the dimensionless C's.
  - C2 = 7.83 is correct. The value 7.38 in arXiv:1605.04509 is a typo.
- **Mean cell size (VERIFIED in Dodson & Dimitrakopoulos 2010, citing Evans & Fung 1972):**
  - diameter 7.8 µm
  - thickness 0.8–2.6 µm
  - area 135 µm²
  - volume 94 µm³ at 300 mOsm
  - a sphere of the same volume has radius 2.8 µm and area 100 µm²
- **My numerical integration of the µm form:**
  - centre thickness 0.81 µm
  - maximum thickness 2.57 µm, at r ≈ 2.74 µm
  - volume 94.1 µm³
  - area ≈ 134–135 µm²
- **Diameter used in simulations:** Fedosov uses 7.82 µm (thesis, Brown 2010). https://www.dam.brown.edu/dpd/lib/exe/fetch.php/wiki:phd_thesis:fedosov_thesis.pdf

## 2. Optical-tweezers stretching (healthy cells)
- **Setup (VERIFIED in Dao, Lim & Suresh 2003):**
  - Two silica beads, 4.12 µm diameter, bound at opposite ends of the cell. One bead is anchored to the glass slide and the other is trapped by a 1.5 W Nd:YAG laser.
  - In the finite-element model the bead–cell contact diameter is dc = 2 µm, with 1–2 µm explored.
  - Bending modulus used: B0 = 2×10⁻¹⁹ N·m (literature range 1.7–7×10⁻¹⁹). Results changed by less than 5% across that range above 50 pN.
  - Dao 2003's own fit used the original force calibration: µ0 = 22.5 µN/m, effective µ = 13.3 µN/m (range 11.1–17.7). These are superseded by Mills 2004.
- **Mills, Qie, Dao, Lim, Suresh 2004 fit (SECONDARY, from Li, Dao, Lim, Suresh 2005, Biophys J 88:3707):**
  - "From Mills et al. (2004), we estimate that µ0 = 7.3 µN/m (5.3–11.3 µN/m range covers most of the data scatter)."
  - Li 2005's finite-element curve used µ0 = 8.0 µN/m and κ = 2×10⁻¹⁹ J. Its spectrin-level model gave µ0 ≈ 8.3 µN/m.
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC1305517/
  - The MIT GEM4 lecture slide reproducing Mills 2004 Fig. shows neo-Hookean curves for µ0 = 5.3, 7.3, 11.3 and 5.5 (constant area) µN/m: https://ocw.mit.edu/ans7870/GEM4/summer_2007/Lectures/continuum_model.pdf
  - Mills 2004 itself is Mech Chem Biosyst 1:169–180, doi 10.3970/mcb.2004.001.169 (citation VERIFIED). I could not read the full text.
  - Relaxation time tc = 0.19 ± 0.06 s (VERIFIED in Dao 2003).
- **Fedosov, Caswell, Karniadakis 2010 (Biophys J 98:2215), VERIFIED:**
  - Best match to Suresh 2005 healthy data: µ0 = 6.3 µN/m, Y = 18.9 µN/m.
  - Force applied over ε = 2% of vertices at each end, "corresponds to the contact diameter of the attached silica bead with diameter 2 µm".
  - κ = 2.4×10⁻¹⁹ J ("widely accepted"). Their rheology fit preferred 4.8×10⁻¹⁹ J with membrane viscosity ηm = 0.022 Pa·s.
  - https://pmc.ncbi.nlm.nih.gov/articles/PMC2872218/
  - Li 2005 instead used 5% of vertices at each end.
- **Data points (SECONDARY, digitized).** The values below come from HemoCell's validation file `examples/stretchCell/validation/reference-bounds.dat`. The file does not say where it was digitized from; the force levels match the Mills 2004 / Suresh 2005 healthy-cell data.
  - https://github.com/UvaCsl/HemoCell/tree/master/examples/stretchCell/validation
  - In the table, means are listed first and the experimental scatter band follows in brackets. Digitizing error is about ±0.1 µm.

| F (pN) | Axial D_A (µm) | Transverse D_T (µm) |
|---|---|---|
| 0 | ~7.9 [7.2–8.6] | ~7.9 |
| 16 | 9.26 [8.35–10.10] | 6.20 [5.58–6.81] |
| 19 | 9.58 [8.70–10.45] | 6.28 [5.64–6.92] |
| 30 | 10.53 [9.62–11.39] | 5.72 [5.13–6.32] |
| 38 | 11.14 [10.08–12.29] | 5.44 [4.82–5.99] |
| 47 | 11.86 [10.82–12.97] | 5.07 [4.29–5.83] |
| 68 | 12.87 [11.88–13.87] | 4.64 [3.94–5.36] |
| 88 | 13.77 [12.58–14.98] | 4.64 [4.00–5.27] |
| 109 | 14.35 [12.87–15.82] | 4.60 [3.98–5.23] |
| 130 | 15.19 [13.89–16.62] | 4.53 [3.88–5.19] |
| 151 | 15.60 [14.43–16.87] | 4.35 [3.78–4.99] |
| 173 | 16.07 [14.26–17.88] | 4.60 [4.08–5.05] |
| 193 | 16.30 [14.49–18.02] | 4.39 [3.75–4.94] |

  - The same repo has smooth reference curves (`reference-axial.dat`, `reference-transverse.dat`). Spot values: about 11.1/6.3 µm at 38 pN, 13.5/4.96 at 88 pN, 15.4/4.37 at 150 pN, and 16.35/4.21 at 191 pN.
  - Exact tabulated values from the papers themselves: UNVERIFIED. Neither Mills 2004 nor Suresh 2005 publishes a table; they give figures only.

## 3. Tank-treading (Fischer 2007, Biophys J 93:2553), VERIFIED from text and figures
https://pmc.ncbi.nlm.nih.gov/articles/PMC1965429/ (PDF: https://europepmc.org/api/getPdf?pmcid=PMC1965429)
- **Setup:**
  - Dextran media of 12.9, 28.9, 53.9 and 109.3 mPa·s (measured at 23 °C).
  - Shear rate γ̇ from 1 to 290 s⁻¹ in a cone-plate rheoscope at room temperature (23 °C).
  - 1873 cells from 3 donors.
  - f is counted in revolutions per second, not rad/s.
- **Shape of the curve:** f is not quite linear in γ̇. It fits f ∝ γ̇^β with β = 0.85–0.95 (Fig. 4a).
- **f/γ̇ at γ̇ = 180 s⁻¹ (read from Fig. 5):**
  - about 0.022–0.026 at 12.9 mPa·s
  - about 0.025–0.031 at 28.9 mPa·s
  - about 0.025–0.032 at 53.9 mPa·s
  - about 0.031–0.035 at 109 mPa·s
- **Viscosity dependence:**
  - Regression slope of f/γ̇ against log10 η0: 0.0036 ± 0.0009. Tran-Son-Tay 1983 found 0.0079 ± 0.0011.
  - Fischer et al. 1978 found a constant f/γ̇ ≈ 0.0255.
- **Example (Fig. 4b, donor 3, 28.9 mPa·s):** f ≈ 4 s⁻¹ at 125 s⁻¹ and ≈ 7–7.5 s⁻¹ at 255 s⁻¹.
- **Simulation practice (SECONDARY):**
  - Fedosov's thesis compares against Tran-Son-Tay 1984 and Fischer 2007 with ηo = ηi = 5 mPa·s and ηm = 0.022 Pa·s, plotting ω in rad/s (ω = 2πf).
  - Dodson & Dimitrakopoulos 2010 compare with Fischer donor 3 using ηc = 6 mPa·s.
  - arXiv:2209.02328 uses η_ext = 28.9 mPa·s, giving λ = 0.346.

## 4. Pries 1992 in-vitro viscosity and the Fåhræus effect
- **Viscosity law (VERIFIED in Secomb & Pries 2013, C R Physique 14:470, eqs. 3–5, attributed to Pries et al. 1992):**
  - η_rel = 1 + (η0.45 − 1)·[(1−HD)^C − 1]/[(1−0.45)^C − 1]
  - η0.45 = 220·e^(−1.3D) + 3.2 − 2.44·e^(−0.06·D^0.645)
  - C = (0.8 + e^(−0.075D))·(−1 + 1/(1+10⁻¹¹D¹²)) + 1/(1+10⁻¹¹D¹²)
  - D is in µm and HD is the discharge haematocrit. Only data with Ū/D ≥ 50 s⁻¹ were used.
  - Your formula is exactly right. The same formula appears in PMC6208590, which cites Pries, Neuhaus, Gaehtgens, Am J Physiol 263:H1770, 1992.
  - https://comptes-rendus.academie-sciences.fr/physique/item/10.1016/j.crhy.2013.04.002.pdf
  - The original 1992 PDF is paywalled (403), so I did not read it.
- **My evaluation of η_rel at HD = 0.15 / 0.30 / 0.45:**
  - D = 10 µm: 1.07 / 1.17 / 1.33
  - D = 20 µm: 1.13 / 1.31 / 1.59
  - D = 30 µm: 1.17 / 1.41 / 1.78
  - D = 40 µm: 1.21 / 1.49 / 1.92
  - D = 100 µm: 1.33 / 1.78 / 2.44
  - D = 1000 µm: 1.50 / 2.18 / 3.19
  - The minimum is near D ≈ 7–8 µm.
- **In-vivo variant (VERIFIED, same review, eq. 7):** η*0.45 = 6·e^(−0.085D) + 3.2 − 2.44·e^(−0.06·D^0.645).
- **Fåhræus formula: two coefficient sets exist.**
  - HT/HD = HD + (1−HD)·(1 + 1.7·e^(−0.415D) − 0.6·e^(−0.011D)) is attributed to Pries, Secomb, Gaehtgens, Gross 1990 (Circ Res 67:826) by Wikipedia and the NSR Physiome model. That is SECONDARY.
  - Fedosov et al. 2010 (Microcirculation 17:615, eq. 12) and Fedosov's thesis give 1 + 1.7·e^(−0.35D) − 0.6·e^(−0.01D), citing Pries, Neuhaus, Gaehtgens 1992. That is SECONDARY: https://pmc.ncbi.nlm.nih.gov/articles/PMC3529161/
  - So your 0.415/0.011 version is the 1990 fit. The 1992 paper appears to use 0.35/0.01. I could not check the original 1992 equation, so that point is UNVERIFIED.
  - The two sets differ by at most about 1.5% for D = 10–100 µm. At HD = 0.45, HT/HD ≈ 0.72, 0.73, 0.78 and 0.88 at D = 10, 20, 40 and 100 µm.

## 5. Cell-free layer (CFL)
- **Secomb & Pries 2013 (VERIFIED):**
  - For D > 30 µm, a two-layer model fits the data with η_core/η_p = 3.3 and a fixed CFL width of 1.8 µm.
  - Simulations at Ht = 0.45 gave a CFL of about 1.8 µm in 20 µm and 40 µm tubes.
  - Two-layer formula: η_app = η_p / [1 − λ⁴(1 − η_p/η_core)], where λD is the core diameter.
- **Fedosov et al. 2010 Microcirculation (VERIFIED), DPD simulations of 10–40 µm tubes at Ht = 0.15–0.45:**
  - At D = 10 µm and Ht = 0.45, the CFL is 1.19, 1.30 or 1.45 µm depending on how wall and cell repulsion is modelled.
  - The in-vitro data they compare against are Bugliarello & Sevilla 1970 (Biorheology 7:85) and Reinke et al. 1987 (D = 31 µm, HD = 0.45). They report agreement, but the values are in a figure only.
  - In-vivo data: Maeda (rabbit mesentery) 1–1.8 µm for D = 10–40 µm at Ht = 0.45; Kim (rat cremaster) 0.5–3 µm, increasing over D = 10–50 µm at Ht = 0.42; Yamaguchi (cat brain) about 4 µm.
  - Glycocalyx thickness is about 0.4–0.5 µm.
  - Plasma viscosity used: 1.2 mPa·s.
- **Tateishi 1994:** not found, so UNVERIFIED. Exact Bugliarello & Sevilla values: UNVERIFIED (I did not read the original).

## 6. Fluid and membrane constants
- **Plasma viscosity:** 1.10–1.30 mPa·s at 37 °C, independent of age and sex (VERIFIED, Késmárky et al. 2008, Clin Hemorheol Microcirc 39:243, PMID 18503132). https://pubmed.ncbi.nlm.nih.gov/18503132/
- **Cytoplasm viscosity:**
  - Healthy cells: 5.6 ± 1.6 mPa·s, measured by membrane fluctuations. The reference value is 5.5 mPa·s at Hb 32 g/dL, with η = 0.0474·T/(7 − 0.128·c) (VERIFIED, Byun et al. 2012, Acta Biomater 8:4130). https://pmc.ncbi.nlm.nih.gov/articles/PMC3576574/
  - About 6 mPa·s at 37 °C (SECONDARY, Dodson & Dimitrakopoulos 2010).
  - The Cokelet & Meiselman 1968 abstract confirms Hb solutions are Newtonian but gives no number.
- **Shear modulus µ0:**
  - 6.6×10⁻³ dyn/cm = 6.6 µN/m at 25 °C, falling by 0.06 µN/m per °C (VERIFIED, micropipette, Waugh & Evans 1979, Biophys J 26:115). https://pubmed.ncbi.nlm.nih.gov/262408/
  - Optical tweezers give 5–10 µN/m (median 6.8) at 25 °C and 6.6 µN/m at 37 °C (VERIFIED, Mills et al. 2007, PNAS 104:9213). https://lab.prd.vanderbilt.edu/lang-lab/wp-content/uploads/sites/195/2023/01/JPMills-etal2007.pdf
  - Fluctuation measurements give 7.1 ± 1.6 µN/m (Byun 2012).
  - Small-strain optical tweezers give 2.5 ± 0.4 µN/m (SECONDARY, Hénon et al. 1999, cited by Dodson & Dimitrakopoulos 2010).
  - Simulation choices: 6.3 µN/m (Fedosov) or 5.3–7.3 µN/m (Mills fits).
- **Area-expansion modulus K:**
  - 288 ± 50 dyn/cm = 0.29 N/m at 25 °C; lysis at 2–4% area strain (VERIFIED, Evans, Waugh, Melnik 1976, Biophys J 16:585). https://pubmed.ncbi.nlm.nih.gov/1276386/
  - 450 dyn/cm = 0.45 N/m at 25 °C (VERIFIED, Waugh & Evans 1979).
  - For simulations, K is about 4×10⁴ times µ0, so in practice the membrane area is held nearly fixed.
- **Bending modulus κ:**
  - 1.8×10⁻¹² dyn·cm = 1.8×10⁻¹⁹ J (VERIFIED, Evans 1983, Biophys J 43:27, from micropipette buckling). https://pubmed.ncbi.nlm.nih.gov/6882860/
  - Common simulation values are 2×10⁻¹⁹ J (Dao, Mills) and 2.4×10⁻¹⁹ J (Fedosov).
- **Membrane viscosity:** 0.022 Pa·s in a 3D model (Fedosov 2010). Membrane surface viscosity from tank-treading: Tran-Son-Tay et al. 1984, Biophys J 46:65 (shear-thinning; I did not record the value).

## 7. Capillary flow
- **Parachute shapes (VERIFIED, Skalak & Brånemark 1969, Science 164:717):** the parachute or umbrella shape "is not an axisymmetric shape as formerly assumed, but is the basic biconcave disk shape of the red cell with the upstream end flattened by the pressure gradient." https://pubmed.ncbi.nlm.nih.gov/5778020/
  - Simulated biconcave-to-parachute transition in a 9 µm tube at a mean velocity of about 65 µm/s (VERIFIED, Fedosov 2010 BPJ).
- **Capillary diameter:**
  - Single-file flow in capillaries up to about 8 µm; apparent viscosity keeps falling down to about 7 µm; minimum passable tube about 2.7 µm (VERIFIED, Secomb & Pries 2013).
  - Capillary diameter 5–7 µm and length 0.5–1.1 mm (SECONDARY, a 2025 Aston paper citing Guyton & Hall 2006). https://publications.aston.ac.uk/id/eprint/47028/6/Blood_flow_dynamics_in_the_arterial_and_venous_parts_2025.pdf
- **RBC velocity:**
  - Capillary flow speeds 0.2–1.5 mm/s; with about 1 mm capillaries, organ transit 0.7–5 s (SECONDARY, Freitas, Nanomedicine I §8.2.1.1). https://www.nanomedicine.com/NMI/8.2.1.1.htm
  - Human nailfold: mostly 1–2 mm/s (Butti 1975, via BioNumbers) and 0.93 ± 0.11 mm/s in another intravital study. Both SECONDARY, and the methods disagree widely.
- **Transit time:**
  - Cerebral capillary network: 100–300 ms over 150–500 µm paths, at rest (SECONDARY, review abstract).
  - "~1 s capillary transit" as a precise value: UNVERIFIED. Hofrichter 1974 states only that sickle delay times "span both the mean capillary transit and total circulation times".
- **Oxygen unloading numbers** (e.g. SaO₂ 97% to SvO₂ about 75% at rest): UNVERIFIED (I did not get to a primary source).

## 8. Neutrophil and bacterium
- **Neutrophil size:** volume 299 ± 32 µm³, measured on spherical cells (VERIFIED, Ting-Beall, Needham, Hochmuth 1993, Blood 81:2774). That is an equivalent sphere diameter of about 8.3 µm (my calculation). https://pubmed.ncbi.nlm.nih.gov/8490184/
  - "12–15 µm on a smear": UNVERIFIED.
- **Neutrophil speed:**
  - Chemotaxis toward fMLP, healthy volunteers: 18 ± 5 µm/min (range 14–24); burn patients 9 ± 6 µm/min (VERIFIED, Butler et al. 2010, PLoS One 5:e11921). https://pmc.ncbi.nlm.nih.gov/articles/PMC2912851/
  - Ex vivo whole blood, healthy controls: 21.1 µm/min (SECONDARY). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6177179/
- **Rogers film (VERIFIED as told in Stossel's 1999 commentary, hosted at UNSW Embryology):**
  - 16-mm movie made in the 1950s by the late David Rogers at Vanderbilt University.
  - It reached Thomas P. Stossel via Victor Najjar.
  - A human neutrophil on a blood film crawls among red cells and "chases" Staphylococcus aureus that were added to the film. Platelets stuck to the glass are visible.
  - The chemoattractant is possibly C5a and/or N-formyl peptides.
  - https://embryology.med.unsw.edu.au/embryology/index.php/Movie_-_Neutrophil_chasing_bacteria
  - The exact year is UNVERIFIED.
- **S. aureus size:** about 1 µm diameter; volume 0.47 µm³ at the start of the cell cycle and 0.91 µm³ before division (VERIFIED, Monteiro et al. 2015, Nat Commun 6:8055). https://pmc.ncbi.nlm.nih.gov/articles/PMC4557339/

## 9. Disease stiffening
- **Sickle cells, deoxygenated (VERIFIED qualitatively, Itoh, Chien, Usami 1995, Blood 85:2245):**
  - Micropipette static rigidity E and dynamic rigidity η show no rise before morphological sickling, then rise sharply after it.
  - Dense cells rise "toward infinity" and behave as solids.
  - Dynamic rigidity rises more than static rigidity.
  - https://pubmed.ncbi.nlm.nih.gov/7718897/
  - Fold-change numbers: UNVERIFIED. Simulation papers such as Lei & Karniadakis 2012 (Soft Matter) use 20–70 µ0 "according to experiments" (SECONDARY, from a search snippet).
- **Sickle cells, oxygenated (VERIFIED, Byun 2012):**
  - Shear modulus: µ = 7.1 ± 1.6 µN/m in healthy cells; 8.0 ± 4.3, 7.7 ± 4.9 and 20.0 ± 9.8 µN/m in SCD cell types II, III and IV (IV = irreversibly sickled cells).
  - Cytoplasm viscosity: 5.6 mPa·s healthy versus about 24 mPa·s in SCD.
- **Sickle and dense cells generally (VERIFIED):** Evans, Mohandas, Leung 1984 (J Clin Invest 73:477) found that stiffness rises with cell haemoglobin concentration.
- **Polymerization delay (VERIFIED, Hofrichter, Ross, Eaton 1974, PNAS 71:4864):**
  - Delay time scales roughly as [deoxyHbS]^30. Going from 23 to 22 g/dL makes it 4 times longer.
  - A 1 °C rise (in the 20–30 °C range) almost halves it.
  - Delay times "span both the mean capillary transit and total circulation times".
  - https://pubmed.ncbi.nlm.nih.gov/4531026/
- **Malaria (P. falciparum):**
  - The Suresh et al. 2005 abstract (Acta Biomater 1:15, PMID 16701777) says only "shear modulus ... increase up to 10-fold during parasite development" (VERIFIED). https://pubmed.ncbi.nlm.nih.gov/16701777/
  - The per-stage values you listed (8.5/16/53 µN/m, or 5.3 healthy) are UNVERIFIED; I could not get the full text.
  - Fedosov's thesis matched the Suresh 2005 curves with µ0 = 6.3 (healthy), 14.5 (ring), 29 (trophozoite) and 60 µN/m (schizont), or 40 µN/m for a near-spherical schizont (SECONDARY).
  - Mills 2007 PNAS (VERIFIED):
    - Healthy cells: 6.8 µN/m (median) at 25 °C.
    - Late ring stage: 17.7 µN/m at 25 °C, 17.6 µN/m at 37 °C, 29.9 µN/m at 41 °C (fever).
    - Trophozoite: 35.9 µN/m.
    - Ring stage without the RESA protein: 9.4 µN/m.
- **Stored blood:** shear modulus rose from 2.5 to 13 µN/m over 21 days of storage (optical tweezers, 3 donors) (SECONDARY, Czerwinska et al. 2015, Cell Mol Bioeng). https://doc.rero.ch/record/331230
- **Diabetes:** Agrawal et al. 2016 (Sci Rep 5:15873) found reduced deformability with optical tweezers. Moduli: UNVERIFIED.

## 10. Blood counts and platelets
- **Adult reference ranges (VERIFIED, MedlinePlus "Complete blood count"):**
  - RBC: male 4.6–6.2 and female 4.2–5.4 million/µL
  - WBC: 4,500–11,000/µL
  - Platelets: 150,000–400,000/µL (the page has a typo, "/dL")
  - Haematocrit: male 40–55%, female 36–48%
  - MCV: 80–100 fL
  - https://medlineplus.gov/ency/article/003642.htm
- **Platelet size:** anucleate discs, "roughly 2–3 µm in diameter" (VERIFIED, Thon & Italiano 2012, Handb Exp Pharmacol 210:3, PMID 22918725). https://pubmed.ncbi.nlm.nih.gov/22918725/
  - Thickness about 0.5 µm and volume 6–10 fL (SECONDARY, via White 2007 *Platelets*; the page was not readable).
