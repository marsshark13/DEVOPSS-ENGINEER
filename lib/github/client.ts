import "server-only";
import type { RepositorySnapshot } from "@/types";
export interface GitHubRepositoryReader {
  readSnapshot(owner: string, name: string): Promise<RepositorySnapshot>;
}
