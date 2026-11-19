import express, { Request, Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeProblemToVectorServer,
  decodeSolutionServer,
  GeminiApiError,
} from "./server/geminiClient.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";

function toClientSafeStatus(status: number): number {
  // Nginx intercepts 403, 502, 503, 504 with HTML error pages (forbidden.html / warmup.html).
  // Map those to 500 so JSON error bodies reach the browser intact.
  if (status === 403 || status === 502 || status === 503 || status === 504) {
    return 500;
  }
  return status >= 400 && status < 600 ? status : 500;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/api/gemini/encode", async (req: Request, res: Response) => {
    try {
      const { problemText } = req.body ?? {};
      if (typeof problemText !== "string" || !problemText.trim()) {
        res.status(400).json({ error: "problemText is required and must be a non-empty string." });
        return;
      }

      const result = await encodeProblemToVectorServer(problemText);
      res.json(result);
    } catch (error: any) {
      const rawStatus = error instanceof GeminiApiError ? error.status : 500;
      const status = toClientSafeStatus(rawStatus);
      const message = error?.message || "Internal server error during encoding.";
      console.error("Encode endpoint error:", error);
      res.status(status).json({ error: message, upstreamStatus: rawStatus });
    }
  });

  app.post("/api/gemini/decode", async (req: Request, res: Response) => {
    try {
      const {
        originalProblem,
        vectorX,
        vectorB,
        insights,
        spectral,
        subsetDetails,
        mode,
        problemType,
        directFactorization,
      } = req.body ?? {};

      if (typeof originalProblem !== "string" || !originalProblem.trim()) {
        res.status(400).json({ error: "originalProblem is required." });
        return;
      }
      if (!Array.isArray(vectorX) || !Array.isArray(vectorB)) {
        res.status(400).json({ error: "vectorX and vectorB must be arrays." });
        return;
      }

      const result = await decodeSolutionServer({
        originalProblem,
        vectorX,
        vectorB,
        insights: insights ?? { concepts: [], variables: [], causality: "", objectiveFunction: "" },
        spectral: spectral ?? { stiffDirections: 0, sloppyDirections: 0 },
        subsetDetails,
        mode,
        problemType,
        directFactorization,
      });

      res.json(result);
    } catch (error: any) {
      const rawStatus = error instanceof GeminiApiError ? error.status : 500;
      const status = toClientSafeStatus(rawStatus);
      const message = error?.message || "Internal server error during decoding.";
      console.error("Decode endpoint error:", error);
      res.status(status).json({ error: message, upstreamStatus: rawStatus });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 120000;
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
