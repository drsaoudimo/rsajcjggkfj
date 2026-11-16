import { describe, expect, it } from "vitest";
import { generateSemiprime, isProbablePrime, makeClock } from "./bigmath";
import { ecmCurve, pollardPm1, pollardRho, quadraticSieve, rhoInitial, trialDivision } from "./algos";
import { detectSpecialForm, feasibility } from "./analysis";

const clock = () => makeClock(30000);

describe("factoring algorithms", () => {
  it("Miller-Rabin knows M61 is prime and M67 is not", () => {
    expect(isProbablePrime(2n ** 61n - 1n)).toBe(true);
    expect(isProbablePrime(2n ** 67n - 1n)).toBe(false);
  });
  it("generated semiprime has the requested bit size and true factors", () => {
    const { n, p, q } = generateSemiprime(64);
    expect(n.toString(2).length).toBe(64);
    expect(p * q).toBe(n);
  });
  it("trial division finds 7919", () => {
    expect(trialDivision(7919n * 1000000007n, 10000)).toBe(7919n);
  });
  it("rho factors M67 (Cole 1903)", () => {
    const r = pollardRho(2n ** 67n - 1n, rhoInitial(), 1e7, clock());
    expect([193707721n, 761838257287n]).toContain(r.factor);
  });
  it("p-1 finds a smooth-minus-one factor", () => {
    const p = 2n * 3n ** 5n * 5n ** 3n * 7n * 11n * 13n * 7n + 1n;
    expect(isProbablePrime(p)).toBe(true);
    const n = p * 1000000000000000003n;
    expect(pollardPm1(n, 1000, clock()).factor).toBe(p);
  });
  it("ECM finds a 30-bit factor of a 100-bit number", () => {
    const p = 1000000007n;
    const n = p * 1267650600228229401496703205653n;
    let f: bigint | null = null;
    for (let s = 11; s < 400 && !f; s++) f = ecmCurve(n, BigInt(s), 2000, 200000);
    expect(f).toBe(p);
  });
  it("quadratic sieve factors a balanced 80-bit semiprime", () => {
    const { n, p, q } = generateSemiprime(80);
    const r = quadraticSieve(n, 100000, clock());
    expect([p, q]).toContain(r.factor);
  });
  it("detects Mersenne and repunit forms", () => {
    expect(detectSpecialForm(2n ** 127n - 1n)?.kind).toBe("Mersenne");
    expect(detectSpecialForm(1111111111111111111n)?.kind).toBe("Repunit");
  });
  it("feasibility bands follow the stated thresholds", () => {
    expect(feasibility(80).verdict).toBe("instant");
    expect(feasibility(120).verdict).toBe("golden");
    expect(feasibility(180).verdict).toBe("hard");
    expect(feasibility(256).verdict).toBe("borderline");
    expect(feasibility(512).verdict).toBe("infeasible");
  });
});
