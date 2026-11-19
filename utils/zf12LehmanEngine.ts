/**
 * ZF-12: Incremental Exact Outer Root Engine for Lehman Factorization
 * Full-Domain Equivalence Audit Edition:
 * - Pure BigInt arithmetic (zero unsafe Number conversions for N or intermediate targets)
 * - Uncapped full-domain verification (1 <= k <= floor(cbrt(N)))
 * - Runtime prevSq === prev * prev invariant verification support
 * - Full accounting of BigInt ops (including gcd modulo steps & icbrt multiplications)
 * - Returns 'Inconclusive' rather than asserting primality from loop exhaustion alone
 */

export interface ZF12Stats {
  isqrtCalls: number;
  isqrtInner: number;
  newtonSteps: number;
  corrSteps: number;
  bigDivs: number;
  bigMods: number;
  bigMuls: number;
  bigCmps: number;
  gcds: number;
  cand: number;
  s1: number;
  s2: number;
}

export type FactorizationPhase =
  | 'Even'
  | 'Phase0'
  | 'Phase1'
  | 'Phase2'
  | 'Phase2+'
  | 'Inconclusive';

export interface ZF12SolverResult {
  algorithm: string;
  n: bigint;
  factor: bigint;
  verifiedFactor: boolean;
  phase: FactorizationPhase;
  ms: number;
  stats: ZF12Stats;
}

export interface ZF12BenchmarkRow {
  n: bigint;
  classification: string;
  original: ZF12SolverResult;
  zf9: ZF12SolverResult;
  zf12Newton: ZF12SolverResult;
  zf12Ineq: ZF12SolverResult;
  speedupIneqVsZF9Pct: number;
  speedupIneqVsOrigPct: number;
}

export interface BoundaryAuditSummary {
  testedEdgeTriples: number;
  testedUnderTargetCases: number;
  passed: boolean;
}

export interface FullDomainAuditSummary {
  n: bigint;
  cbrtN: bigint;
  checkedK: bigint;
  checkedCandidates: bigint;
  maxStepDelta: bigint;
  fastPathHits: bigint;
  fallbackHits: bigint;
  passed: boolean;
}

export const MANDATORY_ZF12_TEST_CASES: readonly bigint[] = [
  35n,
  77n,
  143n,
  221n,
  437n,
  10403n,
  100160063n,
  100140049n,
  1048023103n,
  1009003027n,
  1000700070049n,
  100003000700021n,
  1000000007n,
  30010057019n,
];

function createEmptyStats(): ZF12Stats {
  return {
    isqrtCalls: 0,
    isqrtInner: 0,
    newtonSteps: 0,
    corrSteps: 0,
    bigDivs: 0,
    bigMods: 0,
    bigMuls: 0,
    bigCmps: 0,
    gcds: 0,
    cand: 0,
    s1: 0,
    s2: 0,
  };
}

/** Exact BigInt bit-length without floating-point Number conversion */
export function bigIntBitLength(n: bigint): number {
  if (n <= 0n) return 0;
  let bits = 0;
  let t = n;
  while (t > 0n) {
    t >>= 1n;
    bits++;
  }
  return bits;
}

