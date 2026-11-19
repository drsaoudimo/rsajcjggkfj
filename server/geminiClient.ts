import { GoogleGenAI, Type, ThinkingLevel, GenerateContentResponse } from "@google/genai";
import type { DirectFactorizationReport } from "../utils/factorizationSolvers.ts";

export type ProblemType =
  | 'QUADRATIC_COLLISION'
  | 'INTEGER_FACTORIZATION'
  | 'POLLARD_RHO'
  | 'FERMAT_FACTORIZATION'
  | 'SUBSET_SUM'
  | 'LINEAR_MATRIX'
  | 'DIRECT_MATH_PROOF';

export interface ModelingInsights {
  concepts: string[];
  variables: string[];
  causality: string;
  objectiveFunction: string;
  problemType?: ProblemType;
  extractedN?: string | null;
  requiresMatrixInference?: boolean;
}

export interface SpectralSummary {
  singularValues?: number[];
  conditionNumber?: number;
  lllConditionNumber?: number;
  orthogonalityDefect?: number;
  stiffDirections: number;
  sloppyDirections: number;
}

export interface SubsetSummary {
  isSubsetSum: boolean;
  foundSubset: string[];
  target: string;
  residual: string;
  status: 'SAT' | 'UNSAT' | 'APPROX';
}

export class GeminiApiError extends Error {
  status: number;
  constructor(message: string, status: number = 500) {
    super(message);
    this.name = 'GeminiApiError';
    this.status = status;
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
    throw new GeminiApiError(
      'GEMINI_API_KEY is not configured on the server. Please set it in Settings > Secrets.',
      500
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 35000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractErrorDetails(error: any): { status: number; message: string } {
  let status = error?.status ?? error?.code;
  let rawMessage = String(error?.message ?? 'Unknown Gemini API error');

  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed?.error) {
      if (typeof parsed.error.code === 'number') status = parsed.error.code;
      if (typeof parsed.error.message === 'string') rawMessage = parsed.error.message;
    }
  } catch {
    // rawMessage is already plain text
  }

  if (typeof status !== 'number' || status < 400 || status >= 600) {
    if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) status = 429;
    else if (rawMessage.includes('UNAVAILABLE') || rawMessage.includes('503')) status = 503;
    else if (rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('403')) status = 403;
    else if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('400')) status = 400;
    else if (rawMessage.includes('NOT_FOUND') || rawMessage.includes('404')) status = 404;
    else if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || rawMessage.toLowerCase().includes('timeout')) status = 504;
    else status = 502;
  }

  return { status, message: rawMessage };
}

function isTransientError(error: any): boolean {
  const { status, message } = extractErrorDetails(error);
  return (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    error?.name === 'AbortError' ||
    error?.name === 'TimeoutError' ||
    message.toLowerCase().includes('quota') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('UNAVAILABLE') ||
    message.toLowerCase().includes('high demand') ||
    message.toLowerCase().includes('timeout')
  );
}

async function generateWithFallback(
  ai: GoogleGenAI,
  buildParams: (model: string, isHydrogen: boolean) => any,
  timeoutMs: number = 14000
): Promise<GenerateContentResponse> {
  const attempts: Array<{ model: string; isHydrogen: boolean; retries: number }> = [
    { model: "gemini-4-hydrogen", isHydrogen: true, retries: 1 },
    { model: "gemini-3.1-flash-lite", isHydrogen: false, retries: 1 },
  ];

  let lastError: any;
  for (const attempt of attempts) {
    let remaining = attempt.retries;
    let delay = 800;
    while (true) {
      try {
        const built = buildParams(attempt.model, attempt.isHydrogen);
        return await ai.models.generateContent({
          ...built,
          config: {
            ...built.config,
            abortSignal: AbortSignal.timeout(timeoutMs),
          },
        });
      } catch (err: any) {
        lastError = err;
        const { status } = extractErrorDetails(err);
        if (status === 400 || status === 401 || status === 403 || status === 404) {
          throw err;
        }
        if (status === 504 || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
          break;
        }
        if (remaining > 0 && isTransientError(err)) {
          remaining--;
          await wait(delay * (1 + Math.random() * 0.3));
          delay *= 2;
          continue;
        }
        break;
      }
    }
    if (!isTransientError(lastError)) {
      break;
    }
  }
  throw lastError;
}

