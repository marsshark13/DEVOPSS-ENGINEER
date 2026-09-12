import "server-only";
import type { ProposedFix, RepositorySnapshot, SandboxCommandResult, SandboxResult, SandboxStatus } from "@/types";

export interface SandboxExecutor {
  verify(snapshot: RepositorySnapshot, fix: ProposedFix): Promise<SandboxResult>;
}

export interface SandboxConfig {
  apiKey: string;
  baseURL: string;
  timeoutMs: number;
  commands: string[];
}

interface SandboxRunResponse {
  status?: unknown;
  exitCode?: unknown;
  exit_code?: unknown;
  logs?: unknown;
  durationMs?: unknown;
  duration_ms?: unknown;
  commands?: unknown;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_COMMANDS = ["npm ci", "npm run check"];
const MAX_LOG_CHARS = 20_000;

export function getSandboxConfig(): SandboxConfig {
  const apiKey = process.env.SANDBOX_API_KEY;
  const baseURL = normalizeBaseURL(process.env.SANDBOX_BASE_URL);
  if (!apiKey || !baseURL) throw new Error("Configure SANDBOX_API_KEY and SANDBOX_BASE_URL server-side.");
  return {
    apiKey,
    baseURL,
    timeoutMs: readTimeoutMs(process.env.SANDBOX_TIMEOUT_MS),
    commands: readCommands(process.env.SANDBOX_COMMANDS),
  };
}

export class TokenFactorySandboxExecutor implements SandboxExecutor {
  constructor(private readonly config = getSandboxConfig()) {}

  async verify(snapshot: RepositorySnapshot, fix: ProposedFix): Promise<SandboxResult> {
    if (snapshot.commitSha !== fix.baseCommitSha) {
      throw new Error("Refusing to verify a patch against a different base commit.");
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseURL}/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repository: {
            owner: snapshot.owner,
            name: snapshot.name,
            commitSha: snapshot.commitSha,
            files: snapshot.files,
          },
          patch: {
            baseCommitSha: fix.baseCommitSha,
            diff: fix.diff,
          },
          commands: this.config.commands,
          timeoutMs: this.config.timeoutMs,
        }),
        signal: controller.signal,
      });

      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(`Sandbox verification failed with ${response.status}: ${readErrorMessage(body)}`);
      }

      return parseSandboxResult(body, Date.now() - startedAt);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return {
          status: "timed_out",
          exitCode: null,
          logs: "Sandbox verification timed out before a result was returned.",
          durationMs: Date.now() - startedAt,
        };
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createSandboxExecutor(config = getSandboxConfig()): SandboxExecutor {
  return new TokenFactorySandboxExecutor(config);
}

function parseSandboxResult(body: unknown, fallbackDurationMs: number): SandboxResult {
  if (!isRecord(body)) throw new Error("Sandbox returned a non-object response.");
  const response = body as SandboxRunResponse;
  const status = parseStatus(response.status);
  const exitCode = readNullableNumber(response.exitCode ?? response.exit_code);
  const logs = redactLogs(String(response.logs ?? ""));
  const durationMs = readNumber(response.durationMs ?? response.duration_ms) ?? fallbackDurationMs;

  return {
    status,
    exitCode,
    logs,
    durationMs,
    commands: parseCommands(response.commands),
  };
}

function parseCommands(value: unknown): SandboxCommandResult[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((command): SandboxCommandResult => {
    if (!isRecord(command)) {
      return { command: "unknown", exitCode: null, durationMs: 0, logs: "" };
    }

    return {
      command: typeof command.command === "string" ? command.command : "unknown",
      exitCode: readNullableNumber(command.exitCode ?? command.exit_code),
      durationMs: readNumber(command.durationMs ?? command.duration_ms) ?? 0,
      logs: redactLogs(String(command.logs ?? "")),
    };
  });
}

function parseStatus(value: unknown): SandboxStatus {
  if (value === "passed" || value === "failed" || value === "timed_out") return value;
  throw new Error("Sandbox returned an invalid status.");
}

function redactLogs(logs: string): string {
  const redacted = logs
    .replace(/(NEBIUS_API_KEY|SANDBOX_API_KEY|GITHUB_TOKEN)=\S+/g, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]");
  return redacted.slice(0, MAX_LOG_CHARS);
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function readCommands(value: string | undefined): string[] {
  if (!value) return DEFAULT_COMMANDS;
  const commands = value.split(",").map((command) => command.trim()).filter(Boolean);
  return commands.length > 0 ? commands : DEFAULT_COMMANDS;
}

function readTimeoutMs(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeBaseURL(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

function readErrorMessage(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  if (!isRecord(body)) return "unknown error";
  const error = body.error;
  if (typeof error === "string") return error;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  if (typeof body.message === "string") return body.message;
  return "unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
