import "server-only";
export function getNebiusConfig() {
  const apiKey = process.env.NEBIUS_API_KEY;
  const baseURL = process.env.NEBIUS_BASE_URL;
  const model = process.env.NEBIUS_MODEL;
  if (!apiKey || !baseURL || !model) throw new Error("Configure NEBIUS_API_KEY, NEBIUS_BASE_URL, and NEBIUS_MODEL server-side.");
  return { apiKey, baseURL, model };
}
