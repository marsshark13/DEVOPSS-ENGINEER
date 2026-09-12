# Sandbox execution

Implement Token Factory Sandboxes for the Coding and Agentic Engineering track after verifying current SDK access. This starter deliberately has no command execution implementation. Inference and sandbox execution are separate adapters.

Use disposable isolated environments, explicit resource/time limits, restricted network access, no host mounts or production secrets, and guaranteed cleanup. Repository install scripts are untrusted code. Never run analyzed repositories in the web server process. Record the exact commit, applied diff, commands, exit codes, and redacted logs; report timeout/failure truthfully.