function detectExplicitTask(text: string): {
  problemType?: ProblemType;
  extractedN?: string;
} {
  const lower = text.toLowerCase();

  // Extract explicit N = <digits>
  const nMatch = text.match(/\bN\s*=\s*(\d{4,})\b/i) || text.match(/(?:العدد|شبه أولي|تحليل)\D{0,25}(\d{5,})/);
  const extractedN = nMatch ? nMatch[1] : undefined;

  if (
    lower.includes('quadratic collision') ||
    lower.includes('تصادم') ||
    (lower.includes('a^2') && lower.includes('b^2')) ||
    lower.includes('gcd(a-b') ||
    lower.includes('zf-4')
  ) {
    return { problemType: 'QUADRATIC_COLLISION', extractedN };
  }
  if (lower.includes('pollard')) {
    return { problemType: 'POLLARD_RHO', extractedN };
  }
  if (lower.includes('fermat')) {
    return { problemType: 'FERMAT_FACTORIZATION', extractedN };
  }
  if (
    extractedN &&
    (lower.includes('factor') ||
      lower.includes('semiprime') ||
      lower.includes('شبه أولي') ||
      lower.includes('تحليل') ||
      lower.includes('p×q') ||
      lower.includes('p*q') ||
      lower.includes('n=pq'))
  ) {
    return { problemType: 'INTEGER_FACTORIZATION', extractedN };
  }
  if (
    lower.includes('برهان') ||
    lower.includes('أثبت') ||
    lower.includes('إثبات') ||
    lower.includes('اشتقاق') ||
    lower.includes('خوارزمية') ||
    lower.includes('prove') ||
    lower.includes('bigint')
  ) {
    return { problemType: 'DIRECT_MATH_PROOF', extractedN };
  }
  return { extractedN };
}

