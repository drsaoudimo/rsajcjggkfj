// Pure BigInt number theory helpers. No Node-only APIs: runs on workerd and in the browser.

export const bitLength = (n: bigint): number => (n <= 0n ? 0 : n.toString(2).length);

export function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) r = (r * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return r;
}

export function modInv(a: bigint, m: bigint): bigint | null {
  let r0 = ((a % m) + m) % m;
  let r1 = m;
  let s0 = 1n;
  let s1 = 0n;
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) return null;
  return ((s0 % m) + m) % m;
}

export function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt((bitLength(n) + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

/** floor(n^(1/k)) */
export function iroot(n: bigint, k: number): bigint {
  if (n < 2n) return n;
  const K = BigInt(k);
  let x = 1n << BigInt(Math.ceil(bitLength(n) / k));
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) return x;
    x = y;
  }
}

export function randomBits(bits: number, topTwo = false): bigint {
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  v &= (1n << BigInt(bits)) - 1n;
  v |= 1n << BigInt(bits - 1);
  if (topTwo && bits >= 3) v |= 1n << BigInt(bits - 2);
  return v;
}

export function randomBelow(max: bigint): bigint {
  return randomBits(bitLength(max) + 16) % max;
}

const cache = new Map<number, number[]>();
export function primesUpTo(limit: number): number[] {
  const hit = cache.get(limit);
  if (hit) return hit;
  const sieve = new Uint8Array(limit + 1);
  const out: number[] = [];
  for (let i = 2; i <= limit; i++) {
    if (sieve[i]) continue;
    out.push(i);
    for (let j = i * i; j <= limit; j += i) sieve[j] = 1;
  }
  if (cache.size > 4) cache.clear();
  cache.set(limit, out);
  return out;
}

const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

export function isProbablePrime(n: bigint, extraRounds = 8): boolean {
  if (n < 2n) return false;
  for (const p of MR_BASES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let s = 0;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s++;
  }
  const witness = (a: bigint): boolean => {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) return true;
    for (let i = 1; i < s; i++) {
      x = (x * x) % n;
      if (x === n - 1n) return true;
    }
    return false;
  };
  for (const a of MR_BASES) if (!witness(a)) return false;
  if (bitLength(n) > 80) {
    for (let i = 0; i < extraRounds; i++) {
      const a = 2n + randomBelow(n - 3n);
      if (!witness(a)) return false;
    }
  }
  return true;
}

export function randomPrime(bits: number): bigint {
  for (;;) {
    const c = randomBits(bits, true) | 1n;
    if (isProbablePrime(c)) return c;
  }
}

/** Euler criterion: 1 if a is a nonzero square mod odd prime p. */
export function legendre(a: bigint, p: bigint): number {
  const r = modPow(((a % p) + p) % p, (p - 1n) / 2n, p);
  if (r === 0n) return 0;
  return r === 1n ? 1 : -1;
}

/** Square root of n mod odd prime p (n must be a QR). */
export function tonelliShanks(n: bigint, p: bigint): bigint {
  n = ((n % p) + p) % p;
  if (p === 2n) return n & 1n;
  if (p % 4n === 3n) return modPow(n, (p + 1n) / 4n, p);
  let q = p - 1n;
  let s = 0;
  while ((q & 1n) === 0n) {
    q >>= 1n;
    s++;
  }
  let z = 2n;
  while (legendre(z, p) !== -1) z++;
  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(n, q, p);
  let r = modPow(n, (q + 1n) / 2n, p);
  while (t !== 1n) {
    let i = 0;
    let tt = t;
    while (tt !== 1n) {
      tt = (tt * tt) % p;
      i++;
    }
    const b = modPow(c, 1n << BigInt(m - i - 1), p);
    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }
  return r;
}

export function log2Big(v: bigint): number {
  const bl = bitLength(v);
  if (bl <= 53) return Math.log2(Number(v));
  return Math.log2(Number(v >> BigInt(bl - 53))) + (bl - 53);
}

export function generateSemiprime(bits: number, smallBits?: number | null) {
  const b1 = smallBits && smallBits >= 4 ? Math.min(smallBits, bits - 4) : Math.floor(bits / 2);
  const b2 = bits - b1;
  const p = randomPrime(b1);
  let q = randomPrime(b2);
  while (q === p) q = randomPrime(b2);
  const [lo, hi] = p < q ? [p, q] : [q, p];
  return { n: p * q, p: lo, q: hi };
}

export type Clock = () => boolean; // returns true when the time budget is spent
export const makeClock = (ms: number): Clock => {
  const end = performance.now() + ms;
  return () => performance.now() > end;
};
