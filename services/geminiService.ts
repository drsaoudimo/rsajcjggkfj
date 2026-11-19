import { ModelingInsights, ProblemType } from "../types";
import type { DirectFactorizationReport } from "../utils/factorizationSolvers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postJson<T>(url: string, body: unknown, retries = 2): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        // Retry if proxy returned temporary warmup/502/503/504 HTML page
        if (attempt < retries && (response.status === 502 || response.status === 503 || response.status === 504)) {
          await sleep(1200 * (attempt + 1));
          continue;
        }
        throw new Error(`Unexpected server response (${response.status}).`);
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Request failed (${response.status})`);
      }

      return data as T;
    } catch (err: any) {
      const isNetworkFailure =
        err instanceof TypeError ||
        String(err?.message ?? "").toLowerCase().includes("failed to fetch");

      if (isNetworkFailure && attempt < retries) {
        await sleep(1200 * (attempt + 1));
        continue;
      }

      lastError =
        err instanceof Error
          ? err
          : new Error("Failed to reach server API.");
      break;
    }
  }

  throw lastError ?? new Error("Failed to reach server API.");
}

export const encodeProblemToVector = async (
  problemText: string
): Promise<{ vector: number[]; insights: ModelingInsights }> => {
  const data = await postJson<{ vector?: number[]; insights?: ModelingInsights }>(
    "/api/gemini/encode",
    { problemText }
  );

  if (!Array.isArray(data?.vector) || data.vector.length === 0) {
    throw new Error("Invalid encoding response: missing vector data.");
  }

  return {
    vector: data.vector,
    insights: data.insights ?? {
      concepts: [],
      variables: [],
      causality: "",
      objectiveFunction: "",
      problemType: "LINEAR_MATRIX",
      extractedN: null,
      requiresMatrixInference: true,
    },
  };
};

export const decodeSolution = async (
  originalProblem: string,
  vectorX: number[],
  vectorB: number[],
  insights: ModelingInsights,
  spectral: any,
  subsetDetails?: any,
  mode?: 'DIRECT_FACTORIZATION' | 'DIRECT_MATH' | 'MATRIX',
  problemType?: ProblemType,
  directFactorization?: DirectFactorizationReport
): Promise<{ summary: string; article: string }> => {
  const data = await postJson<{ summary?: string; article?: string }>(
    "/api/gemini/decode",
    {
      originalProblem,
      vectorX,
      vectorB,
      insights,
      spectral,
      subsetDetails,
      mode,
      problemType,
      directFactorization,
    }
  );

  if (typeof data?.summary !== "string" || typeof data?.article !== "string") {
    throw new Error("Invalid decoding response: missing summary or article.");
  }

  return {
    summary: data.summary,
    article: data.article,
  };
};
