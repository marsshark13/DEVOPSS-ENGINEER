export type Severity = "critical" | "high" | "medium" | "low";
export interface RepositorySnapshot { owner: string; name: string; commitSha: string; files: { path: string; content: string }[]; }
export interface Finding { id: string; severity: Severity; title: string; path: string; evidence: string; reason: string; recommendation: string; }
export interface AnalysisResult { commitSha: string; findings: Finding[]; summary: string; }
export interface ProposedFix { findingIds: string[]; baseCommitSha: string; diff: string; explanation: string; }
export interface SandboxResult { status: "passed" | "failed" | "timed_out"; exitCode: number | null; logs: string; durationMs: number; }
