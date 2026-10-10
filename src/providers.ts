// Adapted from fc/operators src/usage.ts, revision dcc7c0e.
import { authenticatedGet } from "./auth.ts";
export type Window = {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
};
export type Meter = {
  id: string;
  label: string;
  windows: Window[];
  balance: { amount: number; currency: string } | null;
  updatedAt: string | null;
  stale: boolean;
  error: string | null;
};
export const labels: Record<string, string> = {
  grok: "Grok",
  codex: "Codex",
  openrouter: "OpenRouter",
  greenpt: "GreenPT",
};
export function empty(id: string, error: string | null = null): Meter {
  return {
    id,
    label: labels[id],
    windows: [],
    balance: null,
    updatedAt: null,
    stale: true,
    error,
  };
}
function num(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}
export function reset(x: unknown): string | null {
  if (x == null) return null;
  const d = typeof x === "number"
    ? new Date(x < 1e12 ? x * 1000 : x)
    : new Date(String(x));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
export function parseCodex(data: any): Window[] {
  return [data.rate_limit?.primary_window, data.rate_limit?.secondary_window]
    .filter((w) => w && num(w.used_percent))
    .map((w) => ({
      label: w.limit_window_seconds === 604800
        ? "weekly"
        : w.limit_window_seconds === 18000
        ? "5h"
        : `window-${w.limit_window_seconds ?? "unknown"}`,
      usedPercent: w.used_percent,
      resetsAt: reset(w.reset_at),
    }));
}
export function parseGrok(data: any): Window[] {
  const c = data.config;
  if (!num(c?.creditUsagePercent)) return [];
  return [{
    label: "subscription",
    usedPercent: c.creditUsagePercent,
    resetsAt: reset(
      c.billingPeriodEnd ?? c.weeklyResetAt ?? c.creditResetAt ?? c.resetAt,
    ),
  }];
}
export function parseBalance(data: any): number {
  const d = data.data;
  if (!num(d?.total_credits) || !num(d?.total_usage)) {
    throw new Error("invalid_response");
  }
  return Math.round((d.total_credits - d.total_usage) * 100) / 100;
}
export function parseGreenBalance(header: string | null): number {
  if (
    header === null || header.trim() === "" || !Number.isFinite(Number(header))
  ) {
    throw new Error("invalid_response");
  }
  return Number(header);
}
async function get(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`provider_http_${r.status}`);
  }
  return await r.json();
}
export async function collect(id: string, home: string): Promise<Meter> {
  const m = empty(id);
  const read = async (path: string) =>
    JSON.parse(await Deno.readTextFile(`${home}/${path}`));
  if (id === "grok") {
    m.windows = parseGrok(
      await authenticatedGet(
        id,
        home,
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      ),
    );
    if (!m.windows.length) throw new Error("invalid_response");
  } else if (id === "codex") {
    m.windows = parseCodex(
      await authenticatedGet(
        id,
        home,
        "https://chatgpt.com/backend-api/wham/usage",
      ),
    );
    if (!m.windows.length) throw new Error("invalid_response");
  } else if (id === "openrouter") {
    const auth = await read(".local/share/opencode/auth.json");
    if (!auth.openrouter?.key) throw new Error("login_required");
    m.balance = {
      amount: parseBalance(
        await get("https://openrouter.ai/api/v1/credits", {
          Authorization: `Bearer ${auth.openrouter.key}`,
        }),
      ),
      currency: "USD",
    };
  } else if (id === "greenpt") {
    const auth = await read(".local/share/opencode/auth.json");
    if (!auth.greenpt?.key) throw new Error("login_required");
    // Support's recommended balance probe: one input character, one output token.
    // Runs only during scheduled cache refresh, never on a client request.
    const response = await fetch("https://api.greenpt.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.greenpt.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "green-l-raw",
        messages: [{ role: "user", content: "." }],
        max_tokens: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`provider_http_${response.status}`);
    m.balance = {
      amount: parseGreenBalance(response.headers.get("X-Credits-Remaining")),
      currency: "EUR",
    };
  } else return empty(id, "unknown_provider");
  return {
    ...m,
    updatedAt: new Date().toISOString(),
    stale: false,
    error: null,
  };
}
export function safeError(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  if (
    /^(provider_http_\d{3}|login_required|invalid_response|auth_refresh_failed|credentials_write_failed)$/
      .test(message)
  ) {
    return message;
  }
  if (e instanceof Deno.errors.NotFound) return "credentials_missing";
  return "provider_unavailable";
}
