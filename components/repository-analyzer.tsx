"use client";

import { FormEvent, useState } from "react";
import type { AnalysisResult, Finding } from "@/types";

type AnalysisResponse = AnalysisResult | { error: { code: string; message: string } };

export function RepositoryAnalyzerForm() {
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/repositories/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositoryUrl }),
      });
      const payload = await response.json() as AnalysisResponse;
      if (!response.ok || "error" in payload) {
        setError("error" in payload ? `${payload.error.message} (${payload.error.code})` : "Analysis failed. Try again.");
        return;
      }
      setResult(payload);
    } catch {
      setError("Could not reach the local analysis service. Check that the development server is running.");
    } finally {
      setLoading(false);
    }
  }

  return <section className="analyzer" aria-labelledby="analyzer-title">
    <h2 id="analyzer-title">Analyze a public GitHub repository</h2>
    <p>We inspect a small set of build and CI files, then ask the configured Nebius model for evidence-backed findings.</p>
    <form onSubmit={submit}>
      <label htmlFor="repository-url">GitHub repository URL</label>
      <div className="form-row">
        <input
          id="repository-url"
          type="url"
          required
          placeholder="https://github.com/owner/repository"
          value={repositoryUrl}
          onChange={(event) => setRepositoryUrl(event.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading}>{loading ? "Analyzing…" : "Analyze repository"}</button>
      </div>
    </form>
    {loading && <p role="status">Reading the repository and requesting model analysis. This can take a few seconds.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {result && <div className="analysis-result" aria-live="polite">
      <h3>Analysis result</h3>
      <p>{result.summary}</p>
      <p className="commit">Analyzed commit: <code>{result.commitSha}</code></p>
      {result.findings.length === 0
        ? <p>No supported findings were reported for the inspected files.</p>
        : result.findings.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
    </div>}
  </section>;
}

function FindingCard({ finding }: { finding: Finding }) {
  return <article className="finding">
    <p className={`severity severity-${finding.severity}`}>{finding.severity}</p>
    <h4>{finding.title}</h4>
    <p className="file-path">{finding.path}</p>
    <blockquote><code>{finding.evidence}</code></blockquote>
    <p>{finding.reason}</p>
    <p><strong>Recommendation:</strong> {finding.recommendation}</p>
  </article>;
}
