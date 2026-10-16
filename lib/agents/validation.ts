import "server-only";
import type { AnalysisResult, Finding, RepositorySnapshot, Severity } from "@/types";

const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];
const FINDING_KEYS = ["id", "severity", "title", "path", "evidence", "reason", "recommendation"];
const RESULT_KEYS = ["commitSha", "summary", "findings"];
const MAX_FINDINGS = 100;
const MAX_FIELD_BYTES = 8 * 1024;
const MAX_SUMMARY_BYTES = 16 * 1024;

/** Validate unknown analyzer output before it crosses an application boundary. */
export function validateAnalysisResult(value: unknown, snapshot: RepositorySnapshot): AnalysisResult {
  if (!isRecord(value) || !hasExactKeys(value, RESULT_KEYS)) {
    throw new Error("Analyzer returned an invalid analysis result shape.");
  }
  if (value.commitSha !== snapshot.commitSha) {
    throw new Error("Analyzer result does not match the inspected commit.");
  }
  const summary = requireText(value.summary, "summary", MAX_SUMMARY_BYTES);
  if (!Array.isArray(value.findings) || value.findings.length > MAX_FINDINGS) {
    throw new Error("Analyzer returned an invalid findings list.");
  }

  const ids = new Set<string>();
  const findings = value.findings.map((item, index) => {
    if (!isRecord(item) || !hasExactKeys(item, FINDING_KEYS)) {
      throw new Error(`Analyzer returned an invalid finding at index ${index}.`);
    }

    const id = requireText(item.id, "finding id");
    if (ids.has(id)) throw new Error(`Analyzer returned a duplicate finding id: ${id}.`);
    ids.add(id);

    const severity = item.severity;
    if (typeof severity !== "string" || !SEVERITIES.includes(severity as Severity)) {
      throw new Error(`Analyzer returned an invalid severity at finding ${index}.`);
    }
    const path = requireText(item.path, "finding path");
    const file = snapshot.files.find((candidate) => candidate.path === path);
    if (!file) throw new Error(`Analyzer cited a file outside the repository snapshot: ${path}.`);

    const evidence = requireText(item.evidence, "finding evidence");
    if (!file.content.includes(evidence)) {
      throw new Error(`Analyzer evidence is not present in the cited file: ${path}.`);
    }

    return {
      id,
      severity: severity as Severity,
      title: requireText(item.title, "finding title"),
      path,
      evidence,
      reason: requireText(item.reason, "finding reason"),
      recommendation: requireText(item.recommendation, "finding recommendation"),
    } satisfies Finding;
  });

  return { commitSha: snapshot.commitSha, summary, findings };
}

function requireText(value: unknown, field: string, maxBytes = MAX_FIELD_BYTES): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Analyzer field ${field} must be non-empty text.`);
  }
  if (new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new Error(`Analyzer field ${field} exceeds the size limit.`);
  }
  return value;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
