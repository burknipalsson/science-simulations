// shape measures of a closed triangulated surface: centroid, volume, equivalent-ellipsoid semi-axes and axes
function jacobiEig(A) {
  const a = A.map(r => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { val: [a[0][0], a[1][1], a[2][2]], vec: [0, 1, 2].map(j => [V[0][j], V[1][j], V[2][j]]) };
}
function ellipsoid(X, F) {
  const n = X.length, c = [0, 0, 0];
  for (const p of X) for (let d = 0; d < 3; d++) c[d] += p[d] / n;
  let vol = 0; const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], m = [0, 0, 0];
  for (const t of F) {
    const p = t.map(i => [X[i][0] - c[0], X[i][1] - c[1], X[i][2] - c[2]]);
    const v = (p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0])) / 6;
    vol += v; const s = [0, 1, 2].map(d => p[0][d] + p[1][d] + p[2][d]);
    for (let d = 0; d < 3; d++) m[d] += v * s[d] / 4;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += v / 20 * (p[0][i] * p[0][j] + p[1][i] * p[1][j] + p[2][i] * p[2][j] + s[i] * s[j]);
  }
  const cm = m.map(x => x / vol); // true centroid offset
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] -= vol * cm[i] * cm[j];
  const e = jacobiEig(S), ax = e.val.map(l => Math.sqrt(5 * Math.max(l, 0) / vol));
  const ord = [0, 1, 2].sort((a, b) => ax[b] - ax[a]);
  return { centre: c.map((x, d) => x + cm[d]), vol, axes: ord.map(i => ax[i]), dirs: ord.map(i => e.vec[i]) };
}
if (typeof module !== 'undefined') module.exports = { ellipsoid, jacobiEig };
