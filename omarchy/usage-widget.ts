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
export function render(meters: Meter[], _now = Date.now()) {
  const known = meters.flatMap((m) => m.windows.map((w) => w.usedPercent));
  const worst = known.length ? Math.max(...known) : null;
  const cards = meters.map((m) => {
    const peak = m.windows.length
      ? Math.max(...m.windows.map((w) => w.usedPercent))
      : null;
    const lines = m.windows.map((w) => {
      const window = w.label === "weekly"
        ? "Tydzień"
        : w.label === "subscription"
        ? "Abonament"
        : w.label;
      return window + ": " + w.usedPercent + "% zużyte" + "\n" +
        (w.resetsAt ? "Reset: " + resetLabel(w.resetsAt) : "Brak daty resetu");
    });
    if (m.balance) {
      lines.push(
        m.balance.amount.toFixed(2) + " " + m.balance.currency + " pozostało",
      );
    }
    if (!lines.length) lines.push("Brak danych");
    if (m.stale) lines.push("Dane nieaktualne");
    const updated = m.updatedAt
      ? new Date(m.updatedAt).toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })
      : "—";
    return {
      id: m.id,
      label: m.label,
      value: lines.join("\n"),
      updated: "Stan: " + updated,
      level: level(peak),
    };
  });
  return {
    text: worst === null ? "AI —" : "AI " + Math.round(worst) + "%",
    tooltip: cards.map((c) => c.label + "\n" + c.value + "\n" + c.updated).join(
      "\n\n",
    ),
    class: level(worst),
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
