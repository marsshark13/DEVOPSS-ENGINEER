import "server-only";

export type NebiusChatRole = "system" | "user" | "assistant";

export interface NebiusChatMessage {
  role: NebiusChatRole;
  content: string;
}

export interface NebiusChatOptions {
  messages: NebiusChatMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface NebiusUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface NebiusChatResult {
  content: string;
  model: string;
  finishReason: string | null;
  usage?: NebiusUsage;
}

export interface NebiusConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs: number;
}

interface NebiusChatCompletionResponse {
  model?: unknown;
  choices?: unknown;
  usage?: unknown;
}

const DEFAULT_TIMEOUT_MS = 45_000;

export function getNebiusConfig(): NebiusConfig {
  const apiKey = process.env.NEBIUS_API_KEY;
  const baseURL = normalizeBaseURL(process.env.NEBIUS_BASE_URL);
  const model = process.env.NEBIUS_MODEL;
  if (!apiKey || !baseURL || !model) throw new Error("Configure NEBIUS_API_KEY, NEBIUS_BASE_URL, and NEBIUS_MODEL server-side.");
  return {
    apiKey,
    baseURL,
    model,
    timeoutMs: readTimeoutMs(process.env.NEBIUS_TIMEOUT_MS),
  };
}

export class NebiusInferenceClient {
  constructor(private readonly config = getNebiusConfig()) {}

  async createChatCompletion(options: NebiusChatOptions): Promise<NebiusChatResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: options.messages,
          max_tokens: options.maxTokens ?? 800,
          temperature: options.temperature ?? 0.2,
        }),
        signal: controller.signal,
      });

      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(`Nebius inference failed with ${response.status}: ${readErrorMessage(body)}`);
      }

      return parseChatCompletion(body, this.config.model);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createNebiusInferenceClient(config = getNebiusConfig()): NebiusInferenceClient {
  return new NebiusInferenceClient(config);
}

function normalizeBaseURL(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

function readTimeoutMs(value: string | undefined): number {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
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

function parseChatCompletion(body: unknown, fallbackModel: string): NebiusChatResult {
  if (!isRecord(body)) throw new Error("Nebius inference returned a non-object response.");

  const response = body as NebiusChatCompletionResponse;
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    throw new Error("Nebius inference returned no choices.");
  }

  const firstChoice = response.choices[0];
  if (!isRecord(firstChoice)) throw new Error("Nebius inference returned an invalid choice.");

  const message = firstChoice.message;
  if (!isRecord(message) || typeof message.content !== "string") {
    throw new Error("Nebius inference returned a choice without text content.");
  }

  return {
    content: message.content,
    model: typeof response.model === "string" ? response.model : fallbackModel,
    finishReason: typeof firstChoice.finish_reason === "string" ? firstChoice.finish_reason : null,
    usage: parseUsage(response.usage),
  };
}

function parseUsage(value: unknown): NebiusUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    promptTokens: readNumber(value.prompt_tokens),
    completionTokens: readNumber(value.completion_tokens),
    totalTokens: readNumber(value.total_tokens),
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
