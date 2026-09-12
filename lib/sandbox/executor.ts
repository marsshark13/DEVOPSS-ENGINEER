import "server-only";
import type { ProposedFix, RepositorySnapshot, SandboxResult } from "@/types";
export interface SandboxExecutor {
  verify(snapshot: RepositorySnapshot, fix: ProposedFix): Promise<SandboxResult>;
}
