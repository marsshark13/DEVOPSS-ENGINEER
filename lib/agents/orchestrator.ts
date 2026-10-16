import "server-only";
import type { AnalysisResult, RepositorySnapshot } from "@/types";
import { validateAnalysisResult } from "./validation";

export interface RepositoryAnalyzer { analyze(snapshot: RepositorySnapshot): Promise<AnalysisResult>; }

/** Run an analyzer and enforce the shared result contract before returning it. */
export async function analyzeRepository(snapshot: RepositorySnapshot, analyzer: RepositoryAnalyzer): Promise<AnalysisResult> {
  return validateAnalysisResult(await analyzer.analyze(snapshot), snapshot);
}
