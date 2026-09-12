"""FastAPI interface consumed by Streamlit through server-side HTTP requests."""
import asyncio
import json
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from backend.github_reader import InspectionError, inspect_repository

app = FastAPI(title='AI DevOps Engineer Backend', version='0.1.0')


def error_response(code, message, status):
    return JSONResponse({'error': {'code': code, 'message': message}}, status_code=status, headers={'Cache-Control': 'no-store'})


@app.get('/api/health')
def health():
    return {'status': 'ok', 'service': 'ai-devops-engineer-backend'}


@app.post('/api/repositories/inspect', openapi_extra={
    'requestBody': {'required': True, 'content': {'application/json': {'schema': {
        'type': 'object', 'required': ['repositoryUrl'], 'additionalProperties': False,
        'properties': {'repositoryUrl': {'type': 'string', 'example': 'https://github.com/owner/repository'}}
    }}}}
})
async def inspect(request: Request):
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        return error_response('UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.', 415)
    try:
        data = bytearray()
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 2048:
                    return error_response('REQUEST_TOO_LARGE', 'Request body exceeds 2 KiB.', 413)
        body = json.loads(data)
    except TimeoutError:
        return error_response('REQUEST_TIMEOUT', 'Request body timed out.', 408)
    except (ValueError, UnicodeError):
        return error_response('INVALID_JSON', 'Send valid JSON.', 400)
    if not isinstance(body, dict) or set(body) != {'repositoryUrl'}:
        return error_response('INVALID_REQUEST', 'Send an object containing only repositoryUrl.', 400)
    try:
        snapshot = await run_in_threadpool(inspect_repository, body['repositoryUrl'])
        return JSONResponse(snapshot, headers={'Cache-Control': 'no-store'})
    except InspectionError as exc:
        return error_response(exc.code, exc.message, exc.status)
    except Exception:
        return error_response('INTERNAL_ERROR', 'Inspection could not be completed.', 500)
