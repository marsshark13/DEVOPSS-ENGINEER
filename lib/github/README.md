# GitHub adapter

`client.ts` reads public repositories through the GitHub REST API. It resolves the default branch to a commit SHA, reads that immutable commit's tree, and downloads allowlisted file contents from `raw.githubusercontent.com`. This uses three GitHub REST calls per analysis rather than one REST call per file.

The reader caps API response size, file count, individual file size, total snapshot size, and overall/per-request time. It skips binary and oversized files, never clones or executes repository content, and does not fetch arbitrary URLs from repository files. Anonymous GitHub REST API limits apply; setting a least-privilege `GITHUB_TOKEN` server-side raises the REST quota.

The `POST /api/repositories/analyze` route accepts only a public `https://github.com/owner/repository` URL, obtains a bounded snapshot, and sends it to the TypeScript Nebius analyzer. Private repositories and pull request creation are not supported.
