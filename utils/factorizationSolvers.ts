export interface OpCounts {
  additions: number;
  multiplications: number;
  squarings: number;
  gcds: number;
  modFilterChecks: number;
  modFilterPassed: number;
  isqrtCalls: number;
  candidatesEvaluated: number;
}

export interface CollisionFactorResult {
  algorithm: string;
  n: string;
  p: string;
  q: string;
  a: string;
  b: string;
  k: string;
  gcdValue: string;
  verifiedSquareCongruence: boolean;
  verifiedNontrivialGcd: boolean;
  verifiedProduct: boolean;
  elapsedMs: number;
  ops: OpCounts;
}

export interface AlgorithmComparisonEntry {
  algorithm: string;
  factorFound: string;
  steps: number;
  elapsedMs: number;
  ops: OpCounts;
  notes: string;
}

export interface SemiprimeBenchmarkRow {
  label: string;
  category: 'balanced' | 'moderately-unbalanced' | 'unbalanced';
  n: string;
  p: string;
  q: string;
  guided: CollisionFactorResult;
  unguided: CollisionFactorResult;
  pollardRho: AlgorithmComparisonEntry;
  quadraticSieve: AlgorithmComparisonEntry;
}

export interface DirectFactorizationReport {
  primaryN: string;
  auxiliaryModuli: number[];
  theoreticalSurvivalRate: number;
  primaryGuided: CollisionFactorResult;
  primaryUnguided: CollisionFactorResult;
  primaryPollardRho: AlgorithmComparisonEntry;
  primaryQuadraticSieve: AlgorithmComparisonEntry;
  benchmarks: SemiprimeBenchmarkRow[];
}

export const DEFAULT_AUX_MODULI = [16, 3, 5, 7, 11, 13, 17];

export function bigIntIsqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("Square root of negative BigInt is undefined");
  if (n < 2n) return n;
  // Initial estimate via bit-length shift
  const bitLen = n.toString(2).length;
  let x = 1n << BigInt((bitLen + 1) >> 1);
  while (true) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  while ((x + 1n) * (x + 1n) <= n) x++;
  while (x * x > n) x--;
  return x;
}

