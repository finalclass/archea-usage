// Runs on ROG, where Claude Code is logged in. Reads the Claude OAuth token
// read-only, asks Anthropic for subscription limits and sends only the
// percentages and reset times to the Archea usage API. The token never leaves
// this machine and is never renewed here, so Claude Code keeps sole ownership.
import { parseClaude, type Window } from "../src/providers.ts";

type Reading = { windows: Window[] } | { error: string };
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
export const claudeUsageUrl = "https://api.anthropic.com/api/oauth/usage";

export async function readClaude(
  credentialsPath: string,
  fetchImpl: Fetcher = (input, init) => fetch(input, init),
  now = Date.now(),
): Promise<Reading> {
  let oauth: { accessToken?: unknown; expiresAt?: unknown } | undefined;
  try {
    oauth = JSON.parse(await Deno.readTextFile(credentialsPath))?.claudeAiOauth;
  } catch (e) {
    return {
      error: e instanceof Deno.errors.NotFound
        ? "credentials_missing"
        : "invalid_response",
    };
  }
  if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) {
    return { error: "login_required" };
  }
  // Claude Code renews the token when it runs; until then report it plainly.
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= now) {
    return { error: "auth_expired" };
  }
  let response: Response;
  try {
    response = await fetchImpl(claudeUsageUrl, {
      headers: {
        Authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { error: "provider_unavailable" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return {
      error: response.status === 401
        ? "auth_expired"
        : `provider_http_${response.status}`,
    };
  }
  try {
    const windows = parseClaude(await response.json());
    return windows.length ? { windows } : { error: "invalid_response" };
  } catch {
    return { error: "invalid_response" };
  }
}

export function pushUrl(base: string): URL {
  const url = new URL("/v1/push/claude", base);
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("HTTPS required");
  }
  return url;
}

if (import.meta.main) {
  const home = Deno.env.get("HOME")!;
  const claudeDir = Deno.env.get("CLAUDE_CONFIG_DIR") || `${home}/.claude`;
  const config = JSON.parse(
    await Deno.readTextFile(
      Deno.args[0] ?? `${home}/.config/archea-usage/push.json`,
    ),
  );
  if (typeof config.url !== "string" || typeof config.token !== "string") {
    throw new Error("push.json requires url and token");
  }
  const reading = await readClaude(`${claudeDir}/.credentials.json`);
  const r = await fetch(pushUrl(config.url), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reading),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  await r.body?.cancel().catch(() => {});
  const result = "windows" in reading
    ? reading.windows.map((w) => `${w.label} ${w.usedPercent}%`).join(", ")
    : reading.error;
  console.log(`Claude: ${result}; Archea HTTP ${r.status}`);
  if (r.status !== 204) Deno.exitCode = 1;
}
