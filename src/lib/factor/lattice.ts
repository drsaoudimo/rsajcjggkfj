// Coppersmith / Howgrave-Graham: recover p from its known high bits via exact integer LLL.
import { bitLength, gcd } from "./bigmath";

const abs = (a: bigint) => (a < 0n ? -a : a);
const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
};
const roundDiv = (a: bigint, b: bigint) => floorDiv(2n * a + b, 2n * b); // b > 0
const dot = (u: bigint[], v: bigint[]) => {
  let s = 0n;
  for (let i = 0; i < u.length; i++) s += u[i]! * v[i]!;
  return s;
};

/** Exact integer LLL (Cohen, Alg. 2.6.7), δ = 3/4. Rows of `basis` are reduced in place. */
export function lll(basis: bigint[][]): { basis: bigint[][]; swaps: number } {
  const n = basis.length;
  const b = [null as unknown as bigint[], ...basis.map((r) => r.slice())]; // 1-based
  const d: bigint[] = new Array(n + 1).fill(0n);
  const L: bigint[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0n));
  d[0] = 1n;
  d[1] = dot(b[1]!, b[1]!);
  let k = 2;
  let kmax = 1;
  let swaps = 0;
  const red = (k: number, l: number) => {
    if (abs(2n * L[k]![l]!) > d[l]!) {
      const q = roundDiv(L[k]![l]!, d[l]!);
      const bk = b[k]!, bl = b[l]!;
      for (let i = 0; i < bk.length; i++) bk[i] = bk[i]! - q * bl[i]!;
      L[k]![l] = L[k]![l]! - q * d[l]!;
      for (let i = 1; i < l; i++) L[k]![i] = L[k]![i]! - q * L[l]![i]!;
    }
  };
  const swap = (k: number) => {
    [b[k], b[k - 1]] = [b[k - 1]!, b[k]!];
    for (let j = 1; j <= k - 2; j++) [L[k]![j], L[k - 1]![j]] = [L[k - 1]![j]!, L[k]![j]!];
    const lam = L[k]![k - 1]!;
    const B = (d[k - 2]! * d[k]! + lam * lam) / d[k - 1]!;
    for (let i = k + 1; i <= kmax; i++) {
      const t = L[i]![k]!;
      L[i]![k] = (d[k]! * L[i]![k - 1]! - lam * t) / d[k - 1]!;
      L[i]![k - 1] = (B * t + lam * L[i]![k]!) / d[k]!;
    }
    d[k - 1] = B;
    swaps++;
  };
  while (k <= n) {
    if (k > kmax) {
      kmax = k;
      for (let j = 1; j <= k; j++) {
        let u = dot(b[k]!, b[j]!);
        for (let i = 1; i < j; i++) u = (d[i]! * u - L[k]![i]! * L[j]![i]!) / d[i - 1]!;
        if (j < k) L[k]![j] = u;
        else d[k] = u;
      }
    }
    for (;;) {
      red(k, k - 1);
      const lhs = 4n * d[k]! * d[k - 2]!;
      const rhs = 3n * d[k - 1]! * d[k - 1]! - 4n * L[k]![k - 1]! * L[k]![k - 1]!;
      if (lhs < rhs) {
        swap(k);
        k = Math.max(2, k - 1);
        continue;
      }
      break;
    }
    for (let l = k - 2; l >= 1; l--) red(k, l);
    k++;
  }
  return { basis: b.slice(1) as bigint[][], swaps };
}

/* ---------- integer polynomials (coefficients low → high) ---------- */
const evalP = (c: bigint[], x: bigint) => {
  let r = 0n;
  for (let i = c.length - 1; i >= 0; i--) r = r * x + c[i]!;
  return r;
};
const deriv = (c: bigint[]) => c.slice(1).map((v, i) => v * BigInt(i + 1));
const sgn = (v: bigint) => (v > 0n ? 1 : v < 0n ? -1 : 0);
const trim = (c: bigint[]) => {
  const r = c.slice();
  while (r.length > 1 && r[r.length - 1] === 0n) r.pop();
  return r;
};

