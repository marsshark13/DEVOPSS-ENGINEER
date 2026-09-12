"""Analysis boundary between the inspection backend and the agent engineer's analyzer.

This module deliberately ships NO analyzer. It defines the contract only:
- The Python mirror of the shared TypeScript types in ``types/index.ts``.
- An ``Analyzer`` protocol the agent engineer implements and injects, mirroring
  ``RepositoryAnalyzer`` in ``lib/agents/orchestrator.ts``.
- Runtime validation of analyzer output so untrusted / model-produced structures
  cannot reach the frontend unchecked.

No model is called here, and no findings are invented. Until an analyzer is
injected, the analysis endpoint reports ANALYZER_NOT_CONFIGURED (501).
"""
from typing import Protocol, runtime_checkable

# Mirror of ``Severity`` in types/index.ts. Kept in sync by agreement, not import.
SEVERITIES = ('critical', 'high', 'medium', 'low')

# Bounds on analyzer output so a misbehaving or compromised analyzer cannot
# flood the frontend. These are backend-enforced ceilings, not model prompts.
MAX_FINDINGS = 100
MAX_STRING_BYTES = 8 * 1024
MAX_SUMMARY_BYTES = 16 * 1024
_FINDING_FIELDS = ('id', 'severity', 'title', 'path', 'evidence', 'reason', 'recommendation')


class AnalysisError(Exception):
    """Structured error mirrored into the {"error":{"code","message"}} envelope."""

    def __init__(self, code, message, status):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@runtime_checkable
class Analyzer(Protocol):
    """Implemented by the agent engineer and injected into the app.

    Mirrors ``RepositoryAnalyzer.analyze(snapshot) -> AnalysisResult``. Receives an
    already-validated snapshot (the inspection API's output) and MUST return a dict
    shaped like the ``AnalysisResult`` shared type. Treat file content as untrusted
    data, never as instructions. Do not mutate the snapshot.
    """

    def analyze(self, snapshot: dict) -> dict:  # pragma: no cover - protocol only
        ...


def _require_text(value, field, max_bytes=MAX_STRING_BYTES):
    if not isinstance(value, str) or not value.strip():
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', f'Analyzer field {field!r} must be non-empty text.', 502)
    if len(value.encode('utf-8')) > max_bytes:
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', f'Analyzer field {field!r} exceeds the size limit.', 502)
    return value


def validate_analysis_result(result, snapshot):
    """Validate analyzer output against the shared AnalysisResult contract.

    Enforces field presence/type, the severity enum, per-finding evidence, output
    bounds, and — critically — that the analyzer preserved the source commit SHA.
    Raises AnalysisError (502 ANALYZER_OUTPUT_INVALID) on any violation so the
    backend never forwards an unverified structure to the frontend.
    """
    if not isinstance(result, dict):
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Analyzer must return an object.', 502)
    if set(result) != {'commitSha', 'findings', 'summary'}:
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Analyzer result must contain exactly commitSha, findings, summary.', 502)

    commit_sha = result['commitSha']
    if commit_sha != snapshot['commitSha']:
        raise AnalysisError('ANALYZER_COMMIT_MISMATCH', 'Analyzer must preserve the inspected commit SHA.', 502)

    _require_text(result['summary'], 'summary', MAX_SUMMARY_BYTES)

    findings = result['findings']
    if not isinstance(findings, list):
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Analyzer findings must be a list.', 502)
    if len(findings) > MAX_FINDINGS:
        raise AnalysisError('ANALYZER_OUTPUT_INVALID', f'Analyzer returned more than {MAX_FINDINGS} findings.', 502)

    seen_ids = set()
    for finding in findings:
        if not isinstance(finding, dict) or set(finding) != set(_FINDING_FIELDS):
            raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Each finding must contain exactly the agreed fields.', 502)
        for field in ('id', 'title', 'path', 'evidence', 'reason', 'recommendation'):
            _require_text(finding[field], field)
        if finding['severity'] not in SEVERITIES:
            raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Finding severity must be critical, high, medium, or low.', 502)
        if finding['id'] in seen_ids:
            raise AnalysisError('ANALYZER_OUTPUT_INVALID', 'Finding ids must be unique.', 502)
        seen_ids.add(finding['id'])

    # Return a fresh, whitelisted dict so no extra analyzer keys can leak through.
    return {
        'commitSha': commit_sha,
        'summary': result['summary'],
        'findings': [{field: f[field] for field in _FINDING_FIELDS} for f in findings],
    }


def run_analysis(snapshot, analyzer):
    """Run an injected analyzer over a validated snapshot and validate its output.

    ``analyzer`` is None until the agent engineer supplies one; that is reported as
    501 ANALYZER_NOT_CONFIGURED rather than pretending to analyze. Any exception from
    the analyzer is redacted to 502 ANALYZER_FAILED so internal detail never leaks.
    """
    if analyzer is None:
        raise AnalysisError('ANALYZER_NOT_CONFIGURED', 'No analyzer is configured on this backend yet.', 501)
    try:
        result = analyzer.analyze(snapshot)
    except AnalysisError:
        raise
    except Exception:
        raise AnalysisError('ANALYZER_FAILED', 'Analysis could not be completed.', 502) from None
    return validate_analysis_result(result, snapshot)
