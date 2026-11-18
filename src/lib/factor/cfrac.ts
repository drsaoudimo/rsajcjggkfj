// CFRAC (Morrison–Brillhart): A_{k}^2 ≡ (−1)^{k+1} Q_{k+1} (mod N), |Q| < 2√N.
import { bitLength, gcd, isqrt, legendre, modPow, primesUpTo } from "./bigmath";

export interface CfracStats {
  fbSize: number;
  bound: number;
  steps: number;
  relations: number;
  sieveMs: number;
  laMs: number;
  dependencies: number;
}

export function cfrac(n: bigint, expired: () => boolean): { factor: bigint | null; stats: CfracStats; reason?: string } {
  const t0 = performance.now();
  const lnN = bitLength(n) * Math.LN2;
  const B = Math.min(300000, Math.max(200, Math.round(0.7 * Math.exp(0.5 * Math.sqrt(lnN * Math.log(lnN))))));
  const stats: CfracStats = { fbSize: 0, bound: B, steps: 0, relations: 0, sieveMs: 0, laMs: 0, dependencies: 0 };
  const r0 = isqrt(n);
  if (r0 * r0 === n) return { factor: r0, stats };
  // factor base: index 0 is the sign (−1)
  const fb: bigint[] = [-1n];
  for (const p of primesUpTo(B)) {
    const P = BigInt(p);
    if (n % P === 0n) return { factor: P, stats };
    if (p === 2 || legendre(n, P) === 1) fb.push(P);
  }
  const nFB = fb.length;
  stats.fbSize = nFB;
  const need = nFB + 16;
  const relA: bigint[] = [];
  const relE: Int32Array[] = [];

  let P = 0n, Q = 1n, a = r0;
  let Aprev = 1n, A = r0 % n; // A_{-1}=1, A_0=a0
  // Q_{k+1}
  let sign = -1; // A_0^2 − N·B_0^2 = −Q_1
  for (;;) {
    if (relA.length >= need) break;
    if ((stats.steps & 1023) === 0 && expired()) break;
    stats.steps++;
    P = a * Q - P;
    Q = (n - P * P) / Q;
    // A_k^2 ≡ sign·Q (mod N) where A is the current convergent numerator
    let q = Q;
    const e = new Int32Array(nFB);
    if (sign < 0) e[0] = 1;
    for (let i = 1; i < nFB && q > 1n; i++) {
      const p = fb[i]!;
      while (q % p === 0n) { q /= p; e[i]++; }
    }
    if (q === 1n) { relA.push(A); relE.push(e); }
    a = (r0 + P) / Q;
    const An = (a * A + Aprev) % n;
    Aprev = A;
    A = An;
    sign = -sign;
    if (Q === 1n && sign > 0) break; // period end
  }
  stats.relations = relA.length;
  stats.sieveMs = performance.now() - t0;
  if (relA.length < 2) return { factor: null, stats, reason: "not enough relations" };

  const t1 = performance.now();
  const nRel = relA.length;
  const words = (nFB + nRel + 31) >>> 5;
  const pivots: Array<Uint32Array | undefined> = new Array(nFB);
  for (let i = 0; i < nRel; i++) {
    const row = new Uint32Array(words);
    const e = relE[i]!;
    for (let k = 0; k < nFB; k++) if (e[k]! & 1) row[k >>> 5]! ^= 1 << (k & 31);
    const hb = nFB + i;
    row[hb >>> 5]! |= 1 << (hb & 31);
    for (;;) {
      let bit = -1;
      for (let k = 0; k < nFB; k++) if (row[k >>> 5]! & (1 << (k & 31))) { bit = k; break; }
      if (bit < 0) {
        stats.dependencies++;
        let Xv = 1n;
        const tot = new Int32Array(nFB);
        for (let r = 0; r < nRel; r++) {
          const h = nFB + r;
          if (row[h >>> 5]! & (1 << (h & 31))) {
            Xv = (Xv * relA[r]!) % n;
            for (let k = 0; k < nFB; k++) tot[k] += relE[r]![k]!;
          }
        }
        let Y = 1n;
        for (let k = 1; k < nFB; k++) if (tot[k]) Y = (Y * modPow(fb[k]!, BigInt(tot[k]! >> 1), n)) % n;
        const g = gcd(Xv - Y, n);
        if (g > 1n && g < n) { stats.laMs = performance.now() - t1; return { factor: g, stats }; }
        break;
      }
      const piv = pivots[bit];
      if (!piv) { pivots[bit] = row; break; }
      for (let w = 0; w < words; w++) row[w]! ^= piv[w]!;
    }
  }
  stats.laMs = performance.now() - t1;
  return { factor: null, stats, reason: "all dependencies were trivial" };
}
