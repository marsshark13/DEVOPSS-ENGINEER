import time
import streamlit as st

st.set_page_config(page_title="DevOps Agent", layout="wide")

st.markdown("""
<style>
.status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
}
.dot-high { background-color: #f85149; }
.dot-medium { background-color: #d29922; }
.dot-low { background-color: #3fb950; }
</style>
""", unsafe_allow_html=True)

st.title("DevOps Agent")
st.write("Scans your Dockerfile, package.json, and CI config for issues that will break the build.")

# ============================================================
# MOCK DATA — delete this block once P1 (Nemotron) and P2 (Tavily)
# hand you their real functions, then import theirs instead:
#   from analyzer import analyze_repo
#   from enrichment import enrich
# ============================================================
def analyze_repo(files):
    time.sleep(1)  # simulate the Nemotron API call
    return [
        {
            "severity": "HIGH",
            "issue": "Node version mismatch",
            "file": "Dockerfile",
            "explanation": (
                "This Dockerfile pins Node 18, but Next.js 16 requires "
                "Node 20 or higher. The build will fail at install time."
            ),
            "fix": "FROM node:20-alpine",
        },
        {
            "severity": "MEDIUM",
            "issue": "Missing environment validation",
            "file": "next.config.js",
            "explanation": (
                "No check that required env vars (e.g. DATABASE_URL) are "
                "set before build, which causes silent runtime failures."
            ),
            "fix": "if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL')",
        },
    ]


def enrich(finding):
    if finding["severity"] == "HIGH":
        finding["source_url"] = "https://nextjs.org/docs/messages/node-version"
    return finding
# ============================================================
# END MOCK DATA
# ============================================================

files = st.file_uploader(
    "Upload Dockerfile, package.json, or workflow files",
    accept_multiple_files=True,
)

if st.button("Analyze repository", type="primary"):
    with st.spinner("Scanning files..."):
        findings = analyze_repo(files)
        findings = [enrich(f) for f in findings]

    dot_class = {"HIGH": "dot-high", "MEDIUM": "dot-medium", "LOW": "dot-low"}
    for f in findings:
        with st.expander(f"{f['severity']} — {f['issue']} ({f['file']})"):
            st.markdown(
                f'<span class="status-dot {dot_class[f["severity"]]}"></span>{f["severity"]} severity',
                unsafe_allow_html=True,
            )
            st.write(f["explanation"])
            st.code(f["fix"])
            if f.get("source_url"):
                st.caption(f"Source: {f['source_url']}")
            st.button("Apply fix", key=f["issue"])
