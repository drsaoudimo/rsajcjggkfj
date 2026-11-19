import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import { generate, runStage } from "@/lib/factor/factor.functions";
import { detectSpecialForm, feasibility } from "@/lib/factor/analysis";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مختبر الأعداد شبه الأولية — توليد وتحليل حقيقي" },
      { name: "description", content: "ولّد N = p × q بأي حجم وحلّله فعلياً على الخادم: Rho وp−1 وECM والغربال التربيعي." },
      { property: "og:title", content: "مختبر الأعداد شبه الأولية" },
      { property: "og:description", content: "تحليل حقيقي للأعداد شبه الأولية بخوارزميات هجينة مع تقدير الجدوى." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Lab,
});

type StageKey = "trial" | "rho" | "pm1" | "ecm" | "cfrac" | "qs";
const STAGES: { key: StageKey; name: string; note: string }[] = [
  { key: "trial", name: "القسمة التجريبية", note: "أوليات ≤ 200,000" },
  { key: "rho", name: "Pollard ρ (Brent)", note: "~√p خطوة، دالة واحدة لكل خطوة" },
  { key: "pm1", name: "Pollard p−1", note: "إذا كان p−1 أملس" },
  { key: "ecm", name: "ECM (Suyama)", note: "يعتمد على حجم أصغر عامل" },
  { key: "cfrac", name: "الكسور المستمرة CFRAC", note: "تقاربات √N + GF(2)" },
  { key: "qs", name: "الغربال التربيعي", note: "Legendre + Uint8 + GF(2)" },
];

interface LogRow {
  stage: StageKey;
  status: "run" | "ok" | "miss" | "skip" | "stop";
  ms: number;
  calls: number;
  detail: string;
}
interface HistoryRow {
  n: string;
  bits: number;
  factor: string | null;
  method: string | null;
  ms: number;
}

const bitsOf = (s: string) => (s && /^\d+$/.test(s) ? BigInt(s).toString(2).length : 0);
const fmtMs = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtYears = (y: number) =>
  y < 1 / 365 / 24 ? "أقل من ساعة" : y < 1 / 365 ? `${(y * 365 * 24).toFixed(1)} ساعة` : y < 1 ? `${(y * 365).toFixed(1)} يوم` : `${y.toExponential(2)} سنة-CPU`;

