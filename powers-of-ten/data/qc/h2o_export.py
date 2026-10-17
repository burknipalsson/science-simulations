# Export the CCSD/aug-cc-pVDZ natural orbitals of water for the page (h2o.py has the validation runs).
# Basis functions: libcint-normalised contractions, real solid harmonics (s, p: x y z; d: xy yz z2 xz x2-y2).
import json, numpy as np
from pyscf import gto, scf, cc
r, th = 0.9572, np.radians(104.52)
geom = f"O 0 0 0; H {r*np.sin(th/2)} 0 {r*np.cos(th/2)}; H {-r*np.sin(th/2)} 0 {r*np.cos(th/2)}"
mol = gto.M(atom=geom, basis='aug-cc-pvdz', unit='Angstrom', verbose=0)
mf = scf.RHF(mol).run(); mc = cc.CCSD(mf).run()
occ, U = np.linalg.eigh(mc.make_rdm1()); idx = np.argsort(-occ); occ, U = occ[idx], U[:, idx]
C = mf.mo_coeff @ U; keep = occ > 2e-3
shells = []
for b in range(mol.nbas):
    cs = mol._libcint_ctr_coeff(b)
    for k in range(cs.shape[1]):
        shells.append(dict(atom=int(mol.bas_atom(b)), l=int(mol.bas_angular(b)), exp=mol.bas_exp(b).tolist(), coef=cs[:, k].tolist()))
rng = np.random.default_rng(1); pts = rng.normal(size=(40, 3)) * 1.5
pts = np.vstack([pts, mol.atom_coords()[1] + [0.02, 0, 0], mol.atom_coords()[0] + [0, 0.05, 0]])
ao = mol.eval_gto('GTOval_sph', pts); dm = C[:, keep] @ np.diag(occ[keep]) @ C[:, keep].T
rho = np.einsum('pi,ij,pj->p', ao, dm, ao)
json.dump(dict(atoms=mol.atom_coords().tolist(), shells=shells, occ=occ[keep].tolist(), C=C[:, keep].T.tolist(), E_ccsd=mc.e_tot,
               test=dict(pts=pts.tolist(), rho=rho.tolist())), open('h2o_no.json', 'w'))
print('kept', keep.sum(), 'NOs,', occ[keep].sum(), 'electrons; E_CCSD', mc.e_tot)
