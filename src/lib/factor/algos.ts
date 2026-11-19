// Hot numeric loops index arrays by construction-guaranteed bounds; strict index checks are disabled here only.
// @ts-nocheck
import {
  type Clock,
  bitLength,
  gcd,
  isqrt,
  legendre,
  log2Big,
  modInv,
  modPow,
  primesUpTo,
  tonelliShanks,
} from "./bigmath";

/* ------------------------------------------------------------------ */
/* Trial division + perfect-power check                                */
/* ------------------------------------------------------------------ */
export function trialDivision(n: bigint, limit: number): bigint | null {
  const r = isqrt(n);
  if (r * r === n) return r;
  for (const p of primesUpTo(limit)) {
    const P = BigInt(p);
    if (P * P > n) break;
    if (n % P === 0n) return P;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Pollard rho (Floyd cycle, batched gcd, resumable)                   */
/* ------------------------------------------------------------------ */
export interface RhoState {
  c: bigint;
  x: bigint; // Brent: saved point at the last power of two
  y: bigint; // Brent: running point
  iters: number;
  r?: number; // current power-of-two window
  k?: number; // steps taken inside the window
}
export const rhoInitial = (): RhoState => ({ c: 1n, x: 2n, y: 2n, iters: 0, r: 1, k: 0 });

/** Pollard rho with Brent's cycle detection (ZF-16.1): one f() per step instead of three, batched gcd. */
export function pollardRho(
  n: bigint,
  state: RhoState,
  maxIters: number,
  expired: Clock,
): { factor: bigint | null; state: RhoState } {
  let { c, x, y, iters } = state;
  let r = state.r ?? 1;
  let k = state.k ?? 0;
  const startIters = iters;
  const f = (v: bigint) => (v * v + c) % n;
  while (iters - startIters < maxIters) {
    if (expired()) break;
    const ys = y;
    const ks = k;
    const m = Math.min(128, r - k);
    let q = 1n;
    for (let i = 0; i < m; i++) {
      y = f(y);
      q = (q * (x > y ? x - y : y - x)) % n;
    }
    iters += m;
    k += m;
    let g = gcd(q, n);
    if (g !== 1n) {
      let z = ys;
      for (let i = 0; i < m; i++) {
        z = f(z);
        g = gcd(x > z ? x - z : z - x, n);
        if (g !== 1n) break;
      }
      if (g !== n && g !== 1n) return { factor: g, state: { c, x, y, iters, r, k } };
      c += 1n;
      x = 2n;
      y = 2n;
      r = 1;
      k = 0;
      continue;
    }
    if (k >= r) {
      x = y;
      r *= 2;
      k = 0;
    }
    void ks;
  }
  return { factor: null, state: { c, x, y, iters, r, k } };
}

/* ------------------------------------------------------------------ */
/* Pollard p-1                                                         */
/* ------------------------------------------------------------------ */
export function pollardPm1(
  n: bigint,
  B1: number,
  expired: Clock,
): { factor: bigint | null; completed: boolean } {
  let a = 2n;
  const primes = primesUpTo(B1);
  let count = 0;
  for (const p of primes) {
    let pe = p;
    while (pe * p <= B1) pe *= p;
    a = modPow(a, BigInt(pe), n);
    if (++count % 256 === 0) {
      const g = gcd(a - 1n, n);
      if (g > 1n) return g < n ? { factor: g, completed: true } : { factor: null, completed: true };
      if (expired()) return { factor: null, completed: false };
    }
  }
  const g = gcd(a - 1n, n);
  if (g > 1n && g < n) return { factor: g, completed: true };
  return { factor: null, completed: true };
}

/* ------------------------------------------------------------------ */
/* ECM: Montgomery curves, Suyama parametrisation, BSGS stage 2        */
/* ------------------------------------------------------------------ */
interface Pt {
  x: bigint;
  z: bigint;
}

const primeFlags = new Map<number, Uint8Array>();
function primeFlagTable(limit: number): Uint8Array {
  const hit = primeFlags.get(limit);
  if (hit) return hit;
  const isP = new Uint8Array(limit + 1);
  for (const p of primesUpTo(limit)) isP[p] = 1;
  if (primeFlags.size > 3) primeFlags.clear();
  primeFlags.set(limit, isP);
  return isP;
}

const W = 210;
const BABY: number[] = [];
for (let j = 1; j < W / 2; j++) if (gcd(BigInt(j), BigInt(W)) === 1n) BABY.push(j);

export function ecmCurve(n: bigint, sigma: bigint, B1: number, B2: number): bigint | null {
  const mul = (a: bigint, b: bigint) => (a * b) % n;
  const sub = (a: bigint, b: bigint) => {
    const r = a - b;
    return r < 0n ? r + n : r;
  };
  const add = (a: bigint, b: bigint) => {
    const r = a + b;
    return r >= n ? r - n : r;
  };

  const u = sub(mul(sigma, sigma), 5n);
  const v = mul(4n, sigma);
  const u3 = mul(mul(u, u), u);
  const v3 = mul(mul(v, v), v);
  const den = mul(16n, mul(u3, v));
  const inv = modInv(den, n);
  if (inv === null) {
    const g = gcd(den, n);
    return g > 1n && g < n ? g : null;
  }
  const vu = sub(v, u);
  const a24 = mul(mul(mul(vu, mul(vu, vu)), add(mul(3n, u), v)), inv);

  const dbl = (P: Pt): Pt => {
    const s = add(P.x, P.z);
    const d = sub(P.x, P.z);
    const uu = mul(s, s);
    const vv = mul(d, d);
    const t = sub(uu, vv);
    return { x: mul(uu, vv), z: mul(t, add(vv, mul(a24, t))) };
  };
  const addP = (P: Pt, Q: Pt, D: Pt): Pt => {
    const uu = mul(sub(P.x, P.z), add(Q.x, Q.z));
    const vv = mul(add(P.x, P.z), sub(Q.x, Q.z));
    const s = add(uu, vv);
    const d = sub(uu, vv);
    return { x: mul(D.z, mul(s, s)), z: mul(D.x, mul(d, d)) };
  };
  const ladder = (k: bigint, P: Pt): Pt => {
    if (k === 1n) return P;
    let R0 = P;
    let R1 = dbl(P);
    const bits = k.toString(2);
    for (let i = 1; i < bits.length; i++) {
      if (bits[i] === "1") {
        R0 = addP(R0, R1, P);
        R1 = dbl(R1);
      } else {
        R1 = addP(R0, R1, P);
        R0 = dbl(R0);
      }
    }
    return R0;
  };

  // Stage 1
  let Q: Pt = { x: u3, z: v3 };
  for (const p of primesUpTo(B1)) {
    let pe = p;
    while (pe * p <= B1) pe *= p;
    Q = ladder(BigInt(pe), Q);
  }
  let g = gcd(Q.z, n);
  if (g > 1n) return g < n ? g : null;

  // Stage 2 (baby-step giant-step on x-coordinates)
  if (B2 <= B1) return null;
  const isP = primeFlagTable(B2 + W);
  const D2 = dbl(Q);
  const T = new Map<number, Pt>();
  T.set(1, Q);
  T.set(3, addP(Q, D2, Q));
  for (let j = 5; j < W / 2; j += 2) T.set(j, addP(T.get(j - 2)!, D2, T.get(j - 4)!));
  const T210 = ladder(BigInt(W), Q);
  let k = Math.max(1, Math.floor(B1 / W));
  let Rprev = ladder(BigInt(W * (k - 1)), Q);
  let R = ladder(BigInt(W * k), Q);
  let acc = 1n;
  // k-1 == 0 gives point at infinity (z=0); only happens when B1 < 420, which we never use
  while (W * k - W / 2 <= B2) {
    for (const j of BABY) {
      const hi = W * k + j;
      const lo = W * k - j;
      const hit = (hi > B1 && hi <= B2 && isP[hi] === 1) || (lo > B1 && lo <= B2 && isP[lo] === 1);
      if (!hit) continue;
      const Tj = T.get(j);
      if (!Tj) continue;
      acc = mul(acc, sub(mul(R.x, Tj.z), mul(Tj.x, R.z)));
    }
    const Rn = addP(R, T210, Rprev);
    Rprev = R;
    R = Rn;
    k++;
  }
  g = gcd(acc, n);
  return g > 1n && g < n ? g : null;
}

export function ecmRun(
  n: bigint,
  B1: number,
  B2: number,
  sigmaStart: number,
  maxCurves: number,
  expired: Clock,
): { factor: bigint | null; curves: number; nextSigma: number } {
  let s = sigmaStart;
  let curves = 0;
  while (curves < maxCurves) {
    if (curves > 0 && expired()) break;
    const f = ecmCurve(n, BigInt(s), B1, B2);
    s++;
    curves++;
    if (f) return { factor: f, curves, nextSigma: s };
  }
  return { factor: null, curves, nextSigma: s };
}

/* ------------------------------------------------------------------ */
/* Quadratic sieve (single polynomial, log sieve on Uint8Array, GF(2)) */
/* ------------------------------------------------------------------ */
export interface QSStats {
  fbSize: number;
  bound: number;
  relations: number;
  blocks: number;
  candidates: number;
  sieveMs: number;
  laMs: number;
  dependencies: number;
}
export interface QSResult {
  factor: bigint | null;
  stats: QSStats;
  reason?: string;
}

const SEG = 1024;
const BLOCK = 1 << 15;

export function quadraticSieve(n: bigint, maxBlocks: number, expired: Clock): QSResult {
  const stats: QSStats = {
    fbSize: 0,
    bound: 0,
    relations: 0,
    blocks: 0,
    candidates: 0,
    sieveMs: 0,
    laMs: 0,
    dependencies: 0,
  };
  const t0 = performance.now();
  const bits = bitLength(n);
  const lnN = bits * Math.LN2;
  const B = Math.min(400000, Math.max(300, Math.round(Math.exp(0.5 * Math.sqrt(lnN * Math.log(lnN))))));
  stats.bound = B;

  // factor base: primes where n is a quadratic residue (halves the base)
  const fbP: number[] = [];
  const fbR: number[] = [];
  for (const p of primesUpTo(B)) {
    const P = BigInt(p);
    if (n % P === 0n) return { factor: P < n ? P : null, stats, reason: "small factor" };
    if (p === 2) {
      fbP.push(2);
      fbR.push(1);
      continue;
    }
    if (legendre(n, P) === 1) {
      fbP.push(p);
      fbR.push(Number(tonelliShanks(n, P)));
    }
  }
  const nFB = fbP.length;
  stats.fbSize = nFB;
  const logp = new Uint8Array(nFB);
  for (let i = 0; i < nFB; i++) logp[i] = Math.round(Math.log2(fbP[i]));

  const m = isqrt(n) + 1n;
  const xp = new Int32Array(nFB); // (m + block*BLOCK) mod p
  for (let i = 0; i < nFB; i++) xp[i] = Number(m % BigInt(fbP[i]));
  const step = new Int32Array(nFB);
  for (let i = 0; i < nFB; i++) step[i] = BLOCK % fbP[i];

  const need = nFB + 24;
  const relX: bigint[] = [];
  const relExp: Array<Array<[number, number]>> = [];
  const sieve = new Uint8Array(BLOCK);
  const SKIP = 16; // don't sieve tiny primes (too many hits, too little signal)
  const logB = Math.log2(B);

  for (let block = 0; block < maxBlocks && relX.length < need; block++) {
    if (block % 4 === 3 && expired()) break;
    stats.blocks++;
    sieve.fill(0);
    for (let i = 0; i < nFB; i++) {
      const p = fbP[i];
      if (p < SKIP) continue;
      const lp = logp[i];
      const xi = xp[i];
      const r1 = fbR[i];
      const r2 = p - r1;
      let s1 = r1 - xi;
      if (s1 < 0) s1 += p;
      for (let j = s1; j < BLOCK; j += p) sieve[j] += lp;
      if (r2 !== r1) {
        let s2 = r2 - xi;
        if (s2 < 0) s2 += p;
        for (let j = s2; j < BLOCK; j += p) sieve[j] += lp;
      }
    }
    const x0 = m + BigInt(block) * BigInt(BLOCK);
    for (let seg = 0; seg < BLOCK; seg += SEG) {
      const xm = x0 + BigInt(seg + SEG / 2);
      const thr = Math.floor(log2Big(xm * xm - n) - 1.6 * logB - 4);
      for (let i = seg; i < seg + SEG; i++) {
        if (sieve[i] < thr) continue;
        stats.candidates++;
        const x = x0 + BigInt(i);
        let q = x * x - n;
        const exps: Array<[number, number]> = [];
        for (let k = 0; k < nFB; k++) {
          const p = fbP[k];
          const mod = (xp[k] + i) % p;
          if (mod !== fbR[k] && mod !== (p - fbR[k]) % p) continue;
          const P = BigInt(p);
          let e = 0;
          while (q % P === 0n) {
            q /= P;
            e++;
          }
          if (e) exps.push([k, e]);
        }
        if (q === 1n) {
          if (relX.length && relX[relX.length - 1] === x) continue;
          relX.push(x);
          relExp.push(exps);
          if (relX.length >= need) break;
        }
      }
      if (relX.length >= need) break;
    }
    for (let i = 0; i < nFB; i++) xp[i] = (xp[i] + step[i]) % fbP[i];
  }
  stats.relations = relX.length;
  stats.sieveMs = performance.now() - t0;
  if (relX.length < nFB + 1) {
    return { factor: null, stats, reason: "not enough relations before the budget ran out" };
  }

  // Linear algebra over GF(2): incremental elimination with history bits
  const t1 = performance.now();
  const nRel = relX.length;
  const words = (nFB + nRel + 31) >>> 5;
  const lastW = (nFB - 1) >>> 5;
  const lastMask = nFB % 32 === 0 ? 0xffffffff : ((1 << nFB % 32) >>> 0) - 1;
  const pivots: Array<Uint32Array | undefined> = new Array(nFB);
  for (let i = 0; i < nRel; i++) {
    const row = new Uint32Array(words);
    for (const [k, e] of relExp[i]) if (e & 1) row[k >>> 5] ^= 1 << (k & 31);
    const hb = nFB + i;
    row[hb >>> 5] |= 1 << (hb & 31);
    for (;;) {
      let bit = -1;
      for (let w = 0; w <= lastW; w++) {
        const val = w === lastW ? row[w] & lastMask : row[w];
        if (val !== 0) {
          bit = (w << 5) + (31 - Math.clz32(val & -val));
          break;
        }
      }
      if (bit < 0) {
        // dependency found
        stats.dependencies++;
        const subset: number[] = [];
        for (let r = 0; r < nRel; r++) {
          const hbit = nFB + r;
          if (row[hbit >>> 5] & (1 << (hbit & 31))) subset.push(r);
        }
        let X = 1n;
        const tot = new Int32Array(nFB);
        for (const r of subset) {
          X = (X * relX[r]) % n;
          for (const [k, e] of relExp[r]) tot[k] += e;
        }
        let Y = 1n;
        for (let k = 0; k < nFB; k++) if (tot[k]) Y = (Y * modPow(BigInt(fbP[k]), BigInt(tot[k] >> 1), n)) % n;
        const g = gcd(X - Y, n);
        if (g > 1n && g < n) {
          stats.laMs = performance.now() - t1;
          return { factor: g, stats };
        }
        break;
      }
      const piv = pivots[bit];
      if (!piv) {
        pivots[bit] = row;
        break;
      }
      for (let w = 0; w < words; w++) row[w] ^= piv[w];
    }
  }
  stats.laMs = performance.now() - t1;
  return { factor: null, stats, reason: "all dependencies were trivial" };
}
