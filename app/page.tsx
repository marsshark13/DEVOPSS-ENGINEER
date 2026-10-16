import { WorkstreamCard } from "@/components/workstream-card";
import { RepositoryAnalyzerForm } from "@/components/repository-analyzer";
const streams = [
  { title: "DevOps / Nebius", detail: "Connect NVIDIA models and isolated build verification." },
  { title: "Agent Engineering", detail: "Turn repository evidence into findings and reviewable fixes." },
  { title: "Backend / GitHub", detail: "Read repository snapshots and prepare pull requests." },
  { title: "Frontend / UX", detail: "Make findings, diffs, and execution logs easy to understand." },
];
export default function Home() {
  return <main><p className="eyebrow">NEBIUS × NVIDIA · HACKATHON STARTER</p>
    <h1>Your next build.<br /><span>Understood.</span></h1>
    <p className="intro">An AI DevOps Engineer that inspects a GitHub repository and explains build issues with evidence from its configuration files.</p>
    <RepositoryAnalyzerForm />
    <h2>One workflow. Four workstreams.</h2><section aria-label="Team workstreams">{streams.map(stream => <WorkstreamCard key={stream.title} {...stream} />)}</section>
    <p className="flow">Repository → Evidence-backed findings → Reviewed diff → Sandbox verification → Pull request</p>
    <a href="https://github.com/marsshark13/DEVOPSS-ENGINEER">Project repository and setup guide ↗</a>
  </main>;
}