export function bigIntGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function isProbablePrime(n: bigint): boolean {
  if (n < 2n) return false;
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n]) {
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let r = 1; r < s; r++) {
      x = (x * x) % n;
      if (x === n - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function buildQuadraticResidueTables(moduli: number[]): Uint8Array[] {
  return moduli.map((m) => {
    const table = new Uint8Array(m);
    for (let y = 0; y < m; y++) {
      table[(y * y) % m] = 1;
    }
    return table;
  });
}

export function computeTheoreticalSurvivalRate(moduli: number[]): number {
  const qrTables = buildQuadraticResidueTables(moduli);
  return moduli.reduce((acc, m, idx) => {
    const count = qrTables[idx].reduce((sum, v) => sum + v, 0);
    return acc * (count / m);
  }, 1);
}

/**
 * Deterministic Modular-Guided Nontrivial Quadratic Collision (BigInt).
 * Searches for (a, b, k) such that a^2 - b^2 = 4*k*N (hence a^2 ≡ b^2 (mod N))
 * and 1 < gcd(a - b, N) < N, using auxiliary moduli to filter out non-square residues
 * in O(1) small-integer arithmetic before executing BigInt squaring and isqrt.
 */
export function runQuadraticCollisionSearch(
  N: bigint,
  options: { useModularGuidance: boolean; moduli?: number[] }
): CollisionFactorResult {
  const start = performance.now();
  const moduli = options.moduli ?? DEFAULT_AUX_MODULI;
  const qrTables = options.useModularGuidance ? buildQuadraticResidueTables(moduli) : [];

  const ops: OpCounts = {
    additions: 0,
    multiplications: 0,
    squarings: 0,
    gcds: 0,
    modFilterChecks: 0,
    modFilterPassed: 0,
    isqrtCalls: 0,
    candidatesEvaluated: 0,
  };

  const makeResult = (a: bigint, b: bigint, k: bigint, factor: bigint): CollisionFactorResult => {
    const other = N / factor;
    const p = factor <= other ? factor : other;
    const q = factor <= other ? other : factor;
    const g = bigIntGcd(a - b, N);
    const verifiedSquareCongruence = ((a * a - b * b) % N) === 0n;
    const verifiedNontrivialGcd = g > 1n && g < N;
    const verifiedProduct = p * q === N && p > 1n && q > 1n;
    return {
      algorithm: options.useModularGuidance
        ? "Modular-Guided Quadratic Collision"
        : "Unguided Quadratic Collision",
      n: N.toString(),
      p: p.toString(),
      q: q.toString(),
      a: a.toString(),
      b: b.toString(),
      k: k.toString(),
      gcdValue: g.toString(),
      verifiedSquareCongruence,
      verifiedNontrivialGcd,
      verifiedProduct,
      elapsedMs: Number((performance.now() - start).toFixed(3)),
      ops,
    };
  };

  if (N % 2n === 0n) {
    return makeResult(N / 2n + 1n, N / 2n - 1n, 1n, 2n);
  }

  // Ensure coprimality with auxiliary moduli; if shared factor found, expose trivial collision
  if (options.useModularGuidance) {
    for (const m of moduli) {
      ops.gcds++;
      const g = bigIntGcd(BigInt(m), N);
      if (g > 1n && g < N) {
        return makeResult(g, 0n, 0n, g);
      }
    }
  }

  const nMods = options.useModularGuidance ? moduli.map((m) => Number(N % BigInt(m))) : [];
  const rootN = bigIntIsqrt(N);
  ops.isqrtCalls++;
  const nSixth = bigIntIsqrt(bigIntIsqrt(rootN));
  ops.isqrtCalls += 2;
  const maxK = rootN + 1n;

  let fourKN = 0n;
  const fourN = 4n * N;
  ops.multiplications++;

  for (let k = 1n; k <= maxK; k++) {
    fourKN += fourN;
    ops.additions++;

    const r0 = bigIntIsqrt(fourKN);
    ops.isqrtCalls++;
    const r0Sq = r0 * r0;
    ops.squarings++;
    const aStart = r0Sq < fourKN ? r0 + 1n : r0;
    if (r0Sq < fourKN) ops.additions++;

    // Window width: modest initial Fermat band at k=1, Lehman-style band for k>=1
    const kRoot = bigIntIsqrt(k);
    const window = k === 1n ? 512n : (nSixth / (4n * (kRoot > 0n ? kRoot : 1n))) + 2n;

    // Precompute aStart mod m once per k to avoid BigInt % inside inner loop
    const aMods = options.useModularGuidance
      ? moduli.map((m) => Number(aStart % BigInt(m)))
      : [];
    const fourKNMods = options.useModularGuidance
      ? moduli.map((m, idx) => (4 * (Number(k % BigInt(m))) * nMods[idx]) % m)
      : [];

    for (let t = 0n; t <= window; t++) {
      ops.candidatesEvaluated++;
      const a = aStart + t;
      if (t > 0n) ops.additions++;

      if (options.useModularGuidance) {
        let pass = true;
        for (let i = 0; i < moduli.length; i++) {
          ops.modFilterChecks++;
          const m = moduli[i];
          const aMod = aMods[i];
          const diffMod = ((aMod * aMod - fourKNMods[i]) % m + m) % m;
          if (!qrTables[i][diffMod]) {
            pass = false;
            break;
          }
        }
        // Increment modular residues for next t
        for (let i = 0; i < moduli.length; i++) {
          aMods[i] = (aMods[i] + 1) % moduli[i];
        }
        if (!pass) continue;
      }

      ops.modFilterPassed++;
      const diff = a * a - fourKN;
      ops.squarings++;
      ops.additions++;

      const b = bigIntIsqrt(diff);
      ops.isqrtCalls++;
      const bSq = b * b;
      ops.squarings++;

      if (bSq === diff) {
        ops.additions++;
        ops.gcds++;
        const g = bigIntGcd(a - b, N);
        if (g > 1n && g < N) {
          return makeResult(a, b, k, g);
        }
      }
    }
  }

  throw new Error(`Failed to find nontrivial quadratic collision for N=${N.toString()}`);
}

/**
 * Deterministic Pollard's Rho (Brent variant, fixed seed x0=2, c=1) for fair comparison.
 */
export function runPollardRho(N: bigint): AlgorithmComparisonEntry {
  const start = performance.now();
  const ops: OpCounts = {
    additions: 0,
    multiplications: 0,
    squarings: 0,
    gcds: 0,
    modFilterChecks: 0,
    modFilterPassed: 0,
    isqrtCalls: 0,
    candidatesEvaluated: 0,
  };

  if (N % 2n === 0n) {
    return {
      algorithm: "Pollard's Rho (Brent)",
      factorFound: "2",
      steps: 1,
      elapsedMs: Number((performance.now() - start).toFixed(3)),
      ops,
      notes: "Even factor extracted directly",
    };
  }

  for (const c of [1n, 2n, 3n, 5n, 7n]) {
    let x = 2n;
    let y = 2n;
    let d = 1n;
    let steps = 0;
    const limit = 2000000;

    while (d === 1n && steps < limit) {
      x = (x * x + c) % N;
      ops.squarings++;
      ops.additions++;

      y = (y * y + c) % N;
      y = (y * y + c) % N;
      ops.squarings += 2;
      ops.additions += 2;

      const diff = x > y ? x - y : y - x;
      ops.additions++;
      d = bigIntGcd(diff, N);
      ops.gcds++;
      steps++;
      ops.candidatesEvaluated++;
    }

    if (d > 1n && d < N) {
      return {
        algorithm: "Pollard's Rho (Floyd)",
        factorFound: d.toString(),
        steps,
        elapsedMs: Number((performance.now() - start).toFixed(3)),
        ops,
        notes: `Seed x0=2, polynomial x^2 + ${c.toString()} mod N`,
      };
    }
  }

  return {
    algorithm: "Pollard's Rho (Floyd)",
    factorFound: "N/A",
    steps: 0,
    elapsedMs: Number((performance.now() - start).toFixed(3)),
    ops,
    notes: "Exceeded step cap",
  };
}

function legendreSymbol(a: bigint, p: bigint): number {
  const ls = modPow(a % p, (p - 1n) >> 1n, p);
  if (ls === p - 1n) return -1;
  return Number(ls);
}

/**
 * Compact Quadratic Sieve (Kraitchik/Pomerance style smooth square congruence over factor base + GF(2) elimination)
 * for direct empirical comparison on test inputs.
 */
export function runQuadraticSieve(N: bigint): AlgorithmComparisonEntry {
  const start = performance.now();
  const ops: OpCounts = {
    additions: 0,
    multiplications: 0,
    squarings: 0,
    gcds: 0,
    modFilterChecks: 0,
    modFilterPassed: 0,
    isqrtCalls: 0,
    candidatesEvaluated: 0,
  };

  const rootN = bigIntIsqrt(N);
  ops.isqrtCalls++;
  if (rootN * rootN === N) {
    return {
      algorithm: "Quadratic Sieve (QS)",
      factorFound: rootN.toString(),
      steps: 1,
      elapsedMs: Number((performance.now() - start).toFixed(3)),
      ops,
      notes: "Perfect square",
    };
  }

  // Build factor base of primes p <= B where N is a quadratic residue mod p
  const candidatePrimes = [
    2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71,
    73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151,
  ];
  const factorBase: bigint[] = [];
  for (const pNum of candidatePrimes) {
    const p = BigInt(pNum);
    if (p === 2n || legendreSymbol(N, p) === 1) {
      factorBase.push(p);
    }
    if (factorBase.length >= 22) break;
  }

  const neededRelations = factorBase.length + 3;
  const relations: Array<{ x: bigint; qx: bigint; exponents: number[] }> = [];
  const startX = rootN + 1n;
  const maxSpan = 250000;

  // Trial factor Q(x) = x^2 - N over the factor base (small B, compact QS)
  for (let offset = 0; offset < maxSpan && relations.length < neededRelations; offset++) {
    const x = startX + BigInt(offset);
    ops.additions++;
    const qx = x * x - N;
    ops.squarings++;
    ops.additions++;
    ops.candidatesEvaluated++;

    let rem = qx;
    const exps = new Array<number>(factorBase.length).fill(0);
    for (let i = 0; i < factorBase.length; i++) {
      const p = factorBase[i];
      while (rem % p === 0n) {
        rem /= p;
        exps[i]++;
      }
      if (rem === 1n) break;
    }

    if (rem === 1n) {
      relations.push({ x, qx, exponents: exps });
      ops.modFilterPassed++;
    }
  }

  // GF(2) Gaussian elimination on exponent vectors to find dependent subset
  const m = relations.length;
  const cols = factorBase.length;
  const matrix = relations.map((r) => r.exponents.map((e) => e & 1));
  const history = relations.map((_, idx) => {
    const row = new Uint8Array(m);
    row[idx] = 1;
    return row;
  });

  for (let col = 0; col < cols; col++) {
    let pivot = -1;
    for (let row = 0; row < m; row++) {
      if (matrix[row][col] === 1) {
        // check if this row hasn't been used as an earlier pivot
        let hasEarlierOne = false;
        for (let prev = 0; prev < col; prev++) {
          if (matrix[row][prev] === 1) {
            hasEarlierOne = true;
            break;
          }
        }
        if (!hasEarlierOne) {
          pivot = row;
          break;
        }
      }
    }
    if (pivot === -1) continue;
    for (let row = 0; row < m; row++) {
      if (row !== pivot && matrix[row][col] === 1) {
        for (let c = 0; c < cols; c++) matrix[row][c] ^= matrix[pivot][c];
        for (let h = 0; h < m; h++) history[row][h] ^= history[pivot][h];
      }
    }
  }

  for (let row = 0; row < m; row++) {
    const isZero = matrix[row].every((v) => v === 0);
    if (!isZero) continue;

    let prodX = 1n;
    const totalExp = new Array<number>(cols).fill(0);
    for (let i = 0; i < m; i++) {
      if (history[row][i]) {
        prodX = (prodX * relations[i].x) % N;
        ops.multiplications++;
        for (let c = 0; c < cols; c++) totalExp[c] += relations[i].exponents[c];
      }
    }
    let prodY = 1n;
    for (let c = 0; c < cols; c++) {
      const half = totalExp[c] >> 1;
      for (let t = 0; t < half; t++) {
        prodY = (prodY * factorBase[c]) % N;
        ops.multiplications++;
      }
    }

    ops.gcds++;
    ops.additions++;
    const g = bigIntGcd(prodX > prodY ? prodX - prodY : prodY - prodX, N);
    if (g > 1n && g < N) {
      return {
        algorithm: "Quadratic Sieve (QS)",
        factorFound: g.toString(),
        steps: ops.candidatesEvaluated,
        elapsedMs: Number((performance.now() - start).toFixed(3)),
        ops,
        notes: `Factor base |FB|=${factorBase.length}, smooth relations=${relations.length}`,
      };
    }
  }

  return {
    algorithm: "Quadratic Sieve (QS)",
    factorFound: "Needs larger FB",
    steps: ops.candidatesEvaluated,
    elapsedMs: Number((performance.now() - start).toFixed(3)),
    ops,
    notes: `Collected ${relations.length}/${neededRelations} relations over span ${maxSpan}`,
  };
}

export function solveFactorizationSuite(primaryNStr: string): DirectFactorizationReport {
  const primaryN = BigInt(primaryNStr);
  const moduli = DEFAULT_AUX_MODULI;

  const primaryGuided = runQuadraticCollisionSearch(primaryN, {
    useModularGuidance: true,
    moduli,
  });
  const primaryUnguided = runQuadraticCollisionSearch(primaryN, {
    useModularGuidance: false,
  });
  const primaryPollardRho = runPollardRho(primaryN);
  const primaryQuadraticSieve = runQuadraticSieve(primaryN);

  const suiteInputs: Array<{
    label: string;
    category: 'balanced' | 'moderately-unbalanced' | 'unbalanced';
    n: bigint;
  }> = [
    { label: "Mandatory Test 1 (Twin-Prime Balanced)", category: "balanced", n: 100160063n },
    { label: "Balanced Semiprime (Δ ≈ 100)", category: "balanced", n: 10010600309n },
    { label: "Moderately Unbalanced (q/p ≈ 10.5)", category: "moderately-unbalanced", n: 1048023103n },
    { label: "Unbalanced Semiprime (q/p ≈ 991)", category: "unbalanced", n: 1009003027n },
  ];

  // Include primaryN in benchmarks if not already in suite
  if (!suiteInputs.some((s) => s.n === primaryN) && !isProbablePrime(primaryN)) {
    suiteInputs.unshift({
      label: "User Input N",
      category: "balanced",
      n: primaryN,
    });
  }

  const benchmarks: SemiprimeBenchmarkRow[] = suiteInputs.map((item) => {
    const guided = runQuadraticCollisionSearch(item.n, {
      useModularGuidance: true,
      moduli,
    });
    const unguided = runQuadraticCollisionSearch(item.n, {
      useModularGuidance: false,
    });
    const pollardRho = runPollardRho(item.n);
    const quadraticSieve = runQuadraticSieve(item.n);

    return {
      label: item.label,
      category: item.category,
      n: item.n.toString(),
      p: guided.p,
      q: guided.q,
      guided,
      unguided,
      pollardRho,
      quadraticSieve,
    };
  });

  return {
    primaryN: primaryN.toString(),
    auxiliaryModuli: moduli,
    theoreticalSurvivalRate: computeTheoreticalSurvivalRate(moduli),
    primaryGuided,
    primaryUnguided,
    primaryPollardRho,
    primaryQuadraticSieve,
    benchmarks,
  };
}
