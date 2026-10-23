// Small dense linear algebra for correlation matrices (n ≈ 9).

export function cholesky(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 1e-12) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Jacobi eigen-decomposition of a symmetric matrix. Returns eigenvalues and eigenvectors (columns). */
export function jacobiEigen(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const n = Ain.length;
  const A = Ain.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/** Nearest valid correlation matrix by eigenvalue clipping + unit-diagonal rescaling. */
export function repairCorrelation(C: number[][], floor = 1e-4): number[][] {
  const n = C.length;
  const sym = C.map((r, i) => r.map((v, j) => (i === j ? 1 : (v + C[j][i]) / 2)));
  const { values, vectors } = jacobiEigen(sym);
  const clipped = values.map((v) => Math.max(v, floor));
  const B: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += vectors[i][k] * clipped[k] * vectors[j][k];
      B[i][j] = s;
    }
  const d = B.map((r, i) => Math.sqrt(Math.max(r[i], 1e-12)));
  return B.map((r, i) => r.map((v, j) => (i === j ? 1 : v / (d[i] * d[j]))));
}

/** Cholesky with automatic repair. `repaired` tells the caller whether the matrix was adjusted. */
export function safeCholesky(C: number[][]): { L: number[][]; repaired: boolean; matrix: number[][] } {
  const L = cholesky(C);
  if (L) return { L, repaired: false, matrix: C };
  const fixed = repairCorrelation(C);
  const L2 = cholesky(fixed) ?? cholesky(repairCorrelation(fixed, 1e-3));
  if (!L2) {
    const n = C.length;
    const I = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    return { L: I, repaired: true, matrix: I };
  }
  return { L: L2, repaired: true, matrix: fixed };
}

export function matVec(M: number[][], v: number[]): number[] {
  return M.map((r) => r.reduce((s, x, i) => s + x * v[i], 0));
}

export function quadForm(w: number[], S: number[][]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) s += w[i] * S[i][j] * w[j];
  return s;
}

export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function sortedCopy(a: ArrayLike<number>): Float64Array {
  const c = Float64Array.from(a as ArrayLike<number>);
  c.sort();
  return c;
}

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : 0;
}

export function stdev(a: ArrayLike<number>): number {
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
  return a.length > 1 ? Math.sqrt(s / (a.length - 1)) : 0;
}
