import {
  empty,
  parseBalance,
  parseCodex,
  parseGreenBalance,
  parseGrok,
} from "./providers.ts";
import { Cache } from "./cache.ts";
import { handler, hash } from "./http.ts";
import { level, render, resetLabel } from "../omarchy/usage-widget.ts";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
Deno.test("provider parsers preserve zero, weekly reset and absent values", () => {
  const w = parseCodex({
    rate_limit: {
      primary_window: {
        used_percent: 0,
        limit_window_seconds: 18000,
        reset_at: 1800000000,
      },
      secondary_window: {
        used_percent: 54,
        limit_window_seconds: 604800,
        reset_at: 1800000100,
      },
    },
  });
  assert(
    w.length === 2 && w[0].usedPercent === 0 && w[1].label === "weekly" &&
      w[1].resetsAt === "2027-01-15T08:01:40.000Z",
  );
  assert(parseCodex({ rate_limit: { primary_window: {} } }).length === 0);
  assert(
    parseGrok({
      config: {
        creditUsagePercent: 7,
        billingPeriodEnd: "2026-10-08T05:51:02Z",
      },
    })[0].resetsAt === "2026-10-08T05:51:02.000Z",
  );
  assert(parseBalance({ data: { total_credits: 10, total_usage: 10 } }) === 0);
});
Deno.test("cache coalesces calls and preserves last success after failure", async () => {
  let calls = 0, fail = false;
  const c = new Cache(async (id) => {
    calls++;
    await Promise.resolve();
    if (fail) throw new Error("secret private response");
    return { ...empty(id), updatedAt: "2026-10-02T00:00:00Z", stale: false };
  });
  await Promise.all([c.refresh(), c.refresh(), c.refresh()]);
  assert(calls === 4);
  fail = true;
  await c.refresh();
  assert(
    c.meters.every((m) =>
      m.stale && m.updatedAt && m.error === "provider_unavailable"
    ),
  );
});
Deno.test("API requires Basic Auth for every route and never polls on requests", async () => {
  let calls = 0;
  const c = new Cache(async (id) => {
    calls++;
    return empty(id);
  });
  const h = handler(c, {
    username: "usage",
    passwordHash: await hash("test-password"),
  }, "/nonexistent");
  const auth = { Authorization: "Basic " + btoa("usage:test-password") };
  for (
    const p of [
      "/",
      "/health",
      "/v1/usage",
      "/downloads/omarchy.tar.gz",
      "/downloads/android.apk",
    ]
  ) {
    assert((await h(new Request("https://example.com" + p))).status === 401);
    assert(
      (await h(
        new Request("https://example.com" + p, {
          headers: { Authorization: "Basic !!!" },
        }),
      )).status === 401,
    );
  }
  assert(
    (await h(new Request("https://example.com/v1/usage", { headers: auth })))
      .status === 200,
  );
  assert(
    (await h(
      new Request("https://example.com/v1/usage", {
        headers: auth,
        method: "POST",
      }),
    )).status === 405,
  );
  assert(
    (await h(
      new Request("https://example.com/downloads/../secret", { headers: auth }),
    )).status === 404,
  );
  assert(calls === 0);
});
Deno.test("widget does not show missing readings as zero", () => {
  const r = render([empty("greenpt", "not_implemented_in_operators")]);
  assert(r.text === "AI —" && r.tooltip.includes("Brak danych"));
});

Deno.test("GreenPT balance requires a numeric response header and preserves zero", () => {
  assert(parseGreenBalance("0") === 0);
  assert(parseGreenBalance("0.952105264") === 0.952105264);
  for (const value of [null, "", " ", "unknown", "Infinity"]) {
    let rejected = false;
    try {
      parseGreenBalance(value);
    } catch {
      rejected = true;
    }
    assert(rejected, "Invalid balance must not become zero");
  }
});
Deno.test("provider cards have individual 80/100 thresholds and weekday reset", () => {
  assert(
    level(79) === "normal" && level(80) === "warning" &&
      level(99) === "warning",
  );
  assert(
    level(100) === "critical" && level(101) === "critical" &&
      level(null) === "normal",
  );
  const r = render(
    [0, 80, 100].map((p) => ({
      ...empty("codex"),
      windows: [{
        label: "weekly",
        usedPercent: p,
        resetsAt: "2026-10-07T07:51:00Z",
      }],
    })),
  );
  assert(r.cards.map((c) => c.level).join() === "normal,warning,critical");
  assert(
    r.cards.map((c) => c.windows[0].level).join() === "normal,warning,critical",
  );
  assert(
    r.cards[1].peakLabel === "80%" && r.cards[1].windows[0].label === "Tydzień",
  );
  assert(r.class === "critical" && r.cards[0].value.includes("Reset: "));
  assert(r.summary.startsWith("Najwyższe zużycie: 100%"));
  assert(/^[^,]+, \d{2}:\d{2}$/.test(resetLabel("2026-10-07T07:51:00Z")));
});
Deno.test("panel cards keep balance separate from quota meters", () => {
  const r = render([
    {
      ...empty("grok"),
      stale: false,
      updatedAt: "2026-10-04T05:04:00Z",
      windows: [{
        label: "subscription",
        usedPercent: 10.24,
        resetsAt: "2026-10-08T05:51:00Z",
      }],
    },
    {
      ...empty("codex"),
      stale: true,
      windows: [{
        label: "5h",
        usedPercent: 0,
        resetsAt: null,
      }],
    },
    {
      ...empty("openrouter"),
      stale: false,
      updatedAt: "2026-10-04T05:04:00Z",
      balance: { amount: 0.41, currency: "USD" },
    },
    {
      ...empty("greenpt"),
      stale: false,
      balance: { amount: 0, currency: "EUR" },
    },
  ]);
  assert(r.cards[0].windows[0].label === "Abonament");
  assert(r.cards[0].windows[0].percentLabel === "10.2%");
  assert(r.cards[0].peakLabel === "10.2%" && r.cards[0].balance === null);
  assert(r.cards[0].windows[0].reset !== null);
  assert(
    r.cards[1].windows[0].label === "5 h" &&
      r.cards[1].windows[0].reset === null,
  );
  assert(r.cards[1].stale === true && r.cards[1].peakLabel === "0%");
  assert(r.cards[2].windows.length === 0 && r.cards[2].level === "normal");
  assert(
    r.cards[2].balance?.amount === "0.41" &&
      r.cards[2].balance?.currency === "USD",
  );
  assert(r.cards[2].value.includes("0.41 USD pozostało"));
  assert(r.cards[3].balance?.amount === "0.00");
  assert(r.summary.startsWith("Najwyższe zużycie: 10%"));
});