export async function encodeProblemToVectorServer(
  problemText: string
): Promise<{ vector: number[]; insights: ModelingInsights }> {
  const ai = getGeminiClient();
  const heuristic = detectExplicitTask(problemText);

  try {
    const response = await generateWithFallback(
      ai,
      (model, isHydrogen) => ({
        model,
        contents: `قم بتحليل المسألة التالية وتصنيف نوعها الرياضي بدقة دون استبدال نوع المسألة بنوع آخر.
النص: "${problemText}"

القواعد الإلزامية:
- حدد problemType بدقة من بين:
  - QUADRATIC_COLLISION: إذا طُلب إيجاد تصادمات تربيعية a^2 ≡ b^2 (mod N) مع 1 < gcd(a-b, N) < N.
  - INTEGER_FACTORIZATION: إذا طُلب تحليل عدد N = pq إلى عاملين غير تافهين.
  - POLLARD_RHO: إذا كانت المسألة مخصصة لخوارزمية Pollard Rho.
  - FERMAT_FACTORIZATION: إذا كانت مخصصة لتحليل فيرما.
  - SUBSET_SUM: فقط إذا ذكر الطلب مجموعة أعداد وهدف مجموع جزئي صراحة.
  - LINEAR_MATRIX: إذا طُلب نمذجة نظام مصفوفي Ax=b أو مسألة مفتوحة/فلسفية/فيزيائية تحتاج نمذجة مصفوفية.
  - DIRECT_MATH_PROOF: إذا كانت مسألة رياضية أو برمجية أو برهانية مباشرة (غير مصفوفية).
- إذا ورد عدد N محدد في النص (مثل N=100160063)، ضعه في extractedN كما هو حرفياً كسلسلة رقمية، وإلا اجعله "".
- استخرج المفاهيم الأساسية والمتغيرات ودالة الهدف الحقيقية للمسألة الأصلية، ورمّز متجه b من 19 رقماً (0-1000).

أرجع الإجابة بتنسيق JSON حصراً.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              problemType: { type: Type.STRING },
              extractedN: { type: Type.STRING },
              requiresMatrixInference: { type: Type.BOOLEAN },
              vector: { type: Type.ARRAY, items: { type: Type.INTEGER } },
              concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
              variables: { type: Type.ARRAY, items: { type: Type.STRING } },
              causality: { type: Type.STRING },
              objectiveFunction: { type: Type.STRING },
            },
            required: [
              "problemType",
              "extractedN",
              "requiresMatrixInference",
              "vector",
              "concepts",
              "variables",
              "causality",
              "objectiveFunction",
            ],
          },
          thinkingConfig: {
            thinkingLevel: isHydrogen ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
          },
        },
      }),
      14000
    );

    const parsed = JSON.parse(response.text || "{}");
    const rawVector: number[] = Array.isArray(parsed.vector)
      ? parsed.vector.map(Number)
      : [];
    const vector = Array.from({ length: 19 }, (_, idx) =>
      Number.isFinite(rawVector[idx]) ? rawVector[idx] : 0
    );

    const validTypes: ProblemType[] = [
      'QUADRATIC_COLLISION',
      'INTEGER_FACTORIZATION',
      'POLLARD_RHO',
      'FERMAT_FACTORIZATION',
      'SUBSET_SUM',
      'LINEAR_MATRIX',
      'DIRECT_MATH_PROOF',
    ];
    let problemType: ProblemType = validTypes.includes(parsed.problemType)
      ? parsed.problemType
      : 'LINEAR_MATRIX';

    // Strict preservation: never let an explicit factorization/collision task be downgraded to SUBSET_SUM or LINEAR_MATRIX
    if (heuristic.problemType && (problemType === 'SUBSET_SUM' || problemType === 'LINEAR_MATRIX')) {
      problemType = heuristic.problemType;
    }

    const extractedN =
      heuristic.extractedN ||
      (typeof parsed.extractedN === 'string' && /^\d{4,}$/.test(parsed.extractedN.trim())
        ? parsed.extractedN.trim()
        : null);

    const isDirectMode =
      problemType === 'QUADRATIC_COLLISION' ||
      problemType === 'INTEGER_FACTORIZATION' ||
      problemType === 'POLLARD_RHO' ||
      problemType === 'FERMAT_FACTORIZATION' ||
      problemType === 'DIRECT_MATH_PROOF';

    return {
      vector,
      insights: {
        concepts: Array.isArray(parsed.concepts) ? parsed.concepts : [],
        variables: Array.isArray(parsed.variables) ? parsed.variables : [],
        causality: typeof parsed.causality === "string" ? parsed.causality : "",
        objectiveFunction:
          typeof parsed.objectiveFunction === "string"
            ? parsed.objectiveFunction
            : "",
        problemType,
        extractedN,
        requiresMatrixInference: !isDirectMode && Boolean(parsed.requiresMatrixInference),
      },
    };
  } catch (error: any) {
    if (error instanceof GeminiApiError) throw error;
    const { status, message } = extractErrorDetails(error);
    throw new GeminiApiError(message, status);
  }
}

export async function decodeSolutionServer(params: {
  originalProblem: string;
  vectorX: number[];
  vectorB: number[];
  insights: ModelingInsights;
  spectral: SpectralSummary;
  subsetDetails?: SubsetSummary;
  mode?: 'DIRECT_FACTORIZATION' | 'DIRECT_MATH' | 'MATRIX';
  problemType?: ProblemType;
  directFactorization?: DirectFactorizationReport;
}): Promise<{ summary: string; article: string }> {
  const ai = getGeminiClient();
  const {
    originalProblem,
    vectorX,
    insights,
    spectral,
    mode = 'MATRIX',
    problemType = 'LINEAR_MATRIX',
    directFactorization,
  } = params;

  const variablesText = Array.isArray(insights?.variables)
    ? insights.variables.join(", ")
    : "";

  let prompt = "";

  if (mode === 'DIRECT_FACTORIZATION' && directFactorization) {
    const g = directFactorization.primaryGuided;
    const u = directFactorization.primaryUnguided;
    const rho = directFactorization.primaryPollardRho;
    const qs = directFactorization.primaryQuadraticSieve;

    const benchmarkSummary = directFactorization.benchmarks
      .map(
        (b) =>
          `- [${b.category}] N=${b.n} (p=${b.p}, q=${b.q}): Guided(k=${b.guided.k}, a=${b.guided.a}, b=${b.guided.b}, eval=${b.guided.ops.candidatesEvaluated}, passed=${b.guided.ops.modFilterPassed}, add=${b.guided.ops.additions}, mul=${b.guided.ops.multiplications}, sqr=${b.guided.ops.squarings}, gcd=${b.guided.ops.gcds}, ms=${b.guided.elapsedMs}) | Unguided(eval=${b.unguided.ops.candidatesEvaluated}, sqr=${b.unguided.ops.squarings}, isqrt=${b.unguided.ops.isqrtCalls}, ms=${b.unguided.elapsedMs}) | PollardRho(factor=${b.pollardRho.factorFound}, steps=${b.pollardRho.steps}, add=${b.pollardRho.ops.additions}, sqr=${b.pollardRho.ops.squarings}, gcd=${b.pollardRho.ops.gcds}, ms=${b.pollardRho.elapsedMs}) | QS(factor=${b.quadraticSieve.factorFound}, steps=${b.quadraticSieve.steps}, add=${b.quadraticSieve.ops.additions}, mul=${b.quadraticSieve.ops.multiplications}, sqr=${b.quadraticSieve.ops.squarings}, gcd=${b.quadraticSieve.ops.gcds}, ms=${b.quadraticSieve.elapsedMs})`
      )
      .join("\n");

    prompt = `
أنت عالم رياضيات خبير في نظرية الأعداد الحسابية والخوارزميات الحتمية.
المطلوب: تقديم **حل مباشر وكامل ومفصل** لكل سؤال وبند في المسألة التالية دون استبدالها بـ Subset Sum أو LLL أو SVD.

نص المسألة الأصلية:
"""
${originalProblem}
"""

نوع المسألة المحدد: ${problemType}
النتائج التنفيذية الفعلية المحسوبة حتمياً باستخدام BigInt (تُستخدم هذه الأرقام الفعلية بدقة كما هي دون تغيير):
- العدد الأصلي: N = ${directFactorization.primaryN}
- الموديولات المساعدة المستخدمة (بدون معرفة p, q): [${directFactorization.auxiliaryModuli.join(", ")}]
- نسبة البقاء النظرية للمرشح الموديولي: ${(directFactorization.theoreticalSurvivalRate * 100).toFixed(4)}%
- نتيجة الخوارزمية الموجهة بالموديولات (Modular-Guided):
  p = ${g.p}, q = ${g.q}, k = ${g.k}, a = ${g.a}, b = ${g.b}, gcd(a-b, N) = ${g.gcdValue}
  تحقق a^2 ≡ b^2 (mod N): ${g.verifiedSquareCongruence}, تحقق 1 < gcd(a-b, N) < N: ${g.verifiedNontrivialGcd}, تحقق p×q=N: ${g.verifiedProduct}
  العمليات: جمع=${g.ops.additions}, ضرب=${g.ops.multiplications}, تربيع=${g.ops.squarings}, GCD=${g.ops.gcds}, فحوصات المرشح=${g.ops.modFilterChecks}, ناجحون=${g.ops.modFilterPassed}, isqrt=${g.ops.isqrtCalls}, الزمن=${g.elapsedMs}ms
- مقارنة بالبحث غير الموجه (Unguided):
  مرشحون=${u.ops.candidatesEvaluated}, تربيع=${u.ops.squarings}, isqrt=${u.ops.isqrtCalls}, جمع=${u.ops.additions}, GCD=${u.ops.gcds}
- مقارنة بـ Pollard Rho على N=${directFactorization.primaryN}:
  عامل=${rho.factorFound}, خطوات=${rho.steps}, جمع=${rho.ops.additions}, تربيع=${rho.ops.squarings}, GCD=${rho.ops.gcds}, الزمن=${rho.elapsedMs}ms
- مقارنة بـ Quadratic Sieve على N=${directFactorization.primaryN}:
  عامل=${qs.factorFound}, خطوات=${qs.steps}, جمع=${qs.ops.additions}, ضرب=${qs.ops.multiplications}, تربيع=${qs.ops.squarings}, GCD=${qs.ops.gcds}, الزمن=${qs.elapsedMs}ms (${qs.notes})

نتائج الاختبارات الفعلية على أعداد شبه أولية متوازنة وغير متوازنة:
${benchmarkSummary}

تعليمات التنسيق والمحتوى:
1. أجب عن **جميع البنود والأسئلة المرقمة والسؤال البحثي** بالترتيب وبعناوين Markdown واضحة (##، ###).
2. اكتب البراهين الرياضية خطوة بخطوة في معادلات واضحة بصيغة \`$$ ... $$\` أو \`$ ... $\`.
3. قدّم كود TypeScript/BigInt قابل للتنفيذ الفعلي في كتلة كود \`\`\`typescript ... \`\`\`.
4. اعرض جدول مقارنة Markdown منسقاً للقيم الفعلية المحسوبة أعلاه (عدد عمليات الجمع والضرب والتربيع وGCD والزمن).
5. ممنوع تماماً ذكر أو استخدام Subset Sum أو LLL أو مصفوفة A1.

الناتج JSON حصراً:
{
  "directAnswer": "ملخص مباشر ودقيق للحل النهائي (بما في ذلك العاملان p و q وزوج التصادم (a,b) لـ N=${directFactorization.primaryN})",
  "scientificArticle": "النص الكامل المنسق بصيغة Markdown مع الإجابة عن كل سؤال"
}
`;
  } else if (mode === 'DIRECT_MATH') {
    prompt = `
أنت عالم رياضيات وفيزياء ومهندس خوارزميات متخصص.
قدّم حلاً مباشراً وصارماً ومفصلاً لكل سؤال وطلب في المسألة التالية، بدون استبدال المسألة بمسألة أخرى (لا تحولها إلى Subset Sum ولا تفرض LLL/SVD إذا لم تكن مطلوبة).

المسألة:
"""
${originalProblem}
"""

المعطيات المستخرجة:
- المفاهيم: ${(insights?.concepts ?? []).join("، ")}
- المتغيرات: ${variablesText}
- الهدف الرياضي: ${insights?.objectiveFunction ?? ""}

تعليمات التنسيق:
- أجب عن كل بند وسؤال بشكل مباشر ومنظم بعناوين Markdown (## و ###).
- استخدم صيغ المعادلات \`$$ ... $$\` و \`$ ... $\`، وجداول Markdown، وكتل الكود \`\`\`typescript ... \`\`\` عند الحاجة.
- استخدم لغة عربية علمية واضحة ودقيقة.

الناتج JSON حصراً:
{
  "directAnswer": "إجابة مباشرة ومركزة تلخص النتيجة الأساسية",
  "scientificArticle": "الشرح الرياضي والبرهاني والتنفيذي الكامل بصيغة Markdown"
}
`;
  } else {
    prompt = `
    أنت عالم فيزياء ورياضيات متخصص. قم بكتابة مقال علمي متكامل بناءً على النتائج التالية:
    المسألة: "${originalProblem}"
    المتغيرات المستخرجة: ${variablesText}
    دالة الهدف: ${insights?.objectiveFunction ?? ""}
    الحل المحسوب (X): [${vectorX.join(", ")}]
    التحليل الطيفي: ${spectral?.stiffDirections ?? 0} اتجاهات صلبة، ${spectral?.sloppyDirections ?? 0} اتجاهات مرنة.
    
    يجب أن يتبع المقال التنسيق التالي بدقة باستخدام عناوين Markdown (## و ###):
    1. **المقدمة**: تعريف الموضوع وأهميته والنموذج الرياضي المستخدم.
    2. **المنهجية**: شرح الاسترخاء المستمر (Continuous Relaxation) والتثبيت (Anchoring) وخوارزمية A-guided Heuristic.
    3. **النتائج**:
       - النتائج المثبتة رياضياً (Provable Results): دقة المتجه X وتحقيق القيود.
       - النتائج التجريبية/التفسيرية (Experimental/Heuristic Results): كيف يترجم X إلى واقع في سياق المسألة.
    4. **التحليل**: مناقشة الاتجاهات الصلبة والمرنة (Stiffness vs Sloppiness) وحساسية النظام.
    5. **الاستنتاجات**: خلاصة دقيقة، القيود، وإمكانية التحقق.

    استخدم لغة أكاديمية رصينة جداً (اللغة العربية).
    
    الناتج JSON:
    {
      "directAnswer": "إجابة ملخصة ومباشرة للسؤال",
      "scientificArticle": "نص المقال الكامل (Markdown)"
    }
    `;
  }

  try {
    const response = await generateWithFallback(
      ai,
      (model, isHydrogen) => ({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              directAnswer: { type: Type.STRING },
              scientificArticle: { type: Type.STRING },
            },
            required: ["directAnswer", "scientificArticle"],
          },
          thinkingConfig: {
            thinkingLevel: isHydrogen ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
          },
        },
      }),
      32000
    );

    const parsed = JSON.parse(response.text || "{}");
    return {
      summary: parsed.directAnswer || "لا توجد إجابة مباشرة.",
      article: parsed.scientificArticle || "تعذر توليد المقال.",
    };
  } catch (error: any) {
    if (error instanceof GeminiApiError) throw error;
    const { status, message } = extractErrorDetails(error);
    throw new GeminiApiError(message, status);
  }
}
