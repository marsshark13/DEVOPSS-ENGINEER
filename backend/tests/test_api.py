import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.github_reader import InspectionError

class ApiTests(unittest.TestCase):
    def setUp(self): self.client=TestClient(app)
    def test_health_and_docs(self):
        self.assertEqual(self.client.get('/api/health').status_code,200)
        self.assertEqual(self.client.get('/openapi.json').status_code,200)
    def test_validation(self):
        for body,media,status in [('{}','text/plain',415),('{','application/json',400),('null','application/json',400),('x'*2049,'application/json',413),('{}','application/json',400)]:
            response=self.client.post('/api/repositories/inspect',content=body,headers={'Content-Type':media})
            self.assertEqual(response.status_code,status)
            self.assertIn('code',response.json()['error'])
    def test_snapshot(self):
        snapshot={'owner':'a','name':'b','commitSha':'a'*40,'files':[],'warnings':[]}
        with patch('backend.main.inspect_repository',return_value=snapshot) as reader:
            response=self.client.post('/api/repositories/inspect',json={'repositoryUrl':'https://github.com/a/b'})
        self.assertEqual(response.json(),snapshot)
        self.assertEqual(response.headers['cache-control'],'no-store')
        reader.assert_called_once_with('https://github.com/a/b')
    def test_error_redaction(self):
        for error,status,code in [(InspectionError('GITHUB_RATE_LIMITED','Try later.',429),429,'GITHUB_RATE_LIMITED'),(RuntimeError('sensitive detail'),500,'INTERNAL_ERROR')]:
            with patch('backend.main.inspect_repository',side_effect=error):
                response=self.client.post('/api/repositories/inspect',json={'repositoryUrl':'https://github.com/a/b'})
            self.assertEqual(response.status_code,status)
            self.assertEqual(response.json()['error']['code'],code)
            self.assertNotIn('sensitive detail',response.text)

if __name__ == '__main__': unittest.main()
