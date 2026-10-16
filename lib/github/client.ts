import "server-only";
import type { RepositorySnapshot } from "@/types";

export interface GitHubRepositoryReader {
  readSnapshot(owner: string, name: string): Promise<RepositorySnapshot>;
}

type GitHubRepository = { default_branch?: unknown };
type GitHubBranch = { commit?: { sha?: unknown; commit?: { tree?: { sha?: unknown } } } };
type GitHubTree = { truncated?: unknown; tree?: unknown };
type GitHubTreeEntry = { path?: unknown; type?: unknown; size?: unknown };

const API_ROOT = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
const SNAPSHOT_TIMEOUT_MS = 45_000;
const MAX_REPOSITORY_FILES = 20;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ALLOWED_ROOT_FILES = new Set([
  "Dockerfile", "Makefile", "README.md", ".nvmrc", ".python-version",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "requirements.txt", "pyproject.toml", "poetry.lock", "setup.py",
  "tsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts",
  "vite.config.js", "vite.config.ts", "build.gradle", "pom.xml",
]);

export class GitHubApiRepositoryReader implements GitHubRepositoryReader {
  async readSnapshot(owner: string, name: string): Promise<RepositorySnapshot> {
    const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS;
    validateSegment(owner, "owner");
    validateSegment(name, "repository");

    const repo = await githubGet<GitHubRepository>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, deadline);
    if (typeof repo.default_branch !== "string" || !repo.default_branch) {
      throw new Error("GitHub repository has no default branch.");
    }

    const branch = await githubGet<GitHubBranch>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(repo.default_branch)}`,
      deadline,
    );
    const commitSha = branch.commit?.sha;
    const treeSha = branch.commit?.commit?.tree?.sha;
    if (typeof commitSha !== "string" || !/^[a-f\d]{40}$/i.test(commitSha)
      || typeof treeSha !== "string" || !/^[a-f\d]{40}$/i.test(treeSha)) {
      throw new Error("GitHub returned an invalid repository revision.");
    }

    const tree = await githubGet<GitHubTree>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      deadline,
    );
    if (tree.truncated === true || !Array.isArray(tree.tree)) {
      throw new Error("GitHub repository tree is too large to inspect safely.");
    }

    const entries = (tree.tree as GitHubTreeEntry[])
      .filter(isEligibleEntry)
      .sort((left, right) => priority(String(left.path)) - priority(String(right.path)) || String(left.path).localeCompare(String(right.path)))
      .slice(0, MAX_REPOSITORY_FILES);

    const selectedEntries: GitHubTreeEntry[] = [];
    let totalBytes = 0;
    for (const entry of entries) {
      const size = typeof entry.size === "number" ? entry.size : 0;
      if (size <= 0 || size > MAX_FILE_BYTES || totalBytes + size > MAX_TOTAL_BYTES) continue;
      selectedEntries.push(entry);
      totalBytes += size;
    }

    const contentsByBatch: (Array<{ path: string; content: string } | null>)[] = [];
    for (let index = 0; index < selectedEntries.length; index += 5) {
      const batch = selectedEntries.slice(index, index + 5);
      const contents = await Promise.all(batch.map(async (entry) => {
        return readRawFile(owner, name, commitSha, entry.path as string, deadline);
      }));
      contentsByBatch.push(contents);
    }

    const files: RepositorySnapshot["files"] = [];
    let actualTotalBytes = 0;
    for (const file of contentsByBatch.flat()) {
      if (!file) continue;
      const size = Buffer.byteLength(file.content, "utf8");
      if (actualTotalBytes + size > MAX_TOTAL_BYTES) continue;
      files.push(file);
      actualTotalBytes += size;
    }

    return { owner, name, commitSha, files };
  }
}

export function createGitHubRepositoryReader(): GitHubRepositoryReader {
  return new GitHubApiRepositoryReader();
}

function isEligibleEntry(entry: GitHubTreeEntry): boolean {
  if (entry.type !== "blob" || typeof entry.path !== "string") return false;
  const path = entry.path;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return false;
  if (path.startsWith(".github/workflows/")) {
    return path.split("/").length === 3 && /\.(?:yml|yaml)$/i.test(path);
  }
  if (path.includes("/")) return false;
  return ALLOWED_ROOT_FILES.has(path);
}

function priority(path: string): number {
  const order = ["Dockerfile", "package.json", "requirements.txt", "pyproject.toml", "Makefile", ".github/workflows/"];
  const index = order.findIndex((prefix) => path === prefix || path.startsWith(prefix));
  return index < 0 ? order.length : index;
}

function validateSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid GitHub repository ${label}.`);
  }
}

async function githubGet<T>(path: string, deadline: number): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (timeoutMs <= 0) throw new Error("GitHub request timed out.");
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ai-devops-engineer",
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`${API_ROOT}${path}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await readBoundedText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) {
      if (response.status === 404) throw new Error("GitHub repository or file was not found.");
      if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
        throw new Error("GitHub API rate limit reached.");
      }
      throw new Error("GitHub repository could not be read.");
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("GitHub returned invalid JSON.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("GitHub request timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRawFile(owner: string, name: string, commitSha: string, path: string, deadline: number): Promise<{ path: string; content: string } | null> {
  const timeoutMs = Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now());
  if (timeoutMs <= 0) throw new Error("GitHub request timed out.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${commitSha}/${encodedPath}`;
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (response.status === 404) return null;
    if (response.status === 429) throw new Error("GitHub API rate limit reached.");
    if (!response.ok) throw new Error("GitHub repository file could not be read.");
    try {
      const content = await readBoundedText(response, MAX_FILE_BYTES);
      return { path, content };
    } catch (cause) {
      if (cause instanceof TypeError) return null; // Skip binary or invalid UTF-8 files.
      throw cause;
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw new Error("GitHub request timed out.");
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("GitHub response exceeded the size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}
