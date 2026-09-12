# GitHub adapter

Implement bounded, read-only public repository snapshots first. Validate GitHub URLs, pin a commit SHA, allowlist useful configuration files, cap file sizes and count, and handle 404/rate limits. Never fetch `.env` files or follow arbitrary URLs supplied by repository content. Later, create fixes on a new branch and open a PR only after explicit user action; never push fixes directly to main.