function Lab() {
  const gen = useServerFn(generate);
  const run = useServerFn(runStage);
  const [bits, setBits] = useState(96);
  const [smallBits, setSmallBits] = useState<number | "">("");
  const [n, setN] = useState("");
  const [secret, setSecret] = useState<{ p: string; q: string } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [enabled, setEnabled] = useState<Record<StageKey, boolean>>({ trial: true, rho: true, pm1: true, ecm: true, cfrac: false, qs: true });
  const [maxSeconds, setMaxSeconds] = useState(120);
  const [log, setLog] = useState<LogRow[]>([]);
  const [result, setResult] = useState<{ p: string; q: string; method: string; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const cancel = useRef(false);

  const nBits = bitsOf(n);
  const feas = useMemo(() => (nBits ? feasibility(nBits) : null), [nBits]);
  const special = useMemo(() => (n && nBits <= 4096 ? detectSpecialForm(BigInt(n)) : null), [n, nBits]);

  async function onGenerate() {
    setError(null);
    setResult(null);
    setLog([]);
    try {
      const r = await gen({ data: { bits, smallBits: smallBits === "" ? null : smallBits } });
      setN(r.n);
      setSecret({ p: r.p, q: r.q });
      setReveal(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onFactor() {
    if (!n) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLog([]);
    cancel.current = false;
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 200);
    const deadline = start + maxSeconds * 1000;
    const push = (row: LogRow) => setLog((l) => [...l.filter((x) => x.stage !== row.stage), row]);
    let found: { f: string; method: string } | null = null;
    try {
      const chk = (await run({ data: { n, stage: "check" } })) as unknown as { prime: boolean };
      if (chk.prime) {
        setError("هذا العدد أولي (Miller-Rabin)، لا يوجد ما يُحلَّل.");
        return;
      }
      const order: StageKey[] = ["trial", "rho", "pm1", "ecm", "cfrac", "qs"];
      const active = order.filter((k) => enabled[k]);
      // share remaining time: rho/ecm get repeated calls, qs gets one long call
      for (const key of active) {
        if (found || cancel.current) break;
        const name = STAGES.find((s) => s.key === key)!.name;
        let ms = 0;
        let calls = 0;
        const stageEnd =
          key === "rho" ? Math.min(deadline, performance.now() + maxSeconds * 250)
          : key === "ecm" ? Math.min(deadline, performance.now() + maxSeconds * 400)
          : deadline;
        if (key === "cfrac" && nBits > 150) {
          push({ stage: key, status: "skip", ms: 0, calls: 0, detail: "تخطي: CFRAC غير مجدٍ فوق 150 بت" });
          continue;
        }
        if (key === "qs" && nBits > 200) {
          push({ stage: key, status: "skip", ms: 0, calls: 0, detail: "تخطي: QS غير مجدٍ فوق 200 بت" });
          continue;
        }
        let rho: { c: string; x: string; y: string; iters: number; r?: number; k?: number } | undefined;
        let sigma = 11;
        let curves = 0;
        let detail = "";
        do {
          push({ stage: key, status: "run", ms, calls, detail: detail || "يعمل…" });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r: any = await run({
            data: {
              n,
              stage: key,
              rho,
              sigma,
              B1: key === "ecm" ? (nBits > 160 ? 250000 : nBits > 110 ? 50000 : 11000) : undefined,
            },
          });
          calls++;
          ms += r.ms;
          if (key === "trial") detail = r.detail;
          if (key === "rho") {
            rho = r.rho;
            detail = `${r.rho.iters.toLocaleString("en")} تكرار، c = ${r.rho.c}`;
          }
          if (key === "pm1") detail = `B1 = ${r.B1.toLocaleString("en")}${r.completed ? "" : " (لم يكتمل)"}`;
          if (key === "ecm") {
            sigma = r.nextSigma;
            curves += r.curves;
            detail = `${curves} منحنى، B1 = ${r.B1.toLocaleString("en")}، B2 = ${r.B2.toLocaleString("en")}`;
          }
          if (key === "cfrac") {
            const s = r.stats;
            detail = `B = ${s.bound.toLocaleString("en")}، قاعدة ${s.fbSize}، ${s.steps.toLocaleString("en")} تقارب، ${s.relations} علاقة، ${fmtMs(s.sieveMs)} + GF(2) ${fmtMs(s.laMs)}${r.reason ? ` — ${r.reason}` : ""}`;
          }
          if (key === "qs") {
            const s = r.stats;
            detail = `B = ${s.bound.toLocaleString("en")}، قاعدة ${s.fbSize} أولي، ${s.relations} علاقة، ${s.blocks} كتلة، غربلة ${fmtMs(s.sieveMs)}، GF(2) ${fmtMs(s.laMs)}${r.reason ? ` — ${r.reason}` : ""}`;
          }
          if (r.factor) {
            found = { f: r.factor, method: name };
            break;
          }
        } while ((key === "rho" || key === "ecm") && !cancel.current && performance.now() < stageEnd);
        push({ stage: key, status: found ? "ok" : cancel.current ? "stop" : "miss", ms, calls, detail });
      }
      const total = performance.now() - start;
      if (found) {
        const F = BigInt(found.f);
        const N = BigInt(n);
        const other = N / F;
        if (F * other !== N) throw new Error("فشل التحقق p × q = N");
        const [p, q] = F < other ? [F, other] : [other, F];
        setResult({ p: p.toString(), q: q.toString(), method: found.method, ms: total });
      }
      setHistory((h) => [{ n, bits: nBits, factor: found?.f ?? null, method: found?.method ?? null, ms: total }, ...h].slice(0, 12));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(timer);
      setElapsed(performance.now() - start);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid-paper bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        <header className="mb-8">
          <p className="num text-xs text-muted-foreground">N = p × q</p>
          <h1 className="font-display text-3xl md:text-5xl text-primary">مختبر الأعداد شبه الأولية</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            توليد حقيقي بـ Miller-Rabin، وتحليل حقيقي على الخادم بالاستراتيجية الهجينة: قسمة، ρ، p−1، ECM، ثم الغربال التربيعي.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-xl mb-4">١. التوليد</h2>
            <label className="block text-sm text-muted-foreground">حجم N بالبت: <span className="num text-foreground">{bits}</span></label>
            <input type="range" min={16} max={1024} step={4} value={bits} onChange={(e) => setBits(+e.target.value)} className="w-full accent-primary" dir="ltr" />
            <div className="mt-3 flex items-center gap-2 text-sm">
              <label className="text-muted-foreground">حجم العامل الصغير (اختياري):</label>
              <input type="number" min={4} value={smallBits} placeholder="متوازن" onChange={(e) => setSmallBits(e.target.value === "" ? "" : +e.target.value)} className="num w-24 rounded border border-input bg-background px-2 py-1" />
            </div>
            <button onClick={onGenerate} disabled={busy} className="mt-4 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              ولّد عدداً شبه أولي
            </button>
            <label className="mt-4 block text-sm text-muted-foreground">أو أدخل N يدوياً:</label>
            <textarea value={n} onChange={(e) => { setN(e.target.value.replace(/\D/g, "")); setSecret(null); }} rows={3} className="num mt-1 w-full rounded border border-input bg-background p-2 text-sm" />
            <p className="mt-1 text-xs text-muted-foreground"><span className="num">{nBits}</span> بت · <span className="num">{n.length}</span> رقم عشري</p>
            {secret && (
              <button onClick={() => setReveal((r) => !r)} className="mt-2 text-xs text-accent underline">
                {reveal ? "إخفاء" : "كشف"} العاملين الأصليين
              </button>
            )}
            {secret && reveal && <p className="num mt-1 text-xs text-muted-foreground">p = {secret.p}<br />q = {secret.q}</p>}
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-xl mb-4">٢. الجدوى والشكل</h2>
            {!feas ? (
              <p className="text-muted-foreground">ولّد أو أدخل عدداً.</p>
            ) : (
              <>
                <div className="mb-3 rounded border border-border p-3">
                  <p className="text-sm text-muted-foreground">الشكل الخاص (SNFS):</p>
                  <p className={special ? "text-accent font-medium" : ""}>
                    {special ? <>{special.kind}: <span className="num">{special.expr}</span> → SNFS أسرع بكثير</> : "عدد عام → GNFS/QS"}
                  </p>
                </div>
                <p className="font-display text-2xl text-primary">{feas.label}</p>
                <p className="text-sm text-muted-foreground">{feas.why}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">QS · L[1/2, 1]</dt><dd className="num">10^{feas.qsLog10.toFixed(1)}</dd>
                  <dt className="text-muted-foreground">GNFS · L[1/3, 1.923]</dt><dd className="num">10^{feas.gnfsLog10.toFixed(1)}</dd>
                  <dt className="text-muted-foreground">ECM لعامل متوازن</dt><dd className="num">10^{feas.ecmLog10Balanced.toFixed(1)}</dd>
                  <dt className="text-muted-foreground">B الأمثل</dt><dd className="num">{feas.suggestedB.toLocaleString("en")}</dd>
                  <dt className="text-muted-foreground">العلاقات المطلوبة</dt><dd className="num">≈ {feas.relationsNeeded.toLocaleString("en")}</dd>
                  <dt className="text-muted-foreground">مصفوفة GF(2) كثيفة</dt><dd className="num">{feas.matrixMB < 1 ? `${(feas.matrixMB * 1000).toFixed(0)} KB` : `${feas.matrixMB.toFixed(0)} MB`}</dd>
                  <dt className="text-muted-foreground">GNFS (معايرة RSA-512)</dt><dd>{fmtYears(feas.gnfsCpuYears)}</dd>
                </dl>
              </>
            )}
          </div>
        </section>

        <CopperPanel n={n} secret={secret} nBits={nBits} />

        <section className="mt-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">٣. التحليل الحقيقي</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">أقصى مدة:</span>
              <select value={maxSeconds} onChange={(e) => setMaxSeconds(+e.target.value)} className="rounded border border-input bg-background px-2 py-1">
                {[30, 60, 120, 300, 600].map((s) => <option key={s} value={s}>{s} ث</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {STAGES.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-1 text-sm">
                <input type="checkbox" checked={enabled[s.key]} onChange={(e) => setEnabled({ ...enabled, [s.key]: e.target.checked })} className="accent-primary" />
                {s.name}
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={onFactor} disabled={busy || !n} className="flex-1 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {busy ? `يحلّل… ${fmtMs(elapsed)}` : "حلّل N"}
            </button>
            {busy && (
              <button onClick={() => (cancel.current = true)} className="rounded-md border border-destructive px-4 py-2 text-destructive">إلغاء</button>
            )}
          </div>

          {error && <p className="mt-3 text-destructive">{error}</p>}

          {log.length > 0 && (
            <ol className="mt-4 space-y-2">
              {log.map((r) => {
                const s = STAGES.find((x) => x.key === r.stage)!;
                const tone = r.status === "ok" ? "border-primary text-primary" : r.status === "run" ? "border-accent text-accent" : "border-border text-muted-foreground";
                const label = { run: "يعمل", ok: "وُجد عامل", miss: "لم يجد", skip: "تخطي", stop: "أُلغي" }[r.status];
                return (
                  <li key={r.stage} className={`rounded border p-3 ${tone}`}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{s.name} <span className="text-xs text-muted-foreground">· {s.note}</span></span>
                      <span className="text-sm">{label} · <span className="num">{fmtMs(r.ms)}</span> · <span className="num">{r.calls}</span> طلب</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                  </li>
                );
              })}
            </ol>
          )}

          {result && (
            <div className="mt-4 rounded-lg border-2 border-primary p-4">
              <p className="font-display text-xl text-primary">تم التحليل بـ {result.method} في <span className="num">{fmtMs(result.ms)}</span></p>
              <p className="num mt-2 text-sm">p = {result.p}</p>
              <p className="num text-sm">q = {result.q}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                تحقق: p × q = N ✓ · p أولي: {String(bitsOf(result.p))} بت · q: {String(bitsOf(result.q))} بت
                {secret && (secret.p === result.p ? " · يطابق العاملين الأصليين ✓" : "")}
              </p>
            </div>
          )}
          {!busy && log.length > 0 && !result && !error && (
            <p className="mt-4 text-accent">لم يُعثر على عامل ضمن الوقت المحدد. {feas && feas.bits > 120 ? "هذا متوقع لهذا الحجم — انظر تقدير الجدوى." : "جرّب مدة أطول."}</p>
          )}
        </section>

        {history.length > 0 && (
          <section className="mt-4 rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-xl mb-3">السجل</h2>
            <ul className="space-y-1 text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-border py-1">
                  <span><span className="num">{h.bits}</span> بت · {h.method ?? "لم يُحلّل"}</span>
                  <span className="num text-muted-foreground">{fmtMs(h.ms)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function CopperPanel({ n, secret, nBits }: { n: string; secret: { p: string; q: string } | null; nBits: number }) {
  const run = useServerFn(runStage);
  const [pct, setPct] = useState(60);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const p = secret ? BigInt(secret.p) : null;
  const pBits = p ? p.toString(2).length : 0;
  const unknown = Math.max(1, pBits - Math.round((pBits * pct) / 100));
  const limit = Math.floor(nBits / 4);
  const high = p ? (p >> BigInt(unknown)) << BigInt(unknown) : null;

  async function go() {
    if (!high) return;
    setBusy(true);
    setOut(null);
    setOk(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await run({ data: { n, stage: "copper", high: high.toString(), unknownBits: unknown } });
      const s = r.stats;
      setOk(!!r.factor);
      setOut(
        (r.factor ? `p = ${r.factor}\n` : "لم يُعثر على الجذر — زِد نسبة البتات المعروفة.\n") +
          `شبيكة ${s.dim}×${s.dim} (m = ${s.m})، ${s.swaps} تبديل LLL، LLL ${fmtMs(s.lllMs)}، الإجمالي ${fmtMs(r.ms)}`,
      );
    } catch (e) {
      setOut((e as Error).message);
      setOk(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-border bg-card p-5">
      <h2 className="font-display text-xl mb-2">كوبرسميث: شبيكات LLL مع معلومة جزئية</h2>
      <p className="text-sm text-muted-foreground mb-3">
        نعطي البتات العليا من p ونبني شبيكة من <span className="num" dir="ltr">N^(m−i)·f^i</span> و<span className="num" dir="ltr">x^j·f^m</span> حيث <span className="num" dir="ltr">f(x) = x + p̃</span>، ثم يجد LLL كثيرة حدود جذرها البتات المجهولة على الأعداد الصحيحة. الحد النظري: المجهول أقل من <span className="num" dir="ltr">N^(1/4)</span>.
      </p>
      {!p ? (
        <p className="text-sm text-muted-foreground">ولّد عدداً أولاً ليُؤخذ التلميح من p الحقيقي.</p>
      ) : (
        <>
          <label className="block text-sm text-muted-foreground">
            نسبة البتات المعروفة من p: <span className="num text-foreground">{pct}%</span> — مجهول <span className="num text-foreground">{unknown}</span> بت من <span className="num">{pBits}</span> (الحد ≈ <span className="num">{limit}</span>)
          </label>
          <input type="range" min={40} max={95} value={pct} onChange={(e) => setPct(+e.target.value)} className="w-full accent-primary" dir="ltr" />
          {unknown > limit - 8 && <p className="text-xs text-destructive">قريب من الحد النظري أو فوقه؛ قد يفشل أو يحتاج شبيكة أكبر.</p>}
          <p className="num mt-2 break-all text-xs text-muted-foreground" dir="ltr">p̃ = {high!.toString()}</p>
          <button onClick={go} disabled={busy} className="mt-3 w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {busy ? "يقلّص الشبيكة…" : "استخرج p بالشبيكات"}
          </button>
          {out && <pre className={`num mt-3 whitespace-pre-wrap break-all text-xs ${ok ? "text-accent" : "text-destructive"}`} dir="ltr">{out}</pre>}
        </>
      )}
    </section>
  );
}
