"""Bounded, public-only GitHub snapshots. No credentials or repository code execution."""
import base64
import binascii
import json
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_FILES = 20
MAX_FILE_BYTES = 64 * 1024
MAX_TOTAL_BYTES = 256 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
TIMEOUT_SECONDS = 30
ROOT_FILES = {
    'package.json', 'Dockerfile', '.dockerignore', 'docker-compose.yml',
    'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'tsconfig.json',
    '.nvmrc', '.node-version', 'README.md', 'next.config.js', 'next.config.mjs',
    'next.config.ts', 'vite.config.js', 'vite.config.ts', 'pyproject.toml',
    'requirements.txt', 'runtime.txt', '.python-version', 'Procfile',
}


class InspectionError(Exception):
    def __init__(self, code, message, status):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def parse_repository_url(value):
    error = InspectionError('INVALID_REPOSITORY_URL', 'Use https://github.com/owner/repository.', 400)
    if not isinstance(value, str) or len(value) > 500:
        raise error
    value = value.strip()
    if any(c in value for c in ('%', '\\', '?', '#')) or any(ord(c) < 32 for c in value):
        raise error
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or url.netloc != 'github.com':
            raise error
        match = re.fullmatch(r'/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]{1,100})/?', url.path)
        if not match:
            raise error
        owner, name = match.groups()
        name = name.removesuffix('.git')
        if name in ('', '.', '..'):
            raise error
        return owner, name
    except ValueError:
        raise error from None


def _invalid():
    return InspectionError('GITHUB_RESPONSE_INVALID', 'GitHub returned an unexpected response.', 502)


def _sha(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{40}', value):
        raise _invalid()
    return value


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubTransport:
    def __init__(self):
        self.opener = build_opener(_NoRedirect())

    def get(self, url, deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise InspectionError('GITHUB_TIMEOUT', 'GitHub inspection timed out. Try again later.', 504)
        request = Request(url, headers={
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2026-03-10',
            'User-Agent': 'AI-DevOps-Engineer',
        })
        try:
            with self.opener.open(request, timeout=min(10, remaining)) as response:
                data = bytearray()
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                    chunk = response.read1(min(65536, MAX_RESPONSE_BYTES + 1 - len(data)))
                    if not chunk:
                        break
                    data.extend(chunk)
                    if len(data) > MAX_RESPONSE_BYTES:
                        raise InspectionError('REPOSITORY_TOO_LARGE', 'GitHub response exceeds the supported size limit.', 422)
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise _invalid()
                return result
        except HTTPError as exc:
            status, headers = exc.code, exc.headers
            exc.close()
            if status == 404:
                raise InspectionError('REPOSITORY_NOT_FOUND', 'Repository not found or not publicly accessible.', 404) from None
            if status == 409:
                raise InspectionError('EMPTY_REPOSITORY', 'This repository has no commit to inspect.', 422) from None
            if status == 429 or (status == 403 and (headers.get('X-RateLimit-Remaining') == '0' or headers.get('Retry-After'))):
                raise InspectionError('GITHUB_RATE_LIMITED', 'GitHub rate limit reached. Try again later.', 429) from None
            if status == 403:
                raise InspectionError('GITHUB_ACCESS_DENIED', 'GitHub denied the public repository request.', 403) from None
            if 300 <= status < 400:
                raise InspectionError('REPOSITORY_MOVED', 'Repository moved. Use its current GitHub URL.', 422) from None
            raise InspectionError('GITHUB_UNAVAILABLE', 'GitHub could not complete the request.', 502) from None
        except (TimeoutError, URLError) as exc:
            timed_out = isinstance(exc, TimeoutError) or isinstance(getattr(exc, 'reason', None), TimeoutError)
            raise InspectionError('GITHUB_TIMEOUT' if timed_out else 'GITHUB_UNAVAILABLE', 'GitHub timed out.' if timed_out else 'Could not reach GitHub.', 504 if timed_out else 502) from None
        except (ValueError, UnicodeError):
            raise _invalid() from None


def inspect_repository(repository_url, transport=None):
    owner, name = parse_repository_url(repository_url)
    transport = transport or GitHubTransport()
    deadline = time.monotonic() + TIMEOUT_SECONDS
    base = f'https://api.github.com/repos/{owner}/{name}'

    def get(path):
        result = transport.get(base + path, deadline)
        if not isinstance(result, dict):
            raise _invalid()
        return result

    metadata = get('')
    if metadata.get('private') is not False:
        raise InspectionError('REPOSITORY_NOT_PUBLIC', 'Only public repositories are supported.', 403)
    branch = metadata.get('default_branch')
    if not isinstance(branch, str) or not branch:
        raise _invalid()
    commit = get('/commits/' + quote(branch, safe=''))
    commit_sha = _sha(commit.get('sha'))
    try:
        tree_sha = _sha(commit['commit']['tree']['sha'])
    except (KeyError, TypeError):
        raise _invalid() from None
    tree = get(f'/git/trees/{tree_sha}?recursive=1')
    if tree.get('truncated') is True:
        raise InspectionError('REPOSITORY_TOO_LARGE', 'Repository tree is too large for this MVP.', 422)
    if tree.get('truncated') is not False or not isinstance(tree.get('tree'), list):
        raise _invalid()
    entries = []
    for entry in tree['tree']:
        if not isinstance(entry, dict) or not isinstance(entry.get('path'), str):
            raise _invalid()
        path = entry['path']
        if path in ROOT_FILES or re.fullmatch(r'\.github/workflows/[A-Za-z0-9._-]+\.ya?ml', path):
            entries.append(entry)
    files, warnings, total, fetched = [], [], 0, 0
    if len(entries) > 100:
        warnings.append('Only the first 100 supported paths were considered.')
    for entry in sorted(entries, key=lambda e: e['path'])[:100]:
        path = entry['path']
        if entry.get('type') != 'blob' or entry.get('mode') not in ('100644', '100755'):
            warnings.append(f'Skipped {path}: not a regular file.')
            continue
        size = entry.get('size')
        if type(size) is not int or size < 0:
            raise _invalid()
        if size > MAX_FILE_BYTES:
            warnings.append(f'Skipped {path}: exceeds 64 KiB.')
            continue
        if fetched >= MAX_FILES or total + size > MAX_TOTAL_BYTES:
            warnings.append(f'Skipped {path}: snapshot limit reached.')
            continue
        fetched += 1
        blob = get('/git/blobs/' + _sha(entry.get('sha')))
        if blob.get('encoding') != 'base64' or not isinstance(blob.get('content'), str):
            raise _invalid()
        try:
            data = base64.b64decode(''.join(blob['content'].split()), validate=True)
        except (binascii.Error, ValueError):
            raise _invalid() from None
        if len(data) != size:
            raise _invalid()
        try:
            content = data.decode('utf-8')
            if '\0' in content:
                raise UnicodeError()
        except UnicodeError:
            warnings.append(f'Skipped {path}: not UTF-8 text.')
            continue
        files.append({'path': path, 'content': content})
        total += len(data)
    if not files:
        warnings.append('No supported configuration files were found within the limits.')
    return {'owner': owner, 'name': name, 'commitSha': commit_sha, 'files': files, 'warnings': warnings}
