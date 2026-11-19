import type { DirectFactorizationReport } from './utils/factorizationSolvers';

export type Matrix = number[][];

export type ProblemType =
  | 'QUADRATIC_COLLISION'
  | 'INTEGER_FACTORIZATION'
  | 'POLLARD_RHO'
  | 'FERMAT_FACTORIZATION'
  | 'SUBSET_SUM'
  | 'LINEAR_MATRIX'
  | 'DIRECT_MATH_PROOF';

export interface ProcessingStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  details?: string;
}

export interface InferenceMetrics {
  integrity: number;   // نسبة نزاهة الاستدلال (0-100)
  consistency: number; // الاتساق (0-1)
  mass: number;        // كتلة الحجة (0-100)
  convergence: number; // التقارب (0-100)
}

export interface SpectralAnalysisResult {
  singularValues: number[];
  conditionNumber: number;
  lllConditionNumber: number; // Condition number of the reduced basis
  orthogonalityDefect: number;
  stiffDirections: number;
  sloppyDirections: number;
}

export interface LLLResult {
  originalBasis: Matrix; // Columns
  reducedBasis: Matrix; // Columns
  shortestVector: number[];
}

export interface ModelingInsights {
  concepts: string[];
  variables: string[];
  causality: string;
  objectiveFunction: string;
  problemType?: ProblemType;
  extractedN?: string | null;
  requiresMatrixInference?: boolean;
}

export interface SolverResult {
  mode: 'DIRECT_FACTORIZATION' | 'DIRECT_MATH' | 'MATRIX';
  problemType: ProblemType;
  solutionText: string; 
  scientificArticle: string; 
  confidence: number;
  vectorX: number[]; 
  vectorB: number[]; 
  correctionDelta: number;
  integralityGap: number; 
  metrics: InferenceMetrics; 
  spectral: SpectralAnalysisResult;
  lll: LLLResult;
  modelingInsights: ModelingInsights;
  subsetDetails?: {
    isSubsetSum: boolean;
    foundSubset: string[];
    target: string;
    residual: string;
    status: 'SAT' | 'UNSAT' | 'APPROX';
  };
  directFactorization?: DirectFactorizationReport;
}

export enum AppState {
  IDLE = 'IDLE',
  ENCODING = 'ENCODING',
  CALCULATING = 'CALCULATING',
  CORRECTING = 'CORRECTING',
  DECODING = 'DECODING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}