/** Exact reference floor(sqrt(n)) using bit-length initial bound */
export function isqrtRef(n: bigint, st?: ZF12Stats): bigint {
  if (n < 0n) throw new RangeError('Square root of negative BigInt is undefined');
  if (n < 2n) return n;
  if (st) st.isqrtCalls++;
  let x = 1n << BigInt((bigIntBitLength(n) + 1) >> 1);
  while (true) {
    if (st) {
      st.newtonSteps++;
      st.bigDivs++;
      st.bigCmps++;
    }
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x;
}

/** Exact reference ceil(sqrt(n)) */
export function ceilSqrtRef(n: bigint, st?: ZF12Stats): bigint {
  const r = isqrtRef(n, st);
  if (st) {
    st.bigMuls++;
    st.bigCmps++;
  }
  return r * r === n ? r : r + 1n;
}

/** Exact floor(cbrt(n)) via binary search in BigInt */
export function icbrtFloor(n: bigint, st?: ZF12Stats): bigint {
  if (n < 0n) throw new RangeError('Negative BigInt');
  if (n < 2n) return n;
  let low = 1n;
  let high = n;
  while (low <= high) {
    const mid = (low + high) >> 1n;
    if (st) {
      st.bigMuls += 2;
      st.bigCmps += 2;
    }
    const c = mid * mid * mid;
    if (c === n) return mid;
    if (c < n) low = mid + 1n;
    else high = mid - 1n;
  }
  return high;
}

export function bigIntGcd(a: bigint, b: bigint, st?: ZF12Stats): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    if (st) st.bigMods++;
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/**
 * Independent classification helper (used strictly for test-case labeling and post-validation,
 * never passed into factorization solvers).
 */
export function classifyInteger(n: bigint): string {
  if (n < 2n) return 'Unit';
  if (n % 2n === 0n) return n === 2n ? 'Prime' : `EvenComposite(2*${n / 2n})`;
  for (let d = 3n; d * d <= n; d += 2n) {
    if (n % d === 0n) {
      const q = n / d;
      if (d === q) return `SquareSemiprime(${d}^2)`;
      let qPrime = true;
      for (let e = 3n; e * e <= q; e += 2n) {
        if (q % e === 0n) {
          qPrime = false;
          break;
        }
      }
      return qPrime ? `Semiprime(${d}*${q})` : `Composite(${d}*${q})`;
    }
  }
  return 'Prime';
}

/**
 * ZF-12 Method B (Fixed): Incremental Newton warm-start from previous <= sqrt(target).
 * Performs a mandatory upward Newton step first so starting below sqrt(target)
 * immediately jumps >= floor(sqrt(target)) before descending.
 */
export function nextCeilSqrtNewton(
  previous: bigint,
  target: bigint,
  st?: ZF12Stats
): { root: bigint; sq: bigint } {
  if (target < 0n) throw new RangeError('Negative target');
  if (target === 0n) return { root: 0n, sq: 0n };

  let x = previous > 0n ? previous : 1n;
  if (st) {
    st.newtonSteps++;
    st.bigDivs++;
    st.bigCmps++;
  }
  let y = (x + target / x) >> 1n;

  if (y > x) {
    x = y;
    while (true) {
      if (st) {
        st.newtonSteps++;
        st.bigDivs++;
        st.bigCmps++;
      }
      y = (x + target / x) >> 1n;
      if (y >= x) break;
      x = y;
    }
  } else {
    while (y < x) {
      x = y;
      if (st) {
        st.newtonSteps++;
        st.bigDivs++;
        st.bigCmps++;
      }
      y = (x + target / x) >> 1n;
    }
  }

  if (st) {
    st.bigMuls++;
    st.bigCmps++;
  }
  let sq = x * x;
  while (sq < target) {
    if (st) {
      st.corrSteps++;
      st.bigMuls++;
      st.bigCmps++;
    }
    x++;
    sq = x * x;
  }
  while (x > 0n) {
    const xm1 = x - 1n;
    if (st) {
      st.bigMuls++;
      st.bigCmps++;
    }
    const sqPrev = xm1 * xm1;
    if (sqPrev >= target) {
      if (st) st.corrSteps++;
      x = xm1;
      sq = sqPrev;
    } else {
      break;
    }
  }

  return { root: x, sq };
}

/**
 * ZF-12 Method C: Exact Inequality Incremental Engine.
 * Given prev^2 = prevSq >= X_{k-1} and target = X_k:
 * If target <= prevSq (and (prev-1)^2 < target), root remains prev.
 * Otherwise let delta = target - prevSq, r = floor(delta / (2 * prev)), x = prev + r.
 * - Case 1 (r^2 < 2*prev): x^2 - target = r^2 - u in [-2*prev+1, 2*prev-1],
 *   so ceil(sqrt(target)) is guaranteed to be either x (if x^2 >= target) or x + 1 (if x^2 < target).
 * - Case 2 (r^2 >= 2*prev): x^2 - target = r^2 - u > 0, so x >= ceil(sqrt(target))
 *   is a guaranteed upper starting point for descending Newton + exact boundary correction.
 */
export function nextCeilSqrtInequality(
  prev: bigint,
  prevSq: bigint,
  target: bigint,
  st?: ZF12Stats
): { root: bigint; sq: bigint; usedFastPath?: boolean } {
  if (target < 0n) throw new RangeError('Negative target');
  if (target === 0n) return { root: 0n, sq: 0n, usedFastPath: true };
  if (target <= prevSq) {
    // Handle edge case 4kN <= prevSq safely even if prev > ceilSqrt(target)
    if (prev <= 1n) return { root: 1n, sq: 1n, usedFastPath: true };
    const pm1 = prev - 1n;
    if (st) {
      st.bigMuls++;
      st.bigCmps++;
    }
    if (pm1 * pm1 < target) {
      return { root: prev, sq: prevSq, usedFastPath: true };
    }
    let x = prev;
    while (true) {
      if (st) {
        st.newtonSteps++;
        st.bigDivs++;
        st.bigCmps++;
      }
      const y = (x + target / x) >> 1n;
      if (y >= x) break;
      x = y;
    }
    if (st) {
      st.bigMuls++;
      st.bigCmps++;
    }
    let sq = x * x;
    while (sq < target) {
      if (st) {
        st.corrSteps++;
        st.bigMuls++;
        st.bigCmps++;
      }
      x++;
      sq = x * x;
    }
    while (x > 0n) {
      const xm1 = x - 1n;
      if (st) {
        st.bigMuls++;
        st.bigCmps++;
      }
      const sqP = xm1 * xm1;
      if (sqP >= target) {
        if (st) st.corrSteps++;
        x = xm1;
        sq = sqP;
      } else break;
    }
    return { root: x, sq, usedFastPath: false };
  }

  const delta = target - prevSq;
  if (st) st.bigDivs++;
  const r = delta / (prev << 1n);
  let x = prev + r;

  if (st) {
    st.bigMuls++;
    st.bigCmps++;
  }
  if (r * r < (prev << 1n)) {
    if (st) {
      st.bigMuls++;
      st.bigCmps++;
    }
    const sq = x * x;
    if (sq >= target) {
      return { root: x, sq, usedFastPath: true };
    }
    if (st) st.corrSteps++;
    return { root: x + 1n, sq: sq + (x << 1n) + 1n, usedFastPath: true };
  }

  // Case 2: r^2 >= 2*prev => x^2 >= target, descend via Newton
  while (true) {
    if (st) {
      st.newtonSteps++;
      st.bigDivs++;
      st.bigCmps++;
    }
    const y = (x + target / x) >> 1n;
    if (y >= x) break;
    x = y;
  }

  if (st) {
    st.bigMuls++;
    st.bigCmps++;
  }
  let sq = x * x;
  while (sq < target) {
    if (st) {
      st.corrSteps++;
      st.bigMuls++;
      st.bigCmps++;
    }
    x++;
    sq = x * x;
  }
  while (x > 0n) {
    const xm1 = x - 1n;
    if (st) {
      st.bigMuls++;
      st.bigCmps++;
    }
    const sqPrev = xm1 * xm1;
    if (sqPrev >= target) {
      if (st) st.corrSteps++;
      x = xm1;
      sq = sqPrev;
    } else {
      break;
    }
  }
  return { root: x, sq, usedFastPath: false };
}

function buildQR(m: number): Uint8Array {
  const arr = new Uint8Array(m);
  for (let x = 0; x < m; x++) arr[(x * x) % m] = 1;
  return arr;
}

const tInitStart = performance.now();
const QR64 = buildQR(64);
const QR9 = buildQR(9);
const QR5 = buildQR(5);
const QR7 = buildQR(7);
const QR11 = buildQR(11);
const QR13 = buildQR(13);
const QR17 = buildQR(17);
const M2 = 765765n; // 9 * 5 * 7 * 11 * 13 * 17
const SMALL_ODD_MODULI = [3n, 5n, 7n, 11n, 13n, 17n];

const REJ64 = (() => {
  const rej = new Float64Array(64);
  for (let c = 0; c < 64; c++) {
    let pass = 0;
    for (let x = 0; x < 64; x++) if (QR64[((x * x - c) % 64 + 64) % 64]) pass++;
    rej[c] = 1 - pass / 64;
  }
  return rej;
})();
export const ZF9_ZF12_INIT_MS = Number((performance.now() - tInitStart).toFixed(3));

const tZF11InitStart = performance.now();
const QR_M2 = (() => {
  const table = new Uint8Array(765765);
  for (let r = 0; r < 765765; r++) {
    if (QR9[r % 9] && QR5[r % 5] && QR7[r % 7] && QR11[r % 11] && QR13[r % 13] && QR17[r % 17]) {
      table[r] = 1;
    }
  }
  return table;
})();
export const ZF11_INIT_MS = Number((performance.now() - tZF11InitStart).toFixed(3));

function verifyExtractedFactor(n: bigint, factor: bigint, phase: FactorizationPhase): boolean {
  if (phase === 'Inconclusive') return factor === 1n;
  return factor > 1n && factor < n && n % factor === 0n;
}

/** Reference Version A: Original Lehman (1974) */
export function lehmanOriginal(N: bigint): ZF12SolverResult {
  const t0 = performance.now();
  const st = createEmptyStats();
  const makeRes = (factor: bigint, phase: FactorizationPhase): ZF12SolverResult => ({
    algorithm: 'Lehman Original',
    n: N,
    factor,
    verifiedFactor: verifyExtractedFactor(N, factor, phase),
    phase,
    ms: performance.now() - t0,
    stats: st,
  });

  st.bigMods++;
  if (N % 2n === 0n) return makeRes(2n, 'Even');

  const cbrtN = icbrtFloor(N, st);
  for (let d = 3n; d <= cbrtN; d += 2n) {
    st.bigMods++;
    if (N % d === 0n) return makeRes(d, 'Phase1');
  }

  const root6N = isqrtRef(cbrtN, st);
  const fourN = 4n * N;
  st.bigMuls++;

  for (let k = 1n; k <= cbrtN; k++) {
    const fourKN = k * fourN;
    st.bigMuls++;
    const aMin = ceilSqrtRef(fourKN, st);
    const sqrtK = isqrtRef(k, st);
    st.bigDivs++;
    st.bigMuls++;
    const tMax = root6N / (4n * sqrtK) + 1n;

    for (let t = 0n; t <= tMax; t++) {
      st.cand++;
      const a = aMin + t;
      const diff = a * a - fourKN;
      st.bigMuls++;
      const b = isqrtRef(diff, st);
      st.isqrtInner++;
      st.bigMuls++;
      st.bigCmps++;
      if (b * b === diff) {
        st.gcds++;
        let g = bigIntGcd(a - b, N, st);
        if (g > 1n && g < N) return makeRes(g, 'Phase2');
        if (g === N) {
          st.gcds++;
          g = bigIntGcd(a + b, N, st);
          if (g > 1n && g < N) return makeRes(g, 'Phase2+');
        }
      }
    }
  }
  return makeRes(1n, 'Inconclusive');
}

/** Reference Version B: ZF-9 Hierarchical Fixed Filter (mod 64 + mod 765765) */
export function lehmanZF9(N: bigint): ZF12SolverResult {
  const t0 = performance.now();
  const st = createEmptyStats();
  const makeRes = (factor: bigint, phase: FactorizationPhase): ZF12SolverResult => ({
    algorithm: 'ZF-9 Hierarchical',
    n: N,
    factor,
    verifiedFactor: verifyExtractedFactor(N, factor, phase),
    phase,
    ms: performance.now() - t0,
    stats: st,
  });

  st.bigMods++;
  if (N % 2n === 0n) return makeRes(2n, 'Even');

  for (const m of SMALL_ODD_MODULI) {
    st.gcds++;
    const g = bigIntGcd(N, m, st);
    if (g > 1n && g < N) return makeRes(g, 'Phase0');
  }

  const cbrtN = icbrtFloor(N, st);
  for (let d = 3n; d <= cbrtN; d += 2n) {
    st.bigMods++;
    if (N % d === 0n) return makeRes(d, 'Phase1');
  }

  const root6N = isqrtRef(cbrtN, st);
  const fourN = 4n * N;
  st.bigMuls++;
  const nMod64 = Number(N & 63n);

  for (let k = 1n; k <= cbrtN; k++) {
    const fourKN = k * fourN;
    st.bigMuls++;
    const aMin = ceilSqrtRef(fourKN, st);
    const sqrtK = isqrtRef(k, st);
    st.bigDivs++;
    st.bigMuls++;
    const tMax = root6N / (4n * sqrtK) + 1n;

    const f64 = (4 * Number(k & 63n) * nMod64) & 63;
    let a64 = Number(aMin & 63n);

    for (let t = 0n; t <= tMax; t++) {
      st.cand++;
      const rem64 = (a64 * a64 - f64) & 63;
      a64 = (a64 + 1) & 63;
      if (QR64[rem64] === 0) continue;

      st.s1++;
      const a = aMin + t;
      const diff = a * a - fourKN;
      st.bigMuls++;
      st.bigMods++;
      const r = Number(diff % M2);
      if (
        QR9[r % 9] === 0 ||
        QR5[r % 5] === 0 ||
        QR7[r % 7] === 0 ||
        QR11[r % 11] === 0 ||
        QR13[r % 13] === 0 ||
        QR17[r % 17] === 0
      ) {
        continue;
      }

      st.s2++;
      const b = isqrtRef(diff, st);
      st.isqrtInner++;
      st.bigMuls++;
      st.bigCmps++;
      if (b * b === diff) {
        st.gcds++;
        let g = bigIntGcd(a - b, N, st);
        if (g > 1n && g < N) return makeRes(g, 'Phase2');
        if (g === N) {
          st.gcds++;
          g = bigIntGcd(a + b, N, st);
          if (g > 1n && g < N) return makeRes(g, 'Phase2+');
        }
      }
    }
  }
  return makeRes(1n, 'Inconclusive');
}

/** Reference Version D: ZF-11 Precomputed Hierarchical Zero-Division Selector */
export function lehmanZF11(N: bigint): ZF12SolverResult {
  const t0 = performance.now();
  const st = createEmptyStats();
  const makeRes = (factor: bigint, phase: FactorizationPhase): ZF12SolverResult => ({
    algorithm: 'ZF-11 Precomputed',
    n: N,
    factor,
    verifiedFactor: verifyExtractedFactor(N, factor, phase),
    phase,
    ms: performance.now() - t0,
    stats: st,
  });

  st.bigMods++;
  if (N % 2n === 0n) return makeRes(2n, 'Even');

  for (const m of SMALL_ODD_MODULI) {
    st.gcds++;
    const g = bigIntGcd(N, m, st);
    if (g > 1n && g < N) return makeRes(g, 'Phase0');
  }

  const cbrtN = icbrtFloor(N, st);
  for (let d = 3n; d <= cbrtN; d += 2n) {
    st.bigMods++;
    if (N % d === 0n) return makeRes(d, 'Phase1');
  }

  const root6N = isqrtRef(cbrtN, st);
  const fourN = 4n * N;
  st.bigMuls++;
  const nMod64 = Number(N & 63n);

  for (let k = 1n; k <= cbrtN; k++) {
    const fourKN = k * fourN;
    st.bigMuls++;
    const aMin = ceilSqrtRef(fourKN, st);
    const sqrtK = isqrtRef(k, st);
    st.bigDivs++;
    st.bigMuls++;
    const tMax = root6N / (4n * sqrtK) + 1n;

    const c64 = (4 * Number(k & 63n) * nMod64) & 63;
    const useS1 = REJ64[c64] > 0;
    let a64 = Number(aMin & 63n);

    for (let t = 0n; t <= tMax; t++) {
      st.cand++;
      if (useS1) {
        const rem64 = (a64 * a64 - c64) & 63;
        a64 = (a64 + 1) & 63;
        if (QR64[rem64] === 0) continue;
      }

      st.s1++;
      const a = aMin + t;
      const diff = a * a - fourKN;
      st.bigMuls++;
      st.bigMods++;
      if (QR_M2[Number(diff % M2)] === 0) continue;

      st.s2++;
      const b = isqrtRef(diff, st);
      st.isqrtInner++;
      st.bigMuls++;
      st.bigCmps++;
      if (b * b === diff) {
        st.gcds++;
        let g = bigIntGcd(a - b, N, st);
        if (g > 1n && g < N) return makeRes(g, 'Phase2');
        if (g === N) {
          st.gcds++;
          g = bigIntGcd(a + b, N, st);
          if (g > 1n && g < N) return makeRes(g, 'Phase2+');
        }
      }
    }
  }
  return makeRes(1n, 'Inconclusive');
}

/**
 * ZF-12: Incremental Exact Outer Root Engine + Incremental tMax(k) + Incremental D(k,t)
 * Uses identical Phase0/Phase1/filters as ZF-9 for fair controlled comparison.
 */
export function lehmanZF12(
  N: bigint,
  mode: 'newton' | 'ineq' = 'ineq',
  checkInvariant = false
): ZF12SolverResult {
  const t0 = performance.now();
  const st = createEmptyStats();
  const algoName = mode === 'newton' ? 'ZF-12 (Newton Incremental)' : 'ZF-12 (Exact Inequality)';
  const makeRes = (factor: bigint, phase: FactorizationPhase): ZF12SolverResult => ({
    algorithm: algoName,
    n: N,
    factor,
    verifiedFactor: verifyExtractedFactor(N, factor, phase),
    phase,
    ms: performance.now() - t0,
    stats: st,
  });

  st.bigMods++;
  if (N % 2n === 0n) return makeRes(2n, 'Even');

  for (const m of SMALL_ODD_MODULI) {
    st.gcds++;
    const g = bigIntGcd(N, m, st);
    if (g > 1n && g < N) return makeRes(g, 'Phase0');
  }

  const cbrtN = icbrtFloor(N, st);
  for (let d = 3n; d <= cbrtN; d += 2n) {
    st.bigMods++;
    if (N % d === 0n) return makeRes(d, 'Phase1');
  }

  const root6N = isqrtRef(cbrtN, st);
  const fourN = 4n * N;
  st.bigMuls++;
  const nMod64 = Number(N & 63n);

  let fourKN = 0n;
  let prevA = 1n;
  let prevSq = 1n;
  let s = 1n;
  let nextSq = 4n;
  st.bigDivs++;
  let tMax = (root6N >> 2n) + 1n;

  for (let k = 1n; k <= cbrtN; k++) {
    fourKN += fourN;
    st.bigCmps++;
    if (k === nextSq) {
      s++;
      nextSq += (s << 1n) + 1n;
      st.bigDivs++;
      st.bigMuls++;
      tMax = root6N / (4n * s) + 1n;
    }

    let rootRes: { root: bigint; sq: bigint };
    if (k === 1n) {
      const r0 = ceilSqrtRef(fourKN, st);
      st.bigMuls++;
      rootRes = { root: r0, sq: r0 * r0 };
    } else {
      if (checkInvariant && prevSq !== prevA * prevA) {
        throw new Error(`Invalid previous-square invariant at k=${k}`);
      }
      rootRes =
        mode === 'newton'
          ? nextCeilSqrtNewton(prevA, fourKN, st)
          : nextCeilSqrtInequality(prevA, prevSq, fourKN, st);
    }

    const aMin = rootRes.root;
    prevA = aMin;
    prevSq = rootRes.sq;
    if (checkInvariant && prevSq !== prevA * prevA) {
      throw new Error(`Post-step prevSq invariant failed at k=${k}`);
    }

    let D = rootRes.sq - fourKN;
    const twoAMin = aMin << 1n;
    const f64 = (4 * Number(k & 63n) * nMod64) & 63;
    let a64 = Number(aMin & 63n);

    for (let t = 0n; t <= tMax; t++) {
      st.cand++;
      const rem64 = (a64 * a64 - f64) & 63;
      a64 = (a64 + 1) & 63;
      if (QR64[rem64] !== 0) {
        st.s1++;
        st.bigMods++;
        const r = Number(D % M2);
        if (
          QR9[r % 9] !== 0 &&
          QR5[r % 5] !== 0 &&
          QR7[r % 7] !== 0 &&
          QR11[r % 11] !== 0 &&
          QR13[r % 13] !== 0 &&
          QR17[r % 17] !== 0
        ) {
          st.s2++;
          const b = isqrtRef(D, st);
          st.isqrtInner++;
          st.bigMuls++;
          st.bigCmps++;
          if (b * b === D) {
            const a = aMin + t;
            st.gcds++;
            let g = bigIntGcd(a - b, N, st);
            if (g > 1n && g < N) return makeRes(g, 'Phase2');
            if (g === N) {
              st.gcds++;
              g = bigIntGcd(a + b, N, st);
              if (g > 1n && g < N) return makeRes(g, 'Phase2+');
            }
          }
        }
      }
      if (t < tMax) {
        D += twoAMin + (t << 1n) + 1n;
      }
    }
  }
  return makeRes(1n, 'Inconclusive');
}

/**
 * Exhaustive Full-Domain Mathematical Equivalence Audit:
 * Checks ALL 1 <= k <= floor(cbrt(N)) unless an explicit cap is supplied.
 * Verifies:
 *  - A_k^(Newton) === A_k^(Inequality) === ceilSqrtRef(4kN)
 *  - prevSq === prev^2 invariant at every single k
 *  - tMax^(Inc)(k) === floor(root6N / (4 * isqrt(k))) + 1
 *  - D(k, t) === (A_k + t)^2 - 4kN for all t in [0, tMax]
 */
export function verifyFullDomainEquivalence(
  N: bigint,
  maxKLimit?: bigint
): FullDomainAuditSummary {
  const cbrtN = icbrtFloor(N);
  const maxK = maxKLimit !== undefined && cbrtN > maxKLimit ? maxKLimit : cbrtN;
  const root6N = isqrtRef(cbrtN);
  const fourN = 4n * N;

  let fourKN = 0n;
  let prevA_N = 1n;
  let prevA_I = 1n;
  let prevSq_I = 1n;
  let s = 1n;
  let nextSq = 4n;
  let tMaxInc = (root6N >> 2n) + 1n;
  let checkedCandidates = 0n;
  let maxStepDelta = 0n;
  let fastPathHits = 0n;
  let fallbackHits = 0n;

  for (let k = 1n; k <= maxK; k++) {
    fourKN += fourN;
    if (k === nextSq) {
      s++;
      nextSq += (s << 1n) + 1n;
      tMaxInc = root6N / (4n * s) + 1n;
    }

    const refA = ceilSqrtRef(fourKN);
    const refSq = refA * refA;
    const refTMax = root6N / (4n * isqrtRef(k)) + 1n;

    if (k > 1n && prevSq_I !== prevA_I * prevA_I) {
      throw new Error(`Pre-step prevSq invariant broken at N=${N}, k=${k}`);
    }

    const rN = k === 1n ? { root: refA, sq: refSq } : nextCeilSqrtNewton(prevA_N, fourKN);
    const rI =
      k === 1n
        ? { root: refA, sq: refSq, usedFastPath: false }
        : nextCeilSqrtInequality(prevA_I, prevSq_I, fourKN);

    if (k > 1n) {
      if (rI.usedFastPath) fastPathHits++;
      else fallbackHits++;
      const stepDelta = rI.root - prevA_I;
      if (stepDelta > maxStepDelta) maxStepDelta = stepDelta;
    }

    if (rN.root !== refA || rN.sq !== refSq) {
      throw new Error(`Newton root mismatch at N=${N}, k=${k}: got ${rN.root}, expected ${refA}`);
    }
    if (rI.root !== refA || rI.sq !== refSq) {
      throw new Error(`Inequality root mismatch at N=${N}, k=${k}: got ${rI.root}, expected ${refA}`);
    }
    if (tMaxInc !== refTMax) {
      throw new Error(`tMax mismatch at N=${N}, k=${k}: got ${tMaxInc}, expected ${refTMax}`);
    }

    let D = rI.sq - fourKN;
    const twoA = rI.root << 1n;
    for (let t = 0n; t <= tMaxInc; t++) {
      checkedCandidates++;
      const expectedD = (refA + t) * (refA + t) - fourKN;
      if (D !== expectedD) {
        throw new Error(`D(k,t) mismatch at N=${N}, k=${k}, t=${t}`);
      }
      if (t < tMaxInc) D += twoA + (t << 1n) + 1n;
    }

    prevA_N = rN.root;
    prevA_I = rI.root;
    prevSq_I = rI.sq;
  }

  return {
    n: N,
    cbrtN,
    checkedK: maxK,
    checkedCandidates,
    maxStepDelta,
    fastPathHits,
    fallbackHits,
    passed: true,
  };
}

/**
 * Exhaustive boundary test for nextCeilSqrtInequality and nextCeilSqrtNewton:
 * 1. target <= prevSq (including 4kN <= prevSq and prev > ceilSqrt(target))
 * 2. Exact boundary thresholds r^2 = 2A - 1, r^2 = 2A, r^2 = 2A + 1 across all u in [0, 2A - 1]
 */
export function verifyBoundaryEdgeCases(): BoundaryAuditSummary {
  let testedEdgeTriples = 0;
  let testedUnderTargetCases = 0;

  // 1. Test target <= prevSq cases
  for (let prev = 1n; prev <= 40n; prev++) {
    const prevSq = prev * prev;
    for (let target = 1n; target <= prevSq + 5n; target++) {
      testedUnderTargetCases++;
      const expected = ceilSqrtRef(target);
      const rI = nextCeilSqrtInequality(prev, prevSq, target);
      const rN = nextCeilSqrtNewton(prev, target);
      if (rI.root !== expected || rI.sq !== expected * expected) {
        throw new Error(`Edge target<=prevSq failed (Ineq) for prev=${prev}, target=${target}`);
      }
      if (rN.root !== expected || rN.sq !== expected * expected) {
        throw new Error(`Edge target<=prevSq failed (Newton) for prev=${prev}, target=${target}`);
      }
    }
  }

  // 2. Test r^2 in {2A - 1, 2A, 2A + 1} across all remainders u in [0, 2A - 1]
  // Whenever r^2 - (-1, 0, +1) is even, test A = (r^2 + offset) / 2
  for (let r = 2n; r <= 30n; r++) {
    for (const offset of [-1n, 0n, 1n]) {
      const twoA = r * r - offset; // so r^2 = 2A + offset => r^2 in {2A-1, 2A, 2A+1}
      if (twoA <= 0n || (twoA & 1n) === 1n) continue;
      const A = twoA >> 1n;
      const prevSq = A * A;
      for (let u = 0n; u < twoA; u++) {
        testedEdgeTriples++;
        const target = prevSq + twoA * r + u;
        const expected = ceilSqrtRef(target);
        const rI = nextCeilSqrtInequality(A, prevSq, target);
        const rN = nextCeilSqrtNewton(A, target);
        if (rI.root !== expected || rI.sq !== expected * expected) {
          throw new Error(`Boundary r^2=2A+(${offset}) failed (Ineq): A=${A}, r=${r}, u=${u}`);
        }
        if (rN.root !== expected || rN.sq !== expected * expected) {
          throw new Error(`Boundary r^2=2A+(${offset}) failed (Newton): A=${A}, r=${r}, u=${u}`);
        }
      }
    }
  }

  return { testedEdgeTriples, testedUnderTargetCases, passed: true };
}

function medianBenchmark(fn: (n: bigint) => ZF12SolverResult, N: bigint, reps: number): ZF12SolverResult {
  const times: number[] = [];
  let last!: ZF12SolverResult;
  for (let i = 0; i < reps; i++) {
    last = fn(N);
    times.push(last.ms);
  }
  times.sort((a, b) => a - b);
  return { ...last, ms: Number(times[Math.floor(reps / 2)].toFixed(3)) };
}

export function runZF12BenchmarkSuite(repetitions = 30): ZF12BenchmarkRow[] {
  for (const n of [1009003027n, 1048023103n]) {
    lehmanOriginal(n);
    lehmanZF9(n);
    lehmanZF12(n, 'newton', false);
    lehmanZF12(n, 'ineq', false);
  }

  const rows: ZF12BenchmarkRow[] = [];
  for (const n of MANDATORY_ZF12_TEST_CASES) {
    const classification = classifyInteger(n);
    const original = medianBenchmark(lehmanOriginal, n, repetitions);
    const zf9 = medianBenchmark(lehmanZF9, n, repetitions);
    const zf12Newton = medianBenchmark((x) => lehmanZF12(x, 'newton', true), n, repetitions);
    const zf12Ineq = medianBenchmark((x) => lehmanZF12(x, 'ineq', true), n, repetitions);

    if (
      original.factor !== zf9.factor ||
      zf9.factor !== zf12Newton.factor ||
      zf9.factor !== zf12Ineq.factor ||
      !zf12Ineq.verifiedFactor
    ) {
      throw new Error(`Verification mismatch on N=${n.toString()}`);
    }

    const speedupIneqVsZF9Pct = zf9.ms > 0 ? Number((((zf9.ms - zf12Ineq.ms) / zf9.ms) * 100).toFixed(1)) : 0;
    const speedupIneqVsOrigPct =
      original.ms > 0 ? Number((((original.ms - zf12Ineq.ms) / original.ms) * 100).toFixed(1)) : 0;

    rows.push({
      n,
      classification,
      original,
      zf9,
      zf12Newton,
      zf12Ineq,
      speedupIneqVsZF9Pct,
      speedupIneqVsOrigPct,
    });
  }
  return rows;
}
