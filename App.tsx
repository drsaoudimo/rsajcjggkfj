import React, { useState } from 'react';
import { A1 } from './constants';
import { MatrixVisualizer } from './components/MatrixVisualizer';
import { QuantumLoader } from './components/QuantumLoader';
import { LatticeVisualizer } from './components/LatticeVisualizer';
import { FormattedArticle } from './components/FormattedArticle';
import { encodeProblemToVector, decodeSolution } from './services/geminiService';
import { solveQuantumSystem } from './services/solverService';
import { AppState, SolverResult } from './types';
import { ResponsiveContainer, BarChart, Bar, Cell, Tooltip, XAxis, YAxis } from 'recharts';

const App: React.FC = () => {
  const [input, setInput] = useState('');
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [activeTab, setActiveTab] = useState<'paper' | 'math'>('paper');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  const handleSolve = async () => {
    if (!input.trim()) return;
    setResult(null);
    setErrorMessage(null);
    setActiveTab('paper');
    setState(AppState.ENCODING);

    try {
      const { vector: bVector, insights } = await encodeProblemToVector(input);

      setState(AppState.CALCULATING);
      const solverOutput = await solveQuantumSystem(bVector, input, insights);

      await new Promise((r) => setTimeout(r, 400));

      setState(AppState.CORRECTING);
      await new Promise((r) => setTimeout(r, 250));

      setState(AppState.DECODING);
      const { summary, article } = await decodeSolution(
        input,
        solverOutput.vectorX,
        bVector,
        insights,
        solverOutput.spectral,
        solverOutput.subsetDetails,
        solverOutput.mode,
        solverOutput.problemType,
        solverOutput.directFactorization
      );

      setResult({
        ...solverOutput,
        solutionText: summary,
        scientificArticle: article,
      });

      setState(AppState.COMPLETED);
    } catch (e: any) {
      console.error(e);
      setErrorMessage(e?.message || null);
      setState(AppState.ERROR);
    }
  };

  const handleCopyReport = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(`${result.solutionText}\n\n${result.scientificArticle}`);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const df = result?.directFactorization;
  const secondTabLabel =
    result?.mode === 'DIRECT_FACTORIZATION'
      ? 'التنفيذ والمقارنات'
      : result?.mode === 'DIRECT_MATH'
      ? 'البيانات التحليلية'
      : 'التحليل المصفوفي';

  return (
    <div className="min-h-screen bg-[#050508] text-slate-200 font-sans selection:bg-cyan-500/30 matrix-bg pb-20" dir="rtl">
      {/* Header */}
      <header className="border-b border-slate-800 bg-[#050508]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
              <span className="font-black text-white text-xl">M</span>
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-l from-white to-slate-400">
                محرك النمذجة المصفوفي
              </h1>
              <p className="text-[10px] font-mono text-cyan-500/80 uppercase tracking-widest">
                Direct Mathematical & Matrix Inference Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {state === AppState.COMPLETED && (
              <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
                <button
                  onClick={() => setActiveTab('paper')}
                  className={`px-4 py-1.5 text-xs rounded-md transition-all ${
                    activeTab === 'paper' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  التقرير العلمي
                </button>
                <button
                  onClick={() => setActiveTab('math')}
                  className={`px-4 py-1.5 text-xs rounded-md transition-all ${
                    activeTab === 'math' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {secondTabLabel}
                </button>
              </div>
            )}
            <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Input Control Panel */}
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-slate-900/40 border border-slate-800 p-8 rounded-2xl backdrop-blur-md shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-[80px] pointer-events-none" />
            <h2 className="text-xl font-black mb-6 flex items-center gap-3 text-white">
              <span className="text-cyan-500">01.</span> تحديد المسألة
            </h2>
            <textarea
              className="w-full bg-black/60 border border-slate-700/50 rounded-xl p-5 text-sm leading-relaxed text-slate-100 focus:border-cyan-500/50 outline-none transition-all resize-y min-h-48 shadow-inner"
              placeholder="اطرح مسألة رياضية مباشرة (مثل تحليل الأعداد والتصادمات التربيعية)، أو مسألة فيزيائية أو مصفوفية..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              onClick={handleSolve}
              disabled={state !== AppState.IDLE && state !== AppState.COMPLETED && state !== AppState.ERROR}
              className="w-full mt-6 py-4 bg-white text-black hover:bg-slate-200 disabled:opacity-50 rounded-xl font-black text-sm uppercase tracking-widest transition-all transform active:scale-95 shadow-[0_10px_30px_rgba(255,255,255,0.1)]"
            >
              {state === AppState.IDLE || state === AppState.COMPLETED || state === AppState.ERROR
                ? 'بدء الاستدلال والحل المباشر'
                : 'جاري التنفيذ والتحليل...'}
            </button>
          </section>

          {result && (
            <section className="space-y-6 animate-fade-in-up">
              <div className="bg-indigo-950/20 border border-indigo-500/20 p-6 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-indigo-400 font-bold text-xs uppercase tracking-widest">
                    Problem Classification
                  </h3>
                  <span
                    dir="ltr"
                    className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-mono text-indigo-300"
                  >
                    {result.problemType}
                  </span>
                </div>
                <div className="space-y-3">
                  {result.modelingInsights.concepts.slice(0, 4).map((c, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>

              {result.mode === 'DIRECT_FACTORIZATION' && df ? (
                <div className="bg-emerald-950/20 border border-emerald-500/25 p-6 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-emerald-400 font-bold text-xs uppercase tracking-widest">
                      Verified BigInt Collision
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                      VERIFIED
                    </span>
                  </div>
                  <div className="space-y-2 text-xs font-mono" dir="ltr">
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">N =</span>
                      <span className="text-white font-bold">{df.primaryN}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">p × q =</span>
                      <span className="text-emerald-300 font-bold">
                        {df.primaryGuided.p} × {df.primaryGuided.q}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">(a, b, k) =</span>
                      <span className="text-cyan-300">
                        ({df.primaryGuided.a}, {df.primaryGuided.b}, k={df.primaryGuided.k})
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">gcd(a-b, N) =</span>
                      <span className="text-white">{df.primaryGuided.gcdValue}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-500">Filter Survival =</span>
                      <span className="text-indigo-300">
                        {(df.theoreticalSurvivalRate * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              ) : result.mode === 'MATRIX' && result.lll.reducedBasis.length > 0 ? (
                <LatticeVisualizer
                  basis={result.lll.reducedBasis.map((row) => row.slice(0, 6))}
                  shortestVector={result.lll.shortestVector}
                />
              ) : null}
            </section>
          )}
        </div>

        {/* Dynamic Content Panel */}
        <div className="lg:col-span-8 space-y-8">
          <div className="min-h-[700px] bg-slate-900/20 border border-slate-800/50 rounded-3xl p-6 sm:p-10 flex flex-col relative overflow-hidden">
            {state === AppState.IDLE && (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-700 text-center max-w-md mx-auto">
                <div className="text-8xl mb-8 font-black opacity-5 select-none">MATRIX</div>
                <h3 className="text-xl font-bold text-slate-400 mb-2">في انتظار المدخلات</h3>
                <p className="text-sm leading-relaxed text-slate-500">
                  أدخل مسألة رياضية أو خوارزمية (مثل تحليل الأعداد والتصادمات التربيعية بـ BigInt) للحصول على حل مباشر مُحقق وبرهان مفصل، أو مسألة مفتوحة لنمذجتها مصفوفياً.
                </p>
              </div>
            )}

            {state !== AppState.IDLE && state !== AppState.COMPLETED && state !== AppState.ERROR && (
              <div className="flex-1 flex flex-col items-center justify-center">
                <QuantumLoader
                  text={
                    state === AppState.ENCODING
                      ? 'تصنيف المسألة واستخراج المعطيات الرياضية الأصلية...'
                      : state === AppState.CALCULATING
                      ? 'تنفيذ الحسابات الحتمية الدقيقة والتحقق من النتائج...'
                      : state === AppState.CORRECTING
                      ? 'تجميع القياسات والمقارنات الخوارزمية...'
                      : 'صياغة الإجابة العلمية المنسقة والبراهين...'
                  }
                />
              </div>
            )}

            {state === AppState.COMPLETED && result && (
              <div className="flex-1 flex flex-col gap-8 z-10 animate-fade-in">
                {activeTab === 'paper' ? (
                  /* Formatted Scientific Report / Direct Answer View */
                  <div className="bg-white/[0.02] p-6 sm:p-10 rounded-3xl border border-white/5 shadow-2xl space-y-8">
                    <div className="space-y-4 border-b border-white/10 pb-8">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span
                          dir="ltr"
                          className="px-2.5 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-[10px] font-mono text-cyan-400 uppercase tracking-widest"
                        >
                          {result.mode === 'DIRECT_FACTORIZATION'
                            ? 'Direct BigInt Execution'
                            : result.mode === 'DIRECT_MATH'
                            ? 'Direct Mathematical Proof'
                            : 'A-guided Matrix Inference'}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyReport}
                          className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition-colors"
                        >
                          {copiedReport ? 'تم نسخ التقرير' : 'نسخ التقرير'}
                        </button>
                      </div>

                      <h2 className="text-xl sm:text-2xl font-black text-white leading-relaxed">
                        {result.solutionText}
                      </h2>

                      <div className="flex flex-wrap gap-4 sm:gap-6 text-[11px] font-mono text-cyan-400/90 uppercase tracking-wider" dir="ltr">
                        <span>Confidence: {(result.confidence * 100).toFixed(1)}%</span>
                        <span>Task: {result.problemType}</span>
                        {df && <span>Verified: {df.primaryGuided.p} × {df.primaryGuided.q}</span>}
                      </div>
                    </div>

                    <div className="max-w-none">
                      <FormattedArticle content={result.scientificArticle} />
                    </div>

                    <div className="pt-8 border-t border-white/10 flex justify-between items-center text-[10px] text-slate-500 font-mono">
                      <span>Direct Mathematical & Matrix Inference Engine</span>
                      <span>{new Date().toLocaleDateString('ar-SA')}</span>
                    </div>
                  </div>
                ) : result.mode === 'DIRECT_FACTORIZATION' && df ? (
                  /* Direct Factorization Execution & Benchmarks Tab */
                  <div className="space-y-8 animate-fade-in">
                    {/* Verification Banner */}
                    <div className="bg-emerald-950/20 border border-emerald-500/25 p-6 rounded-2xl">
                      <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
                        <h3 className="text-emerald-400 font-bold text-xs uppercase tracking-widest">
                          Verified Quadratic Collision Execution (BigInt)
                        </h3>
                        <div className="flex gap-2 text-[10px] font-mono" dir="ltr">
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            a² ≡ b² (mod N): {String(df.primaryGuided.verifiedSquareCongruence)}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                            1 &lt; gcd(a-b,N) &lt; N: {String(df.primaryGuided.verifiedNontrivialGcd)}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center" dir="ltr">
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase">Target N</div>
                          <div className="text-lg font-mono font-bold text-white mt-1">{df.primaryN}</div>
                        </div>
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase">Factors (p × q)</div>
                          <div className="text-lg font-mono font-bold text-emerald-400 mt-1">
                            {df.primaryGuided.p} × {df.primaryGuided.q}
                          </div>
                        </div>
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase">Collision (a, b)</div>
                          <div className="text-lg font-mono font-bold text-cyan-400 mt-1">
                            ({df.primaryGuided.a}, {df.primaryGuided.b})
                          </div>
                        </div>
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-[10px] text-slate-500 uppercase">Auxiliary Moduli</div>
                          <div className="text-xs font-mono font-bold text-indigo-300 mt-2">
                            [{df.auxiliaryModuli.join(', ')}]
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Operation Counts Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" dir="ltr">
                      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 text-center">
                        <div className="text-2xl font-black text-cyan-400 font-mono">
                          {df.primaryGuided.ops.additions}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase mt-1">Additions</div>
                      </div>
                      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 text-center">
                        <div className="text-2xl font-black text-indigo-400 font-mono">
                          {df.primaryGuided.ops.multiplications}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase mt-1">Multiplications</div>
                      </div>
                      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 text-center">
                        <div className="text-2xl font-black text-purple-400 font-mono">
                          {df.primaryGuided.ops.squarings}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase mt-1">Squarings</div>
                      </div>
                      <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800 text-center">
                        <div className="text-2xl font-black text-emerald-400 font-mono">
                          {df.primaryGuided.ops.gcds}
                        </div>
                        <div className="text-[10px] text-slate-400 uppercase mt-1">GCD Calls</div>
                      </div>
                    </div>

                    {/* Algorithm Comparison Chart for Primary N */}
                    <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
                      <div className="flex justify-between items-center mb-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                          Total Core Operations Comparison (N = {df.primaryN})
                        </h4>
                        <span className="text-[10px] font-mono text-cyan-400" dir="ltr">
                          add + mul + sqr + gcd
                        </span>
                      </div>
                      <div className="h-56" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <BarChart
                            data={[
                              {
                                name: 'Modular-Guided',
                                totalOps:
                                  df.primaryGuided.ops.additions +
                                  df.primaryGuided.ops.multiplications +
                                  df.primaryGuided.ops.squarings +
                                  df.primaryGuided.ops.gcds,
                              },
                              {
                                name: 'Unguided',
                                totalOps:
                                  df.primaryUnguided.ops.additions +
                                  df.primaryUnguided.ops.multiplications +
                                  df.primaryUnguided.ops.squarings +
                                  df.primaryUnguided.ops.gcds,
                              },
                              {
                                name: 'Pollard Rho',
                                totalOps:
                                  df.primaryPollardRho.ops.additions +
                                  df.primaryPollardRho.ops.multiplications +
                                  df.primaryPollardRho.ops.squarings +
                                  df.primaryPollardRho.ops.gcds,
                              },
                              {
                                name: 'Quadratic Sieve',
                                totalOps:
                                  df.primaryQuadraticSieve.ops.additions +
                                  df.primaryQuadraticSieve.ops.multiplications +
                                  df.primaryQuadraticSieve.ops.squarings +
                                  df.primaryQuadraticSieve.ops.gcds,
                              },
                            ]}
                          >
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                            <YAxis stroke="#94a3b8" fontSize={11} />
                            <Tooltip
                              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                              contentStyle={{ backgroundColor: '#090d16', border: '1px solid #334155', borderRadius: '8px' }}
                            />
                            <Bar dataKey="totalOps" radius={[6, 6, 0, 0]}>
                              <Cell fill="#06b6d4" />
                              <Cell fill="#64748b" />
                              <Cell fill="#8b5cf6" />
                              <Cell fill="#10b981" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Balanced vs Unbalanced Benchmark Table */}
                    <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                        Balanced & Unbalanced Semiprime Benchmarks
                      </h4>
                      <div className="overflow-x-auto" dir="ltr">
                        <table className="w-full text-xs text-left border-collapse font-mono">
                          <thead>
                            <tr className="border-b border-slate-800 text-cyan-400">
                              <th className="py-3 px-3">Case</th>
                              <th className="py-3 px-3">N (p × q)</th>
                              <th className="py-3 px-3">Guided (eval / pass / sqr)</th>
                              <th className="py-3 px-3">Unguided (sqr / isqrt)</th>
                              <th className="py-3 px-3">Pollard Rho (steps)</th>
                              <th className="py-3 px-3">QS (steps)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70 text-slate-300">
                            {df.benchmarks.map((row, idx) => (
                              <tr key={idx} className="hover:bg-white/[0.02]">
                                <td className="py-3 px-3 text-slate-200">{row.label}</td>
                                <td className="py-3 px-3">
                                  <div>{row.n}</div>
                                  <div className="text-[10px] text-emerald-400">
                                    {row.p} × {row.q}
                                  </div>
                                </td>
                                <td className="py-3 px-3 text-cyan-300">
                                  {row.guided.ops.candidatesEvaluated} / {row.guided.ops.modFilterPassed} /{' '}
                                  {row.guided.ops.squarings}
                                </td>
                                <td className="py-3 px-3 text-slate-400">
                                  {row.unguided.ops.squarings} / {row.unguided.ops.isqrtCalls}
                                </td>
                                <td className="py-3 px-3 text-indigo-300">{row.pollardRho.steps}</td>
                                <td className="py-3 px-3 text-emerald-300">{row.quadraticSieve.steps}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : result.mode === 'DIRECT_MATH' ? (
                  /* Direct Math Structure View */
                  <div className="space-y-6 animate-fade-in">
                    <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-4">
                      <h3 className="text-cyan-400 font-bold text-xs uppercase tracking-widest">
                        Extracted Mathematical Parameters
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-xs text-slate-500 mb-2">المتغيرات</div>
                          <div className="flex flex-wrap gap-2">
                            {result.modelingInsights.variables.map((v, i) => (
                              <span
                                key={i}
                                dir="ltr"
                                className="px-2.5 py-1 rounded bg-indigo-500/10 border border-indigo-500/20 text-xs font-mono text-indigo-300"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="bg-black/40 p-4 rounded-xl border border-slate-800">
                          <div className="text-xs text-slate-500 mb-2">الهدف الرياضي</div>
                          <p className="text-slate-200 text-xs leading-relaxed">
                            {result.modelingInsights.objectiveFunction}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Original Mathematical Analysis View (MATRIX mode) */
                  <div className="space-y-8 animate-fade-in">
                    {result.subsetDetails && (
                      <div className="bg-emerald-950/20 border border-emerald-500/20 p-6 rounded-2xl animate-fade-in">
                        <h3 className="text-emerald-400 font-bold text-xs uppercase tracking-widest mb-4 flex justify-between items-center">
                          Subset Sum Identification (Heuristic)
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              result.subsetDetails.status === 'SAT'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-amber-500/20 text-amber-400'
                            }`}
                          >
                            {result.subsetDetails.status}
                          </span>
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase tracking-tighter">Target Norm</span>
                            <span className="text-xl font-mono text-white">{result.subsetDetails.target}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase tracking-tighter mb-1">Found Elements</span>
                            <div className="flex flex-wrap gap-2">
                              {result.subsetDetails.foundSubset.map((s, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 text-[10px] rounded text-emerald-300"
                                >
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-500 block uppercase tracking-tighter">Residual Energy</span>
                            <span className="text-xl font-mono text-emerald-400">{result.subsetDetails.residual}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <MatrixVisualizer data={A1} title="Constraint Matrix [A1] - Intensity Heatmap" />
                      <MatrixVisualizer data={[result.vectorX]} title="Solution Vector [X]" color="bg-indigo-500" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Spectral Density</h4>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                            <span className="text-slate-500">Cond: {result.spectral.conditionNumber.toFixed(2)}</span>
                            <span className="text-cyan-500 font-bold">
                              LLL Cond: {result.spectral.lllConditionNumber.toFixed(2)}
                            </span>
                          </div>
                        </div>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart data={result.spectral.singularValues.map((v, i) => ({ n: i + 1, v }))}>
                              <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                                {result.spectral.singularValues.map((v, i) => (
                                  <Cell key={i} fill={v > 200 ? '#8b5cf6' : '#475569'} />
                                ))}
                              </Bar>
                              <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ backgroundColor: '#000', border: 'none' }} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 flex flex-col justify-center items-center text-center">
                        <div className="text-4xl font-black text-cyan-500 mb-2">{result.integralityGap.toFixed(4)}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Integrality Gap</div>
                        <p className="text-[10px] text-slate-600 mt-4 max-w-[200px]">
                          مدى دقة التقريب من الحل المستمر إلى الفضاء المتقطع [0,1].
                        </p>
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-8 rounded-2xl border border-slate-800">
                      <h4 className="text-xs font-bold text-slate-500 uppercase mb-6 tracking-widest">
                        Stiffness vs Sloppiness Analysis
                      </h4>
                      <div className="flex gap-10">
                        <div className="flex-1">
                          <div className="text-2xl font-bold text-indigo-400">{result.spectral.stiffDirections}</div>
                          <div className="text-[10px] text-slate-500">Stiff Directions (Sensitive)</div>
                          <div className="w-full h-1 bg-slate-800 mt-2 overflow-hidden rounded-full">
                            <div
                              className="h-full bg-indigo-500"
                              style={{
                                width: `${
                                  (result.spectral.stiffDirections / (result.spectral.singularValues.length || 1)) * 100
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="text-2xl font-bold text-emerald-400">{result.spectral.sloppyDirections}</div>
                          <div className="text-[10px] text-slate-500">Sloppy Directions (Flexible)</div>
                          <div className="w-full h-1 bg-slate-800 mt-2 overflow-hidden rounded-full">
                            <div
                              className="h-full bg-emerald-500"
                              style={{
                                width: `${
                                  (result.spectral.sloppyDirections / (result.spectral.singularValues.length || 1)) * 100
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {state === AppState.ERROR && (
              <div className="flex-1 flex flex-col items-center justify-center text-red-400">
                <div className="text-5xl mb-4">⚠️</div>
                <p className="font-bold">فشل النظام في التقارب نحو حالة مستقرة.</p>
                <p className="text-xs opacity-60 mt-2 text-center max-w-md">
                  {errorMessage || 'Matrix Singular or Ill-Conditioned.'}
                </p>
                <button
                  onClick={() => setState(AppState.IDLE)}
                  className="mt-8 px-6 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs hover:bg-red-500/20 transition-all"
                >
                  إعادة تهيئة المحرك
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
