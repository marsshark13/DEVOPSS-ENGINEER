# Backend validation

Verified on 2026-09-12 using Windows and Python 3.14.2 in the repository's `.venv`.

## Dependencies and tests

- Installed `backend/requirements-dev.txt`, including the runtime dependencies.
- Tested versions: FastAPI 0.141.1, Uvicorn 0.52.4, HTTPX 0.28.1, Starlette 1.6.0, Pydantic 2.13.5.
- `.venv/Scripts/python.exe -m pip check`: passed; no broken requirements.
- `.venv/Scripts/python.exe -m unittest discover -s backend/tests -v`: all 12 tests passed (8 reader tests and 4 API tests).
- Starlette emits a non-failing deprecation warning for its HTTPX-based TestClient, recommending HTTPX2. The current test suite passes with the declared HTTPX dependency.

## Live API verification

Started a temporary Uvicorn server on a dynamically allocated localhost port and verified it using real HTTP requests:

- `GET /api/health`: 200, status `ok`.
- `GET /docs`: 200.
- `GET /openapi.json`: 200; includes the inspection endpoint.
- `POST /api/repositories/inspect` with a non-GitHub URL: 400, `INVALID_REPOSITORY_URL`.
- `POST /api/repositories/inspect` for `https://github.com/pallets/flask`: 200, commit `d73fa1cdcbd8b1465c151db8924ba58b1dd14e35`, seven supported files including a nonempty `pyproject.toml`, and no warnings. Verified the commit SHA format and `Cache-Control: no-store` header.

Returned paths: `.github/workflows/lock.yaml`, `.github/workflows/pre-commit.yaml`, `.github/workflows/publish.yaml`, `.github/workflows/tests.yaml`, `.github/workflows/zizmor.yaml`, `README.md`, and `pyproject.toml`.

Dependency downloads and live GitHub access required execution outside the restricted network sandbox. The initial sandboxed GitHub request returned the expected sanitized 502 `GITHUB_UNAVAILABLE` response. The successful live check used anonymous public GitHub access with no credentials. The temporary server was stopped after verification.

See `backend/README.md` for startup commands, the Streamlit integration contract, and limitations. Dependencies remain specified as bounded ranges rather than a deployment lockfile.
