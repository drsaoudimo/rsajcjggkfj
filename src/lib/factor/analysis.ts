import { bitLength, iroot } from "./bigmath";

export interface SpecialForm {
  kind: string;
  expr: string;
}

/** Detects forms suited to SNFS: a^k ± 1 and repunits (a^m - 1)/(a - 1). */
export function detectSpecialForm(n: bigint): SpecialForm | null {
  const bits = bitLength(n);
  for (const delta of [1n, -1n]) {
    const t = n + delta; // n = t - delta, so n = a^k ∓ 1
    const sign = delta === 1n ? "−" : "+";
    for (let k = bits + 1; k >= 2; k--) {
      const a = iroot(t, k);
      if (a < 2n) continue;
      for (const c of [a, a + 1n]) {
        if (c ** BigInt(k) === t) {
          const kind = c === 2n ? (delta === 1n ? "Mersenne" : "Fermat-like") : "Cyclotomic";
          return { kind, expr: `${c}^${k} ${sign} 1` };
        }
      }
    }
  }
  for (let a = 2n; a <= 100n; a++) {
    let v = 1n;
    let m = 1;
    while (v < n) {
      v = v * a + 1n;
      m++;
      if (v === n && m >= 3) return { kind: "Repunit", expr: `(${a}^${m} − 1)/(${a} − 1)` };
    }
  }
  return null;
}

/** ln L_N[a, c] */
export const lnL = (bits: number, a: number, c: number) => {
  const ln = bits * Math.LN2;
  return c * Math.pow(ln, a) * Math.pow(Math.log(ln), 1 - a);
};

// Calibration: RSA-155 (512 bits) took ~8000 MIPS-years ≈ 2.5e17 s·ops; we anchor relative cost to it.
const RSA512_CPU_YEARS = 8000;

export interface Feasibility {
  bits: number;
  verdict: "instant" | "golden" | "hard" | "borderline" | "infeasible";
  label: string;
  why: string;
  qsLog10: number; // log10 of L[1/2, 1]
  gnfsLog10: number; // log10 of L[1/3, 1.923]
  ecmLog10Balanced: number; // log10 of L_p[1/2, √2] for p ≈ √N
  gnfsCpuYears: number;
  suggestedB: number;
  relationsNeeded: number;
  matrixMB: number;
}

export function feasibility(bits: number): Feasibility {
  const ln10 = Math.LN10;
  const qs = lnL(bits, 0.5, 1) / ln10;
  const gnfs = lnL(bits, 1 / 3, 1.923) / ln10;
  const ecm = lnL(Math.ceil(bits / 2), 0.5, Math.SQRT2) / ln10;
  const gnfsCpuYears = RSA512_CPU_YEARS * Math.pow(10, gnfs - lnL(512, 1 / 3, 1.923) / ln10);
  const lnN = bits * Math.LN2;
  const B = Math.round(Math.exp(0.5 * Math.sqrt(lnN * Math.log(lnN))));
  const piB = Math.round(B / Math.log(Math.max(B, 3)) / 2);
  const matrixMB = (piB * piB) / 8 / 1e6;
  let verdict: Feasibility["verdict"];
  let label: string;
  let why: string;
  if (bits <= 80) {
    verdict = "instant";
    label = "ممتازة، فورية";
    why = "تُحل في ثوانٍ. حتى خوارزمية واحدة تكفي.";
  } else if (bits <= 120) {
    verdict = "golden";
    label = "مجدية جداً";
    why = "المنطقة الذهبية: QS يجد علاقات كافية بسرعة ومصفوفة GF(2) صغيرة.";
  } else if (bits <= 180) {
    verdict = "hard";
    label = "مجدية بصعوبة";
    why = "قاعدة عوامل كبيرة ومصفوفة ضخمة؛ حل GF(2) يصبح عنق الزجاجة. تحتاج SIQS وBlock Lanczos.";
  } else if (bits <= 256) {
    verdict = "borderline";
    label = "حدودية";
    why = "نظرياً ممكنة، عملياً أيام وذاكرة ضخمة. QS لا يكفي، تحتاج GNFS.";
  } else {
    verdict = "infeasible";
    label = "غير مجدية";
    why = "RSA-512 تطلّب ~8000 سنة-CPU عام 1999. هذا ليس حد الكود بل حد الرياضيات: L[1/2] لمسألة تحتاج L[1/3].";
  }
  return {
    bits,
    verdict,
    label,
    why,
    qsLog10: qs,
    gnfsLog10: gnfs,
    ecmLog10Balanced: ecm,
    gnfsCpuYears,
    suggestedB: B,
    relationsNeeded: piB + 24,
    matrixMB,
  };
}
