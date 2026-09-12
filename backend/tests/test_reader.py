import base64
import io
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from backend.github_reader import inspect_repository, parse_repository_url, InspectionError, GitHubTransport, MAX_FILE_BYTES, MAX_RESPONSE_BYTES

SHA, TREE, BLOB = 'a' * 40, 'b' * 40, 'c' * 40

def entry(path='package.json', size=2, mode='100644'):
    return dict(path=path, size=size, mode=mode, type='blob', sha=BLOB)

class FakeGitHub:
    def __init__(self, entries=None, content=b'{}', private=False, truncated=False):
        self.entries = entries if entries is not None else [entry()]
        self.content, self.private, self.truncated = content, private, truncated
        self.calls = []
    def get(self, url, deadline):
        self.calls.append(url)
        if '/commits/' in url:
            return {'sha': SHA, 'commit': {'tree': {'sha': TREE}}}
        if '/git/trees/' in url:
            return {'tree': self.entries, 'truncated': self.truncated}
        if '/git/blobs/' in url:
            return {'encoding':'base64', 'content':base64.b64encode(self.content).decode()}
        return {'private':self.private, 'default_branch':'feature/default'}

class ReaderTests(unittest.TestCase):
    def test_urls(self):
        self.assertEqual(parse_repository_url('https://github.com/team/demo.git/'), ('team','demo'))
        for url in ['http://github.com/a/b','https://evil.test/a/b','https://github.com.evil.test/a/b','https://u:p@github.com/a/b','https://github.com/a/b/tree/main','https://github.com/a/b?x=y','https://github.com/a/%2e%2e/b','https://github.com/a/../b','https://github.com/a/..',None]:
            with self.subTest(url=url), self.assertRaises(InspectionError): parse_repository_url(url)

    def test_snapshot_pinning_and_allowlist(self):
        fake=FakeGitHub([entry(),entry('.env'),entry('Dockerfile',mode='120000'),entry('nested/package.json')])
        result=inspect_repository('https://github.com/team/demo',fake)
        self.assertEqual(result['commitSha'],SHA)
        self.assertEqual(result['files'],[{'path':'package.json','content':'{}'}])
        self.assertTrue(any('/commits/feature%2Fdefault' in url for url in fake.calls))
        self.assertTrue(any(f'/git/trees/{TREE}?' in url for url in fake.calls))
        self.assertTrue(any(f'/git/blobs/{BLOB}' in url for url in fake.calls))
        self.assertIn('not a regular file',result['warnings'][0])

    def test_size_limit_skips_without_blob_fetch(self):
        fake=FakeGitHub([entry(size=MAX_FILE_BYTES+1)])
        result=inspect_repository('https://github.com/team/demo',fake)
        self.assertEqual(result['files'],[])
        self.assertEqual(len(fake.calls),3)

    def test_file_count_and_aggregate_limits(self):
        fake=FakeGitHub([entry(f'.github/workflows/job{i}.yml') for i in range(25)])
        self.assertEqual(len(inspect_repository('https://github.com/team/demo',fake)['files']),20)
        self.assertEqual(len(fake.calls),23)
        fake=FakeGitHub([entry(f'.github/workflows/job{i}.yml',MAX_FILE_BYTES) for i in range(6)],content=b'x'*MAX_FILE_BYTES)
        self.assertEqual(len(inspect_repository('https://github.com/team/demo',fake)['files']),4)

    def test_binary_and_python_files(self):
        self.assertEqual(inspect_repository('https://github.com/team/demo',FakeGitHub(content=b'\0x'))['files'],[])
        result=inspect_repository('https://github.com/team/demo',FakeGitHub([entry('requirements.txt')]))
        self.assertEqual(result['files'][0]['path'],'requirements.txt')

    def test_private_truncated_and_malformed(self):
        for fake,code in [(FakeGitHub(private=True),'REPOSITORY_NOT_PUBLIC'),(FakeGitHub(truncated=True),'REPOSITORY_TOO_LARGE'),(FakeGitHub([entry(size=3)]),'GITHUB_RESPONSE_INVALID')]:
            with self.assertRaises(InspectionError) as caught: inspect_repository('https://github.com/team/demo',fake)
            self.assertEqual(caught.exception.code,code)

    def test_transport_statuses(self):
        for status,headers,code in [(404,{},'REPOSITORY_NOT_FOUND'),(409,{},'EMPTY_REPOSITORY'),(429,{},'GITHUB_RATE_LIMITED'),(403,{'X-RateLimit-Remaining':'0'},'GITHUB_RATE_LIMITED'),(301,{},'REPOSITORY_MOVED'),(500,{},'GITHUB_UNAVAILABLE')]:
            transport=GitHubTransport()
            with patch.object(transport.opener,'open',side_effect=HTTPError('https://api.github.com',status,'error',headers,None)):
                with self.assertRaises(InspectionError) as caught: transport.get('https://api.github.com',float('inf'))
                self.assertEqual(caught.exception.code,code)

    def test_transport_bounds_and_no_auth(self):
        transport=GitHubTransport()
        with patch.object(transport.opener,'open',return_value=io.BytesIO(b'x'*(MAX_RESPONSE_BYTES+1))) as opened:
            with self.assertRaises(InspectionError) as caught: transport.get('https://api.github.com',float('inf'))
            self.assertEqual(caught.exception.code,'REPOSITORY_TOO_LARGE')
            self.assertNotIn('Authorization',opened.call_args.args[0].headers)
        with self.assertRaises(InspectionError) as caught: transport.get('https://api.github.com',0)
        self.assertEqual(caught.exception.code,'GITHUB_TIMEOUT')

if __name__ == '__main__': unittest.main()
