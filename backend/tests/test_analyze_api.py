import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.github_reader import InspectionError

SNAPSHOT = {'owner': 'a', 'name': 'b', 'commitSha': 'a' * 40, 'files': [], 'warnings': []}
GOOD_RESULT = {
    'commitSha': SNAPSHOT['commitSha'],
    'summary': 'One issue found.',
    'findings': [{
        'id': 'F1', 'severity': 'high', 'title': 'Unpinned base image',
        'path': 'Dockerfile', 'evidence': 'FROM python', 'reason': 'Unpinned tag',
        'recommendation': 'Pin a digest.',
    }],
}


class InjectedAnalyzer:
    def __init__(self, output):
        self.output = output

    def analyze(self, snapshot):
        return self.output


class AnalyzeApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        app.state.analyzer = None  # reset injected analyzer between tests

    def tearDown(self):
        app.state.analyzer = None

    def test_shares_request_validation(self):
        for body, media, status in [('{}', 'text/plain', 415), ('{', 'application/json', 400),
                                    ('x' * 2049, 'application/json', 413), ('{}', 'application/json', 400)]:
            response = self.client.post('/api/repositories/analyze', content=body, headers={'Content-Type': media})
            self.assertEqual(response.status_code, status)
            self.assertIn('code', response.json()['error'])

    def test_not_configured(self):
        with patch('backend.main.inspect_repository', return_value=SNAPSHOT):
            response = self.client.post('/api/repositories/analyze', json={'repositoryUrl': 'https://github.com/a/b'})
        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.json()['error']['code'], 'ANALYZER_NOT_CONFIGURED')

    def test_success_with_injected_analyzer(self):
        app.state.analyzer = InjectedAnalyzer(GOOD_RESULT)
        with patch('backend.main.inspect_repository', return_value=SNAPSHOT):
            response = self.client.post('/api/repositories/analyze', json={'repositoryUrl': 'https://github.com/a/b'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), GOOD_RESULT)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_invalid_analyzer_output_is_502(self):
        app.state.analyzer = InjectedAnalyzer({'commitSha': SNAPSHOT['commitSha'], 'summary': '', 'findings': []})
        with patch('backend.main.inspect_repository', return_value=SNAPSHOT):
            response = self.client.post('/api/repositories/analyze', json={'repositoryUrl': 'https://github.com/a/b'})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()['error']['code'], 'ANALYZER_OUTPUT_INVALID')

    def test_inspection_error_surfaces_before_analysis(self):
        app.state.analyzer = InjectedAnalyzer(GOOD_RESULT)
        with patch('backend.main.inspect_repository',
                   side_effect=InspectionError('REPOSITORY_NOT_FOUND', 'Not found.', 404)):
            response = self.client.post('/api/repositories/analyze', json={'repositoryUrl': 'https://github.com/a/b'})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['error']['code'], 'REPOSITORY_NOT_FOUND')


if __name__ == '__main__':
    unittest.main()
