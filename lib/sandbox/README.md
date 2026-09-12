# Sandbox execution

`executor.ts` contains a remote sandbox adapter. It never runs repository code in the Next.js process. Configure:

- `SANDBOX_API_KEY`
- `SANDBOX_BASE_URL`, the disposable sandbox control endpoint
- `SANDBOX_TIMEOUT_MS`, optional
- `SANDBOX_COMMANDS`, comma-separated commands such as `npm ci,npm run check`

`TokenFactorySandboxExecutor.verify()` posts the bounded repository snapshot, proposed diff, command list, and timeout to `POST {SANDBOX_BASE_URL}/runs`. The response should include:

```json
{
  "status": "passed",
  "exitCode": 0,
  "logs": "...",
  "durationMs": 12000,
  "commands": [
    { "command": "npm ci", "exitCode": 0, "durationMs": 5000, "logs": "..." }
  ]
}
```

The adapter validates the patch base commit, normalizes status, captures per-command evidence when present, truncates logs, and redacts common bearer-token and env-var secret patterns.

Use disposable isolated environments, explicit resource/time limits, restricted network access, no host mounts or production secrets, and guaranteed cleanup. Repository install scripts are untrusted code. Never run analyzed repositories in the web server process. Record the exact commit, applied diff, commands, exit codes, and redacted logs; report timeout/failure truthfully.