/** Integer points in [lo, hi] where the polynomial changes sign or vanishes (all integer roots included). */
function signPoints(c: bigint[], lo: bigint, hi: bigint): bigint[] {
  c = trim(c);
  if (c.length <= 1) return [];
  const cuts = [lo];
  if (c.length > 2) for (const r of signPoints(deriv(c), lo, hi)) cuts.push(r, r + 1n);
  cuts.push(hi);
  cuts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: bigint[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    let a = cuts[i]!, z = cuts[i + 1]!;
    if (a > z || a < lo || z > hi) continue;
    const fa = evalP(c, a), fz = evalP(c, z);
    if (fa === 0n) { out.push(a); continue; }
    if (fz === 0n) { out.push(z); continue; }
    if (sgn(fa) === sgn(fz)) continue;
    while (z - a > 1n) {
      const mid = (a + z) / 2n;
      const fm = evalP(c, mid);
      if (fm === 0n) { a = z = mid; break; }
      if (sgn(fm) === sgn(fa)) a = mid; else z = mid;
    }
    out.push(a);
  }
  return out;
}

export interface CopperStats {
  m: number;
  dim: number;
  unknownBits: number;
  knownBits: number;
  lllMs: number;
  swaps: number;
  tried: number[];
}

/**
 * Given N and `high` = p with its low `unknownBits` bits zeroed, find p.
 * Lattice from f(x) = x + high:  N^(m−i)·f^i (i<m)  and  x^j·f^m (j<t), evaluated at xX.
 */
export function coppersmithHighBits(
  n: bigint,
  high: bigint,
  unknownBits: number,
  expired: () => boolean,
): { factor: bigint | null; stats: CopperStats } {
  const X = 1n << BigInt(unknownBits);
  const stats: CopperStats = { m: 0, dim: 0, unknownBits, knownBits: bitLength(high) - unknownBits, lllMs: 0, swaps: 0, tried: [] };
  // f^i coefficients
  const fpow: bigint[][] = [[1n]];
  for (let i = 1; i <= 12; i++) {
    const prev = fpow[i - 1]!;
    const next = new Array(prev.length + 1).fill(0n);
    for (let j = 0; j < prev.length; j++) {
      next[j] += prev[j]! * high;
      next[j + 1] += prev[j]!;
    }
    fpow.push(next);
  }
  for (const m of [1, 2, 3, 4, 5, 6]) {
    if (stats.tried.length && expired()) break;
    stats.tried.push(m);
    const t = m;
    const dim = m + t;
    const rows: bigint[][] = [];
    for (let i = 0; i < m; i++) {
      const c = fpow[i]!.map((v) => v * n ** BigInt(m - i));
      rows.push(Array.from({ length: dim }, (_, j) => (j < c.length ? c[j]! * X ** BigInt(j) : 0n)));
    }
    for (let j = 0; j < t; j++) {
      const c = [...new Array(j).fill(0n), ...fpow[m]!];
      rows.push(Array.from({ length: dim }, (_, k) => (k < c.length ? c[k]! * X ** BigInt(k) : 0n)));
    }
    const t0 = performance.now();
    const red = lll(rows);
    stats.lllMs += performance.now() - t0;
    stats.swaps += red.swaps;
    stats.m = m;
    stats.dim = dim;
    for (const v of red.basis.slice(0, 3)) {
      const poly = v.map((c, k) => c / X ** BigInt(k));
      for (const r of signPoints(poly, 0n, X)) {
        for (const x0 of [r, r + 1n]) {
          const p = high + x0;
          if (p > 1n && p < n && n % p === 0n) return { factor: p, stats };
        }
        const g = gcd(high + r, n);
        if (g > 1n && g < n) return { factor: g, stats };
      }
    }
  }
  return { factor: null, stats };
}
