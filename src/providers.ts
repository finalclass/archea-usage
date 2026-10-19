// Adapted from fc/operators src/usage.ts, revision dcc7c0e.
import { authenticatedGet } from "./auth.ts";
export type Window = {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
};
export type GreenModel = {
  model: string;
  amount: number;
  calls: number;
};
export type GreenSpend = {
  amount: number;
  currency: "EUR";
  from: string;
  until: string;
  calls: number;
  models: GreenModel[];
};
export type Meter = {
  id: string;
  label: string;
  windows: Window[];
  balance: { amount: number; currency: string } | null;
  spend: GreenSpend | null;
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
export const activeMeterIds = ["codex", "openrouter", "greenpt"];
export function empty(id: string, error: string | null = null): Meter {
  return {
    id,
    label: id === "greenpt_opencode" ? "GreenPT · moje" : labels[id] ?? id,
    windows: [],
    balance: null,
    spend: null,
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
export function parseGreenSpend(data: unknown): GreenSpend | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const amount = Number(row.totalCostEur);
  const from = reset(row.from);
  const until = reset(row.until);
  const calls = row.totalCalls;
  if (
    !Number.isFinite(amount) || amount < 0 || !from || !until ||
    !Number.isInteger(calls) || (calls as number) < 0
  ) return null;
  const models: GreenModel[] = [];
  if (Array.isArray(row.byModel)) {
    for (const item of row.byModel) {
      if (!item || typeof item !== "object") continue;
      const model = item as Record<string, unknown>;
      const modelAmount = Number(model.costEur);
      if (
        typeof model.modelId !== "string" || model.modelId.trim() === "" ||
        !Number.isFinite(modelAmount) || modelAmount < 0 ||
        !Number.isInteger(model.calls) || (model.calls as number) < 0
      ) continue;
      models.push({
        model: model.modelId,
        amount: modelAmount,
        calls: model.calls as number,
      });
    }
  }
  return {
    amount,
    currency: "EUR",
    from,
    until,
    calls: calls as number,
    models,
  };
}
export async function resolveGreenptKey(
  home: string,
  configured?: string | null,
): Promise<string> {
  const explicit = typeof configured === "string" ? configured.trim() : "";
  if (explicit) return explicit;
  const auth = JSON.parse(
    await Deno.readTextFile(`${home}/.local/share/opencode/auth.json`),
  );
  const key = auth?.greenpt?.key;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("login_required");
  }
  return key.trim();
}
// Keep both credential sources instead of letting an explicit key hide OpenCode.
// Registration contains public meter IDs only; keys are reloaded for each poll.
export async function meterIds(
  home: string,
  configured?: string | null,
): Promise<string[]> {
  const defaults = activeMeterIds;
  const explicit = configured?.trim();
  if (!explicit) return defaults;
  try {
    if (await resolveGreenptKey(home) === explicit) return defaults;
  } catch {
    // A broken original login must be visible independently of the second account.
  }
  return ["codex", "greenpt_opencode", "greenpt", "openrouter"];
}
const greenptAgents = "https://api.greenpt.ai/v1/agents";
const greenptUsage = "https://api.greenpt.ai/v1/agents/usage";
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
function greenptRequest(key: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  };
}
export async function readGreenpt(
  key: string,
  fetchImpl: Fetcher = (input, init) => fetch(input, init),
): Promise<
  { balance: { amount: number; currency: "EUR" }; spend: GreenSpend | null }
> {
  const agentsPromise = fetchImpl(greenptAgents, greenptRequest(key));
  const usagePromise = fetchImpl(greenptUsage, greenptRequest(key)).catch(() =>
    null
  );
  let agents: Response;
  try {
    agents = await agentsPromise;
  } catch (error) {
    const usage = await usagePromise;
    await usage?.body?.cancel().catch(() => {});
    throw error;
  }
  const usage = await usagePromise;
  try {
    if (!agents.ok) throw new Error(`provider_http_${agents.status}`);
    const amount = parseGreenBalance(agents.headers.get("X-Credits-Remaining"));
    let spend: GreenSpend | null = null;
    if (usage?.ok) {
      try {
        spend = parseGreenSpend(await usage.json());
      } catch {
        spend = null;
      }
    }
    return { balance: { amount, currency: "EUR" }, spend };
  } finally {
    await agents.body?.cancel().catch(() => {});
    await usage?.body?.cancel().catch(() => {});
  }
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
export async function collect(
  id: string,
  home: string,
  options: { greenptKey?: string | null } = {},
): Promise<Meter> {
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
  } else if (id === "greenpt" || id === "greenpt_opencode") {
    const key = await resolveGreenptKey(
      home,
      id === "greenpt" ? options.greenptKey : undefined,
    );
    const reading = await readGreenpt(key);
    if (id === "greenpt" && options.greenptKey?.trim()) {
      m.label = "GreenPT · dodatkowe";
    }
    m.balance = reading.balance;
    m.spend = reading.spend;
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
