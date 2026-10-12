import type { Meter } from "../src/providers.ts";
export function level(percent: number | null): string {
  return percent !== null && percent >= 100
    ? "critical"
    : percent !== null && percent >= 80
    ? "warning"
    : "normal";
}
export function resetLabel(date: string): string {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(date));
}
export function windowLabel(label: string): string {
  return label === "weekly"
    ? "Tydzień"
    : label === "subscription"
    ? "Abonament"
    : label === "5h"
    ? "5 h"
    : label;
}
export function percentLabel(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) +
    "%";
}
function clock(date: string): string {
  return new Date(date).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function money(amount: number): string {
  if (amount === 0) return "0.00";
  if (Math.abs(amount) >= 0.01) return amount.toFixed(2);
  return amount.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}
export function errorLabel(error: string | null): string | null {
  if (error === "provider_http_401") return "odrzucony klucz";
  if (error === "provider_http_402") return "brak środków";
  if (error === "provider_http_429") return "limit zapytań";
  if (error === "invalid_response") return "niepoprawny pomiar";
  if (error === "provider_unavailable") return "awaria sieci";
  if (error === "login_required") return "brak logowania";
  if (error === "credentials_missing") return "brak klucza";
  if (error && /^provider_http_\d{3}$/.test(error)) return "błąd dostawcy";
  if (error) return "błąd pomiaru";
  return null;
}
export function periodLabel(from: string, until: string): string {
  const format = new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
  return format.format(new Date(from)) + "–" + format.format(new Date(until));
}
export function render(meters: Meter[], _now = Date.now()) {
  const known = meters.flatMap((m) => m.windows.map((w) => w.usedPercent));
  const worst = known.length ? Math.max(...known) : null;
  let latest = -Infinity;
  for (const meter of meters) {
    if (!meter.updatedAt) continue;
    const time = new Date(meter.updatedAt).getTime();
    if (time > latest) latest = time;
  }
  const stamp = Number.isFinite(latest) && latest > -Infinity
    ? clock(new Date(latest).toISOString())
    : null;
  const cards = meters.map((m) => {
    const peak = m.windows.length
      ? Math.max(...m.windows.map((w) => w.usedPercent))
      : null;
    const lines = m.windows.map((w) => {
      return windowLabel(w.label) + ": " + w.usedPercent + "% zużyte" + "\n" +
        (w.resetsAt ? "Reset: " + resetLabel(w.resetsAt) : "Brak daty resetu");
    });
    if (m.balance) {
      lines.push(
        money(m.balance.amount) + " " + m.balance.currency + " pozostało",
      );
    }
    const spend = m.spend
      ? {
        amount: money(m.spend.amount),
        currency: m.spend.currency,
        period: periodLabel(m.spend.from, m.spend.until),
        line: money(m.spend.amount) + " " + m.spend.currency + " · " +
          periodLabel(m.spend.from, m.spend.until),
        models: m.spend.models.map((model) =>
          model.model + " · " + money(model.amount) + " EUR"
        ).join("\n"),
      }
      : null;
    if (spend) lines.push(spend.line);
    if (!lines.length) lines.push("Brak danych");
    if (m.stale) lines.push("Dane nieaktualne");
    const problem = errorLabel(m.error);
    if (problem) lines.push(problem);
    const updated = m.updatedAt ? clock(m.updatedAt) : "—";
    const status = [
      m.stale ? "nieaktualne" : null,
      problem,
      "stan " + updated,
    ].filter((part) => part).join(" · ");
    return {
      id: m.id,
      label: m.label,
      value: lines.join("\n"),
      updated: "Stan: " + updated,
      updatedTime: updated,
      status,
      errorLabel: problem,
      level: level(peak),
      stale: m.stale,
      peakLabel: peak === null ? null : percentLabel(peak),
      balance: m.balance
        ? {
          amount: money(m.balance.amount),
          currency: m.balance.currency,
        }
        : null,
      spend,
      windows: m.windows.map((w) => ({
        label: windowLabel(w.label),
        percent: w.usedPercent,
        percentLabel: percentLabel(w.usedPercent),
        level: level(w.usedPercent),
        reset: w.resetsAt ? resetLabel(w.resetsAt) : null,
      })),
    };
  });
  const parts: string[] = [];
  if (worst !== null) {
    parts.push("Najwyższe zużycie: " + Math.round(worst) + "%");
  }
  if (stamp) parts.push((worst === null ? "Stan " : "stan ") + stamp);
  return {
    text: worst === null ? "AI —" : "AI " + Math.round(worst) + "%",
    tooltip: cards.map((c) => c.label + "\n" + c.value + "\n" + c.updated).join(
      "\n\n",
    ),
    class: level(worst),
    summary: parts.join(" · "),
    cards,
  };
}
if (import.meta.main) {
  const home = Deno.env.get("HOME")!;
  try {
    const c = JSON.parse(
      await Deno.readTextFile(
        Deno.args[0] ?? `${home}/.config/archea-usage/client.json`,
      ),
    );
    const url = new URL("/v1/usage", c.url);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    const auth = btoa(
      String.fromCharCode(
        ...new TextEncoder().encode(`${c.username}:${c.password}`),
      ),
    );
    const r = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data.version !== 1 || !Array.isArray(data.meters)) {
      throw new Error("Unsupported API");
    }
    console.log(JSON.stringify(render(data.meters)));
  } catch {
    console.log(
      JSON.stringify({
        text: "AI !",
        tooltip:
          "Brak połączenia. Sprawdź ~/.config/archea-usage/client.json i dostęp do API.",
        class: "error",
      }),
    );
    Deno.exitCode = 1;
  }
}
