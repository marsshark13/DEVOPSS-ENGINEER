import "server-only";
import type { RepositoryAnalyzer } from "@/lib/agents/orchestrator";
import type { AnalysisResult, Finding, RepositorySnapshot, Severity } from "@/types";
import { NebiusInferenceClient, createNebiusInferenceClient } from "./client";

const MAX_FILE_CHARS = 12_000;

export class NebiusRepositoryAnalyzer implements RepositoryAnalyzer {
  constructor(private readonly client: NebiusInferenceClient = createNebiusInferenceClient()) {}

  async analyze(snapshot: RepositorySnapshot): Promise<AnalysisResult> {
    const result = await this.client.createChatCompletion({
      messages: [
        {
          role: "system",
          content: [
            "You analyze repository build failures for a DevOps assistant.",
            "Return only JSON matching this shape:",
            "{\"summary\":\"string\",\"findings\":[{\"id\":\"string\",\"severity\":\"critical|high|medium|low\",\"title\":\"string\",\"path\":\"string\",\"evidence\":\"string\",\"reason\":\"string\",\"recommendation\":\"string\"}]}",
            "Cite evidence only from supplied files. If there are no findings, return an empty findings array.",
          ].join(" "),
        },
        {
          role: "user",
          content: buildSnapshotPrompt(snapshot),
        },
      ],
      maxTokens: 1_500,
      temperature: 0.1,
    });

    return parseAnalysisResult(result.content, snapshot);
  }
}

export function createNebiusRepositoryAnalyzer(client = createNebiusInferenceClient()): NebiusRepositoryAnalyzer {
  return new NebiusRepositoryAnalyzer(client);
}

function buildSnapshotPrompt(snapshot: RepositorySnapshot): string {
  const files = snapshot.files.map((file) => {
    const content = file.content.slice(0, MAX_FILE_CHARS);
    const truncated = file.content.length > MAX_FILE_CHARS ? "\n[truncated]" : "";
    return `File: ${file.path}\n\`\`\`\n${content}${truncated}\n\`\`\``;
  });

  return [
    `Repository: ${snapshot.owner}/${snapshot.name}`,
    `Commit: ${snapshot.commitSha}`,
    "Analyze these bounded repository files for build, CI, dependency, container, or configuration problems.",
    ...files,
  ].join("\n\n");
}

function parseAnalysisResult(content: string, snapshot: RepositorySnapshot): AnalysisResult {
  const json = extractJson(content);
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed)) throw new Error("Nebius analyzer returned non-object JSON.");

  const findings = Array.isArray(parsed.findings)
    ? parsed.findings.map((finding, index) => parseFinding(finding, index, snapshot))
    : [];

  return {
    commitSha: snapshot.commitSha,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    findings,
  };
}

function parseFinding(value: unknown, index: number, snapshot: RepositorySnapshot): Finding {
  if (!isRecord(value)) throw new Error(`Nebius analyzer returned invalid finding at index ${index}.`);

  const path = readString(value.path);
  if (!snapshot.files.some((file) => file.path === path)) {
    throw new Error(`Nebius analyzer cited a file outside the repository snapshot: ${path}`);
  }

  return {
    id: readString(value.id) || `finding-${index + 1}`,
    severity: readSeverity(value.severity),
    title: readString(value.title),
    path,
    evidence: readString(value.evidence),
    reason: readString(value.reason),
    recommendation: readString(value.recommendation),
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSeverity(value: unknown): Severity {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") return value;
  return "medium";
}

function extractJson(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();

  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Nebius analyzer did not return JSON.");
  }

  return content.slice(first, last + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
