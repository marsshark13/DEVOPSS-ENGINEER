Validation performed in this session:
- python -m unittest backend.tests.test_reader -v: 8 tests passed.
- python -m compileall -q backend: passed.
- git diff --check: passed.

Not yet verified:
- FastAPI endpoint tests and live server: dependencies could not be downloaded because network access is restricted.
- Live GitHub reads: network access is restricted.

After installing backend/requirements-dev.txt, run:
python -m unittest discover -s backend/tests -v
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

See backend/README.md for the Streamlit integration contract and limitations.
