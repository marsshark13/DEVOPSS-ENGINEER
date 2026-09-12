# Nebius inference

`client.ts` calls the OpenAI-compatible Nebius Token Factory chat completions endpoint with server-side `fetch`. Configure:

- `NEBIUS_API_KEY`
- `NEBIUS_BASE_URL`, for example `https://api.tokenfactory.nebius.com/v1` or a region endpoint such as `https://api.tokenfactory.us-central1.nebius.com/v1`
- `NEBIUS_MODEL`, for example an NVIDIA model/routing key selected in the Nebius console
- `NEBIUS_TIMEOUT_MS`, optional

`analyzer.ts` adapts the model call to the shared `RepositoryAnalyzer` contract and validates that findings cite only files present in the bounded snapshot. Keep prompts, model output, and logs free of credentials. Never expose these variables with `NEXT_PUBLIC_`.

For the demo, record the exact model ID/routing key, endpoint region, request timestamp, and a redacted response sample as integration evidence.
