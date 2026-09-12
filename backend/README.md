# Python backend — Streamlit integration

This is the active backend for the team's Streamlit frontend. The older Next.js scaffold remains for reference; Node.js is not required to run this backend. No n8n, GitHub token, database, or model credentials are needed for repository inspection.

## Run locally

Use Python 3.12+ from the repository root:

```sh
python -m venv .venv
# Windows PowerShell:
.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
.venv/Scripts/python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
# macOS/Linux: use .venv/bin/python instead
```

API docs: http://127.0.0.1:8000/docs
Health: http://127.0.0.1:8000/api/health

## Frontend contract

`POST /api/repositories/inspect` with `Content-Type: application/json`:

```json
{"repositoryUrl":"https://github.com/owner/repository"}
```

Success (200):

```json
{
  "owner": "owner",
  "name": "repository",
  "commitSha": "40-character SHA",
  "files": [{"path":"requirements.txt","content":"..."}],
  "warnings": []
}
```

An empty `files` list is a successful inspection with a warning, not a failed analysis. Display all warnings so users know about excluded files. File content is untrusted text; do not execute it or render it as unsafe HTML. The endpoint returns repository contents, not AI findings.

Errors use `{"error":{"code":"...","message":"..."}}`. Statuses: 400 invalid JSON/URL/request, 408 slow request body, 413 request over 2 KiB, 415 wrong media type, 404 missing/private repository, 403 denied access, 422 empty/moved/oversized repository, 429 GitHub rate limit, 502 upstream failure, 504 upstream timeout, 500 unexpected internal error. No upstream response bodies or credentials are returned in errors.

Streamlit calls the API from its Python server; browser CORS is not needed. Add `httpx` to the frontend's dependencies. Example to adapt inside the teammate's Streamlit app:

```python
import os
import httpx
import streamlit as st

api = os.environ.get('BACKEND_URL', 'http://127.0.0.1:8000')
with st.form('inspect_repository'):
    url = st.text_input('Public GitHub repository URL')
    submitted = st.form_submit_button('Inspect repository')
if submitted:
    try:
        with st.spinner('Reading repository...'):
            response = httpx.post(
                f'{api}/api/repositories/inspect',
                json={'repositoryUrl': url}, timeout=45,
            )
        payload = response.json()
        if response.is_success:
            st.session_state['snapshot'] = payload
            st.success(f"Read {len(payload['files'])} files")
            st.caption(f"Commit: {payload['commitSha']}")
            for warning in payload['warnings']:
                st.warning(warning)
        else:
            st.error(payload['error']['message'])
    except (httpx.HTTPError, ValueError):
        st.error('The backend is unavailable. Please try again.')
```

Set BACKEND_URL on the Streamlit server when hosted separately; localhost only works when both processes share the machine. Do not make a request on every Streamlit rerun—use the form submit action.

## Reader behavior

- Accepts only HTTPS github.com owner/repository URLs (optional .git suffix).
- Uses anonymous public API reads; GITHUB_TOKEN is intentionally unused. Private repository support requires per-user authentication design first.
- Resolves the default branch once, then reads its immutable tree and blob SHAs.
- Selects root Node/Python/build configuration, README.md, and direct .github/workflows YAML files. Nested monorepo package files are not covered yet.
- Skips symlinks, submodules, binary/non-UTF-8 files, files over 64 KiB, and content beyond 256 KiB total.
- Considers at most 100 matching paths and fetches at most 20 blobs. Each upstream JSON response is capped at 2 MiB; truncated trees fail explicitly.
- Uses a 30-second inspection budget and socket timeouts capped at 10 seconds; a blocking read can finish shortly after the budget. Does not follow redirects or arbitrary response URLs.
- Never clones, installs dependencies from, or executes the inspected repository.

## Validation

```sh
python -m unittest backend.tests.test_reader -v
.venv/Scripts/python.exe -m unittest discover -s backend/tests -v
```

Reader tests use the Python standard library. Full tests require requirements-dev.txt and include the FastAPI endpoint. CI runs both. Development dependencies currently use bounded version ranges; capture a tested lockfile before deployment.

## Next backend milestones

1. Agree on this snapshot contract with the agent and frontend teammates.
2. `POST /api/repositories/analyze` and the analyzer boundary now exist
   (`backend/analysis_service.py`); it returns `501 ANALYZER_NOT_CONFIGURED` until
   the agent engineer injects an analyzer. See `backend/INTEGRATION.md` for the
   proposed contract and the points needing teammate agreement.
3. Add run IDs/status storage when asynchronous analysis and sandbox work are connected.
4. Add user-authorized PR creation only after patch verification, with stale-commit detection.

Keep this API on localhost during development. Before public deployment, add application authentication, per-user request quotas, and concurrency controls; GitHub anonymous rate limits are shared across calls. Model inference, sandbox execution, database persistence, and PR creation are not implemented here.

References: [GitHub trees](https://docs.github.com/en/rest/git/trees), [FastAPI](https://fastapi.tiangolo.com/tutorial/first-steps/).
