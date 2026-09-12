# Contributing

Use Node.js 24 and `npm ci`. Start from the merged starter on main; while the starter PR is open, base dependent branches on `codex/hackathon-starter` and target that branch until it merges.

Create a short-lived branch such as `codex/devops-nebius`, `codex/agent-engineering`, `codex/backend-github`, or `codex/frontend-ux`. Coordinate ownership with the team lead before implementing. Agree on changes to `types/index.ts` with affected teammates first.

Keep PRs focused, link the workstream issue, describe validation, and request a teammate review. Run `npm run check`. Do not commit secrets, force-push main, auto-merge generated fixes, or run untrusted repository scripts on your host. The team lead coordinates integration and the final demo.
