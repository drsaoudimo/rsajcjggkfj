import { createServerFn } from "@tanstack/react-start";
import { generateSemiprime, isProbablePrime, makeClock } from "./bigmath";
import { ecmRun, pollardPm1, pollardRho, quadraticSieve, trialDivision } from "./algos";

const BUDGET_MS = 20000;

export const generate = createServerFn({ method: "POST" })
  .inputValidator((d: { bits: number; smallBits?: number | null }) => {
    const bits = Math.round(Number(d.bits));
    if (!Number.isFinite(bits) || bits < 8 || bits > 4096) throw new Error("bits must be 8–4096");
    return { bits, smallBits: d.smallBits ? Math.round(Number(d.smallBits)) : null };
  })
  .handler(async ({ data }) => {
    const t = performance.now();
    const { n, p, q } = generateSemiprime(data.bits, data.smallBits);
    return { n: n.toString(), p: p.toString(), q: q.toString(), ms: performance.now() - t };
  });

type Stage = "check" | "trial" | "rho" | "pm1" | "ecm" | "qs";

export interface StageInput {
  n: string;
  stage: Stage;
  rho?: { c: string; x: string; y: string; iters: number } | undefined;
  B1?: number | undefined;
  B2?: number | undefined;
  sigma?: number | undefined;
}

export const runStage = createServerFn({ method: "POST" })
  .inputValidator((d: StageInput) => {
    if (!/^\d{1,1300}$/.test(d.n)) throw new Error("N must be a positive integer");
    return d;
  })
  .handler(async ({ data }) => {
    const n = BigInt(data.n);
    const t0 = performance.now();
    const expired = makeClock(BUDGET_MS);
    const done = (extra: Record<string, unknown>) => ({ ms: performance.now() - t0, ...extra });
    const fac = (f: bigint | null) => (f ? f.toString() : null);

    switch (data.stage) {
      case "check":
        return done({ prime: isProbablePrime(n), even: n % 2n === 0n });
      case "trial":
        return done({ factor: fac(trialDivision(n, 200000)), detail: "primes ≤ 200,000 + perfect square" });
      case "rho": {
        const s = data.rho
          ? { c: BigInt(data.rho.c), x: BigInt(data.rho.x), y: BigInt(data.rho.y), iters: data.rho.iters }
          : { c: 1n, x: 2n, y: 2n, iters: 0 };
        const r = pollardRho(n, s, 5_000_000, expired);
        return done({
          factor: fac(r.factor),
          rho: { c: r.state.c.toString(), x: r.state.x.toString(), y: r.state.y.toString(), iters: r.state.iters },
        });
      }
      case "pm1": {
        const B1 = Math.min(Math.max(data.B1 ?? 1_000_000, 1000), 20_000_000);
        const r = pollardPm1(n, B1, expired);
        return done({ factor: fac(r.factor), completed: r.completed, B1 });
      }
      case "ecm": {
        const B1 = Math.min(Math.max(data.B1 ?? 11000, 500), 3_000_000);
        const B2 = Math.min(Math.max(data.B2 ?? B1 * 100, B1), 300_000_000);
        const r = ecmRun(n, B1, B2, data.sigma ?? 11, 10000, expired);
        return done({ factor: fac(r.factor), curves: r.curves, nextSigma: r.nextSigma, B1, B2 });
      }
      case "qs": {
        const r = quadraticSieve(n, 100000, expired);
        return done({ factor: fac(r.factor), stats: r.stats, reason: r.reason ?? null });
      }
    }
  });
