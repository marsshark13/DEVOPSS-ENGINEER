import "server-only";
import type { AnalysisResult, RepositorySnapshot } from "@/types";
export interface RepositoryAnalyzer { analyze(snapshot: RepositorySnapshot): Promise<AnalysisResult>; }
/** Inject a real analyzer when the integration is ready. No model calls in the starter. */
export async function analyzeRepository(snapshot: RepositorySnapshot, analyzer: RepositoryAnalyzer): Promise<AnalysisResult> {
  return analyzer.analyze(snapshot);
}
