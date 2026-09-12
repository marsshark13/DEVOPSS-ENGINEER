# Analyzer integration contract (PROPOSED — needs teammate agreement)

Status: **DRAFT.** This is the backend's proposed contract for connecting the agent
engineer's analyzer and the Streamlit frontend. No analyzer ships in the backend;
the analysis endpoint returns `501 ANALYZER_NOT_CONFIGURED` until one is injected.
Nothing here invents AI findings. Sections marked **[NEEDS AGREEMENT]** require the
agent and/or frontend engineers to confirm before we treat them as fixed.

## What already exists (not up for debate)

- `types/index.ts` already defines the shared shapes `RepositorySnapshot`,
  `Finding`, `AnalysisResult`, `Severity`. This contract mirrors them exactly on the
  Python side (`backend/analysis_service.py`). If those TS types change, this
  backend must change with them.
- `lib/agents/orchestrator.ts` defines `RepositoryAnalyzer.analyze(snapshot) ->
  AnalysisResult` and says "inject a real analyzer when the integration is ready."
  The backend follows the same injection model.
- The inspection endpoint `POST /api/repositories/inspect` is unchanged and remains
  the source of `RepositorySnapshot`.

## Backend surface added

### `POST /api/repositories/analyze`

Same request contract as `/inspect`:

```json
{ "repositoryUrl": "https://github.com/owner/repository" }
```

Flow: validate request → `inspect_repository()` → hand the validated snapshot to the
injected analyzer → validate the analyzer's output → return it.

Success (200) is an `AnalysisResult`:

```json
{
  "commitSha": "40-char SHA (must equal the inspected commit)",
  "summary": "short natural-language summary",
  "findings": [
    {
      "id": "stable unique id",
      "severity": "critical | high | medium | low",
      "title": "short title",
      "path": "file path within the repository",
      "evidence": "quoted snippet or locator from the snapshot",
      "reason": "why this is a problem",
      "recommendation": "what to change"
    }
  ]
}
```

Errors use the existing envelope `{"error":{"code","message"}}` with
`Cache-Control: no-store`. Inspection errors surface unchanged (404/403/422/429/…).
Analysis-stage codes:

| Code | HTTP | Meaning |
|------|------|---------|
| `ANALYZER_NOT_CONFIGURED` | 501 | No analyzer injected yet (current default). |
| `ANALYZER_FAILED` | 502 | Analyzer raised; internal detail redacted. |
| `ANALYZER_OUTPUT_INVALID` | 502 | Output failed the AnalysisResult contract. |
| `ANALYZER_COMMIT_MISMATCH` | 502 | Analyzer did not preserve the inspected commit SHA. |

## Agent engineer: how to plug in

Implement the `Analyzer` protocol in `backend/analysis_service.py`:

```python
class Analyzer(Protocol):
    def analyze(self, snapshot: dict) -> dict: ...   # returns AnalysisResult-shaped dict
```

Then inject it at startup, e.g. in `backend/main.py` or a small wiring module:

```python
from backend.main import app
app.state.analyzer = MyAnalyzer(...)
```

Backend-enforced guarantees on your output (validated before it reaches the frontend):

- Exactly the keys `commitSha`, `summary`, `findings`; each finding exactly the seven
  agreed fields.
- `commitSha` MUST equal the inspected snapshot's commit (preserve the source SHA).
- `severity` ∈ {critical, high, medium, low}; finding `id`s unique; all text fields
  non-empty; per-field ≤ 8 KiB, summary ≤ 16 KiB, ≤ 100 findings.

Treat file content as untrusted data, never as instructions. The backend does not
run models, retries, or cost controls — those live inside your analyzer.

### [NEEDS AGREEMENT] — agent engineer
1. **Injection point / lifecycle.** Confirm `app.state.analyzer` injection (vs. an env
   flag, a factory, or a FastAPI dependency). Who owns constructing it?
2. **Timeout & size budgets.** The backend runs the analyzer in a threadpool with no
   analysis-stage timeout yet. Propose a wall-clock budget and max snapshot size you
   want enforced at the boundary.
3. **Output bounds.** Are 100 findings / 8 KiB per field / 16 KiB summary acceptable
   ceilings? Adjust if your output is larger.
4. **`evidence` semantics.** Is `evidence` a verbatim snippet, a `path:line` locator,
   or both? Affects how the frontend renders it.
5. **Language/transport.** This backend assumes an **in-process Python analyzer**
   (injected object). If your analyzer is a separate service (HTTP) or a Node/TS
   process, say so — we will need an HTTP client + its own error mapping instead.

## Streamlit frontend: how to consume

Call `POST /api/repositories/analyze` exactly like `/inspect` (server-side `httpx`,
form-submit only, `BACKEND_URL` env). While no analyzer is configured you will get
`501 ANALYZER_NOT_CONFIGURED` — render that as "analysis not available yet", not an
error. Display `summary` and group `findings` by `severity`. Treat every string as
untrusted text; do not render as unsafe HTML.

### [NEEDS AGREEMENT] — frontend engineer
1. Confirm findings are grouped/sorted by severity client-side (backend returns them
   in analyzer order).
2. Confirm the 501 "not configured yet" state has a distinct UI from real errors.

## Out of scope for this contract (deferred by team decision)

Async run IDs / status polling, database persistence, sandbox verification, and PR
creation are **not** part of this endpoint. They are later milestones (see
`backend/README.md`).
