import unittest
from backend.analysis_service import (
    AnalysisError, run_analysis, validate_analysis_result, MAX_FINDINGS, MAX_STRING_BYTES,
)

SNAPSHOT = {'owner': 'a', 'name': 'b', 'commitSha': 'a' * 40, 'files': [], 'warnings': []}


def finding(**overrides):
    base = {
        'id': 'F1', 'severity': 'high', 'title': 'Pinned base image missing',
        'path': 'Dockerfile', 'evidence': 'FROM python', 'reason': 'Unpinned tag',
        'recommendation': 'Pin a digest.',
    }
    base.update(overrides)
    return base


def result(findings=None, summary='One issue found.', commit=SNAPSHOT['commitSha']):
    return {'commitSha': commit, 'findings': findings if findings is not None else [finding()], 'summary': summary}


class FakeAnalyzer:
    def __init__(self, output=None, exc=None):
        self.output, self.exc, self.calls = output, exc, []

    def analyze(self, snapshot):
        self.calls.append(snapshot)
        if self.exc is not None:
            raise self.exc
        return self.output if self.output is not None else result()


class AnalysisServiceTests(unittest.TestCase):
    def test_not_configured_when_analyzer_missing(self):
        with self.assertRaises(AnalysisError) as caught:
            run_analysis(SNAPSHOT, None)
        self.assertEqual(caught.exception.code, 'ANALYZER_NOT_CONFIGURED')
        self.assertEqual(caught.exception.status, 501)

    def test_valid_result_is_whitelisted(self):
        analyzer = FakeAnalyzer(output=result())
        out = run_analysis(SNAPSHOT, analyzer)
        self.assertEqual(out['commitSha'], SNAPSHOT['commitSha'])
        self.assertEqual(len(out['findings']), 1)
        self.assertEqual(set(out['findings'][0]), {'id', 'severity', 'title', 'path', 'evidence', 'reason', 'recommendation'})
        self.assertEqual(analyzer.calls, [SNAPSHOT])

    def test_extra_top_level_key_rejected(self):
        with self.assertRaises(AnalysisError) as caught:
            validate_analysis_result(result() | {'unexpected': 1}, SNAPSHOT)
        self.assertEqual(caught.exception.code, 'ANALYZER_OUTPUT_INVALID')

    def test_commit_mismatch_rejected(self):
        with self.assertRaises(AnalysisError) as caught:
            validate_analysis_result(result(commit='b' * 40), SNAPSHOT)
        self.assertEqual(caught.exception.code, 'ANALYZER_COMMIT_MISMATCH')

    def test_bad_severity_and_fields(self):
        for bad in [
            result(findings=[finding(severity='blocker')]),
            result(findings=[finding(evidence='')]),
            result(findings=[{'id': 'F1'}]),
            result(findings='notalist'),
            result(summary=''),
            result(findings=[finding(id='D'), finding(id='D')]),
        ]:
            with self.subTest(bad=bad), self.assertRaises(AnalysisError) as caught:
                validate_analysis_result(bad, SNAPSHOT)
            self.assertEqual(caught.exception.status, 502)

    def test_output_bounds(self):
        with self.assertRaises(AnalysisError):
            validate_analysis_result(result(findings=[finding(id=f'F{i}') for i in range(MAX_FINDINGS + 1)]), SNAPSHOT)
        with self.assertRaises(AnalysisError):
            validate_analysis_result(result(findings=[finding(evidence='x' * (MAX_STRING_BYTES + 1))]), SNAPSHOT)

    def test_analyzer_exception_is_redacted(self):
        analyzer = FakeAnalyzer(exc=RuntimeError('secret internal detail'))
        with self.assertRaises(AnalysisError) as caught:
            run_analysis(SNAPSHOT, analyzer)
        self.assertEqual(caught.exception.code, 'ANALYZER_FAILED')
        self.assertNotIn('secret internal detail', caught.exception.message)


if __name__ == '__main__':
    unittest.main()
