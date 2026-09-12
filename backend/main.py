"""FastAPI interface consumed by Streamlit through server-side HTTP requests."""
import asyncio
import json
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from backend.github_reader import InspectionError, inspect_repository
from backend.analysis_service import AnalysisError, run_analysis

app = FastAPI(title='AI DevOps Engineer Backend', version='0.1.0')

# The agent engineer injects an analyzer here (see backend/INTEGRATION.md).
# None until one is supplied: the analyze endpoint then reports ANALYZER_NOT_CONFIGURED.
app.state.analyzer = None

_REPOSITORY_URL_SCHEMA = {
    'requestBody': {'required': True, 'content': {'application/json': {'schema': {
        'type': 'object', 'required': ['repositoryUrl'], 'additionalProperties': False,
        'properties': {'repositoryUrl': {'type': 'string', 'example': 'https://github.com/owner/repository'}}
    }}}}
}


def error_response(code, message, status):
    return JSONResponse({'error': {'code': code, 'message': message}}, status_code=status, headers={'Cache-Control': 'no-store'})


async def _read_repository_url(request):
    """Shared request validation for the repositoryUrl endpoints.

    Returns (repository_url, None) on success, or (None, error_response) on any
    media-type, size, JSON, or shape violation — identical rules for every endpoint.
    """
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        return None, error_response('UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.', 415)
    try:
        data = bytearray()
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 2048:
                    return None, error_response('REQUEST_TOO_LARGE', 'Request body exceeds 2 KiB.', 413)
        body = json.loads(data)
    except TimeoutError:
        return None, error_response('REQUEST_TIMEOUT', 'Request body timed out.', 408)
    except (ValueError, UnicodeError):
        return None, error_response('INVALID_JSON', 'Send valid JSON.', 400)
    if not isinstance(body, dict) or set(body) != {'repositoryUrl'}:
        return None, error_response('INVALID_REQUEST', 'Send an object containing only repositoryUrl.', 400)
    return body['repositoryUrl'], None


@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'ai-devops-engineer-backend'}


@app.post('/api/repositories/inspect', openapi_extra=_REPOSITORY_URL_SCHEMA)
async def inspect(request: Request):
    repository_url, failure = await _read_repository_url(request)
    if failure is not None:
        return failure
    try:
        snapshot = await run_in_threadpool(inspect_repository, repository_url)
        return JSONResponse(snapshot, headers={'Cache-Control': 'no-store'})
    except InspectionError as exc:
        return error_response(exc.code, exc.message, exc.status)
    except Exception:
        return error_response('INTERNAL_ERROR', 'Inspection could not be completed.', 500)


@app.post('/api/repositories/analyze', openapi_extra=_REPOSITORY_URL_SCHEMA)
async def analyze(request: Request):
    """Inspect a repository, then run the injected analyzer over the snapshot.

    Reuses the inspection contract for input and returns an AnalysisResult
    (see backend/INTEGRATION.md). Returns 501 ANALYZER_NOT_CONFIGURED until the
    agent engineer supplies an analyzer. Never invents findings.
    """
    repository_url, failure = await _read_repository_url(request)
    if failure is not None:
        return failure
    try:
        snapshot = await run_in_threadpool(inspect_repository, repository_url)
    except InspectionError as exc:
        return error_response(exc.code, exc.message, exc.status)
    except Exception:
        return error_response('INTERNAL_ERROR', 'Inspection could not be completed.', 500)
    try:
        result = await run_in_threadpool(run_analysis, snapshot, app.state.analyzer)
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})
    except AnalysisError as exc:
        return error_response(exc.code, exc.message, exc.status)
    except Exception:
        return error_response('INTERNAL_ERROR', 'Analysis could not be completed.', 500)
