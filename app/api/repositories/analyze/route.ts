import { NextResponse } from "next/server";
import { analyzeRepository } from "@/lib/agents/orchestrator";
import { createGitHubRepositoryReader } from "@/lib/github/client";
import { createNebiusRepositoryAnalyzer } from "@/lib/nebius/analyzer";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_REQUEST_BYTES = 2 * 1024;
const repositoryUrlPattern = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\.git)?\/?$/i;

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return error("UNSUPPORTED_MEDIA_TYPE", "Send an application/json request body.", 415);

  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_REQUEST_BYTES) return error("REQUEST_TOO_LARGE", "Request body exceeds 2 KiB.", 413);

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return error("INVALID_JSON", "Send valid JSON.", 400);
  }
  if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.repositoryUrl !== "string") {
    return error("INVALID_REQUEST", "Send an object containing only repositoryUrl.", 400);
  }

  const match = repositoryUrlPattern.exec(body.repositoryUrl.trim());
  if (!match) return error("INVALID_REPOSITORY_URL", "Use a public https://github.com/owner/repository URL.", 400);

  let stage: "github" | "model" = "github";
  try {
    const reader = createGitHubRepositoryReader();
    const snapshot = await reader.readSnapshot(match[1], match[2].replace(/\.git$/i, ""));
    if (snapshot.files.length === 0) return error("NO_SUPPORTED_FILES", "No supported text configuration files were found in the repository.", 422);
    stage = "model";
    const analysis = await analyzeRepository(snapshot, createNebiusRepositoryAnalyzer());
    return NextResponse.json(analysis, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Analysis could not be completed.";
    if (message.includes("rate limit")) return error("GITHUB_RATE_LIMITED", "GitHub's public API rate limit was reached. Try again later.", 429);
    if (message.includes("was not found")) return error("REPOSITORY_NOT_FOUND", "The public GitHub repository was not found.", 404);
    if (message.includes("timed out")) return error("UPSTREAM_TIMEOUT", "The repository or model request timed out.", 504);
    if (message.includes("Analyzer") || message.includes("analyzer")) return error("ANALYZER_OUTPUT_INVALID", "The model response did not satisfy the evidence and findings contract.", 502);
    if (message.startsWith("Configure NEBIUS_")) return error("MODEL_CONFIGURATION_MISSING", "Set NEBIUS_API_KEY, NEBIUS_BASE_URL, and NEBIUS_MODEL in .env.local, then restart the dev server.", 500);
    const modelStatus = /Nebius inference failed with (\d{3})/.exec(message)?.[1];
    if (modelStatus === "401") return error("MODEL_AUTH_FAILED", "Nebius rejected the configured API key. Check NEBIUS_API_KEY in .env.local.", 502);
    if (modelStatus === "403") return error("MODEL_ACCESS_DENIED", "The configured Nebius account or model is not authorized for this request.", 502);
    if (modelStatus === "404") return error("MODEL_NOT_FOUND", "Nebius could not find the configured endpoint or model. Check NEBIUS_BASE_URL and NEBIUS_MODEL.", 502);
    if (modelStatus === "429") return error("MODEL_RATE_LIMITED", "Nebius rate-limited the request. Wait briefly and try again.", 502);
    if (modelStatus && Number(modelStatus) < 500) return error("MODEL_CONFIGURATION_INVALID", `Nebius rejected the request (HTTP ${modelStatus}). Check NEBIUS_BASE_URL and NEBIUS_MODEL.`, 502);
    if (modelStatus) return error("MODEL_UPSTREAM_FAILED", `Nebius returned a server error (HTTP ${modelStatus}). Try again shortly.`, 502);
    if (message.includes("Nebius inference request could not be completed")) return error("MODEL_CONNECTION_FAILED", "The server could not connect to Nebius. Check network access and NEBIUS_BASE_URL.", 502);
    if (message.includes("Nebius inference returned")) return error("MODEL_RESPONSE_INVALID", "Nebius returned a response the app could not read. Check that NEBIUS_BASE_URL and NEBIUS_MODEL are compatible.", 502);
    if (message.includes("Nebius")) return error("MODEL_REQUEST_FAILED", "Nebius inference failed. Check the local model configuration and try again.", 502);
    if (message.includes("GitHub")) return error("GITHUB_READ_FAILED", "The repository could not be read from GitHub.", 502);
    console.error("[repository-analysis] unexpected failure", {
      stage,
      errorName: cause instanceof Error ? cause.name : "UnknownError",
    });
    return stage === "github"
      ? error("GITHUB_READ_FAILED", "The repository could not be read from GitHub.", 502)
      : error("MODEL_REQUEST_FAILED", "Nebius inference could not be completed. Check the model configuration and try again.", 502);
  }
}

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
