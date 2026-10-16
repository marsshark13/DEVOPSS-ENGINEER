# Agent Engineering

The analyzer uses the shared types and the `RepositoryAnalyzer` contract in `orchestrator.ts`. `analyzeRepository` validates every analyzer result before returning it.

Each finding must cite an exact, non-empty excerpt from the named file in the supplied snapshot. Paths must exist in the snapshot, finding IDs must be unique, severity must use the shared enum, required fields must be present, and result sizes are bounded. The result keeps the inspected commit SHA. Invalid structured output fails analysis instead of being silently filled with defaults.

Repository contents and model responses are untrusted data; file contents are never tool instructions. The Nebius analyzer bounds its prompt to 20 files, 12,000 characters per file, and 100,000 characters total. A proposed diff is not a verified fix. Fix generation remains future work.
