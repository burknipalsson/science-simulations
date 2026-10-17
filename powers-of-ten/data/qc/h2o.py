# Electron density of one water molecule at its experimental equilibrium geometry (r 0.9572 A, angle 104.52 deg,
# the same geometry as TIP4P/2005), from CCSD natural orbitals. Writes the basis and orbitals as JSON for the page,
# which evaluates the density analytically in the shader.  Run with the scratchpad venv (pyscf).
import json, sys, numpy as np
from pyscf import gto, scf, cc, dft
r, th = 0.9572, np.radians(104.52)
geom = f"O 0 0 0; H {r*np.sin(th/2)} 0 {r*np.cos(th/2)}; H {-r*np.sin(th/2)} 0 {r*np.cos(th/2)}"
out = {}
def dipole(mol, dm):
    ch = mol.atom_charges(); co = mol.atom_coords()
    nuc = np.einsum('i,ix->x', ch, co)
    with mol.with_common_orig((0, 0, 0)): ao = mol.intor_symmetric('int1e_r', comp=3)
    el = np.einsum('xij,ji->x', ao, dm)
    return np.linalg.norm(nuc - el) * 2.541746  # debye
for basis in ['aug-cc-pvdz', 'aug-cc-pvtz']:
    mol = gto.M(atom=geom, basis=basis, unit='Angstrom', cart=False, verbose=0)
    mf = scf.RHF(mol).run()
    mc = cc.CCSD(mf).run()
    dm_mo = mc.make_rdm1(); dm = mf.mo_coeff @ dm_mo @ mf.mo_coeff.T
    ks = dft.RKS(mol); ks.xc = 'b3lyp'; ks.run()
    print(basis, 'nbf', mol.nao, 'E_HF', mf.e_tot, 'E_CCSD', mc.e_tot, 'dipole HF %.3f CCSD %.3f B3LYP %.3f D' % (dipole(mol, mf.make_rdm1()), dipole(mol, dm), dipole(mol, ks.make_rdm1())), flush=True)
    out[basis] = dict(mol=mol, mf=mf, dm=dm, dm_mo=dm_mo)
# export aug-cc-pVDZ CCSD natural orbitals (cartesian-free: spherical d), in bohr
mol, mf, dm_mo = out['aug-cc-pvdz']['mol'], out['aug-cc-pvdz']['mf'], out['aug-cc-pvdz']['dm_mo']
occ, U = np.linalg.eigh(dm_mo); idx = np.argsort(-occ); occ, U = occ[idx], U[:, idx]
C = mf.mo_coeff @ U
keep = occ > 2e-3
print('NO occupations', np.round(occ[:14], 4), 'kept', keep.sum(), 'electrons kept', occ[keep].sum())
shells = []
for b in range(mol.nbas):
    l = mol.bas_angular(b); a = mol.bas_atom(b)
    exps = mol.bas_exp(b); cs = mol.bas_ctr_coeff(b)   # normalised contraction coefficients (pyscf convention)
    for k in range(cs.shape[1]):
        shells.append(dict(atom=int(a), l=int(l), exp=exps.tolist(), coef=cs[:, k].tolist()))
# AO order check: pyscf spherical order p: (x,y,z) for l=1; d: (xy, yz, z2, xz, x2-y2)
json.dump(dict(atoms=mol.atom_coords().tolist(), Z=mol.atom_charges().tolist(), shells=shells, occ=occ[keep].tolist(), C=C[:, keep].T.tolist(),
               geom_A=geom), open('h2o_no.json', 'w'))
# reference density values at test points (bohr) for checking the JS/GLSL evaluator
pts = np.array([[0, 0, 0], [0.3, 0.2, 0.1], [1.43, 0, 1.1], [0, 1, 0], [2, -1, 1.5], [0, 0, 3]] + [mol.atom_coords()[1] + [0.01, 0, 0]])
ao = mol.eval_gto('GTOval_sph', pts)
dm = C[:, keep] @ np.diag(occ[keep]) @ C[:, keep].T
rho = np.einsum('pi,ij,pj->p', ao, dm, ao)
dmfull = out['aug-cc-pvdz']['dm']
print('rho test', rho.tolist()); json.dump(dict(pts=pts.tolist(), rho=rho.tolist(), rho_full=np.einsum('pi,ij,pj->p', ao, dmfull, ao).tolist()), open('h2o_test.json', 'w'))
print('electrons on grid check:', end=' ')
from pyscf.dft import gen_grid
g = gen_grid.Grids(mol); g.level = 4; g.build(); a2 = mol.eval_gto('GTOval_sph', g.coords)
print(np.einsum('p,pi,ij,pj->', g.weights, a2, dm, a2))
