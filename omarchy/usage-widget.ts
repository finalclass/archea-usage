import type { Meter } from "../src/providers.ts";
export function render(
  meters: Meter[],
  now = Date.now(),
): { text: string; tooltip: string; class: string } {
  const known = meters.flatMap((m) => m.windows.map((w) => w.usedPercent));
  const worst = known.length ? Math.max(...known) : null;
  const tooltip = meters.map((m) => {
    const lines = m.windows.map((w) => {
      const seconds = w.resetsAt
        ? Math.max(0, Math.ceil((Date.parse(w.resetsAt) - now) / 1000))
        : null;
      const reset = seconds === null
        ? "brak daty resetu"
        : `reset za ${Math.floor(seconds / 86400)}d ${
          Math.floor(seconds % 86400 / 3600)
        }h ${Math.floor(seconds % 3600 / 60)}m (${
          new Date(w.resetsAt!).toLocaleString()
        })`;
      return `${w.label}: ${w.usedPercent}% zużyte · ${reset}`;
    });
    if (m.balance) {
      lines.push(`${m.balance.amount.toFixed(2)} ${m.balance.currency}`);
    }
    if (!lines.length) lines.push("brak danych");
    lines.push(
      `aktualizacja: ${
        m.updatedAt ? new Date(m.updatedAt).toLocaleString() : "—"
      }`,
    );
    if (m.stale) lines.push("dane nieaktualne");
    if (m.error) lines.push(m.error);
    return `${m.label}\n${lines.join("\n")}`;
  }).join("\n\n");
  return {
    text: worst === null ? "AI —" : `AI ${Math.round(worst)}%`,
    tooltip,
    class: meters.some((m) => m.stale && m.updatedAt)
      ? "stale"
      : worst !== null && worst >= 90
      ? "warning"
      : "normal",
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
