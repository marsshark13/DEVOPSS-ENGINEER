import { WorkstreamCard } from "@/components/workstream-card";
const streams = [
  { title: "DevOps / Nebius", detail: "Connect NVIDIA models and isolated build verification." },
  { title: "Agent Engineering", detail: "Turn repository evidence into findings and reviewable fixes." },
  { title: "Backend / GitHub", detail: "Read repository snapshots and prepare pull requests." },
  { title: "Frontend / UX", detail: "Make findings, diffs, and execution logs easy to understand." },
];
export default function Home() {
  return <main><p className="eyebrow">NEBIUS × NVIDIA · HACKATHON STARTER</p>
    <h1>Your next build.<br /><span>Understood.</span></h1>
    <p className="intro">An AI DevOps Engineer that will inspect a GitHub repository, explain build issues, propose fixes, and verify them in an isolated sandbox.</p>
    <aside><strong>Starter ready</strong><p>Live repository analysis, model calls, sandbox execution, and PR creation are planned work. No credentials are needed to run this page.</p></aside>
    <h2>One workflow. Four workstreams.</h2><section aria-label="Team workstreams">{streams.map(stream => <WorkstreamCard key={stream.title} {...stream} />)}</section>
    <p className="flow">Repository → Findings → Reviewed diff → Sandbox verification → Pull request</p>
    <a href="https://github.com/marsshark13/DEVOPSS-ENGINEER">Project repository and setup guide ↗</a>
  </main>;
}
