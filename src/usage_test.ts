import {
  collect,
  empty,
  meterIds,
  parseBalance,
  parseCodex,
  parseGreenBalance,
  parseGreenSpend,
  parseGrok,
  readGreenpt,
  resolveGreenptKey,
  safeError,
} from "./providers.ts";
import { Cache } from "./cache.ts";
import { handler, hash } from "./http.ts";
import {
  errorLabel,
  level,
  money,
  render,
  resetLabel,
} from "../omarchy/usage-widget.ts";
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
function greenResponse(
  status: number,
  headers: Record<string, string>,
  body = "",
): Response {
  return new Response(body, { status, headers });
}
Deno.test("GreenPT balance comes only from X-Credits-Remaining and keeps spend", async () => {
  const calls: string[] = [];
  const reading = await readGreenpt("test-key", (url, init) => {
    calls.push(url);
    const headers = new Headers(init?.headers);
    assert(headers.get("Authorization") === "Bearer test-key");
    assert(init?.redirect === "error");
    assert(!url.includes("test-key") && !url.includes("chat/completions"));
    if (url.endsWith("/usage")) {
      return Promise.resolve(greenResponse(
        200,
        {
          "x-credit-balance": "1",
        },
        JSON.stringify({
          from: "2026-09-12T12:00:00.000Z",
          until: "2026-10-12T12:00:00.000Z",
          totalCostEur: "0.000018150000000000001",
          totalCalls: 2,
          remainingCreditsEur: "1",
          byModel: [{
            modelId: "glm-5.3-flash",
            costEur: "0.00001815",
            calls: 2,
          }],
        }),
      ));
    }
    return Promise.resolve(greenResponse(200, {
      "X-Credits-Remaining": "9.99998185",
      "x-credit-balance": "0",
    }, "{}"));
  });
  assert(
    reading.balance.amount === 9.99998185 && reading.balance.currency === "EUR",
  );
  assert(reading.spend?.amount === Number("0.000018150000000000001"));
  assert(reading.spend?.calls === 2 && reading.spend?.models.length === 1);
  assert(reading.spend?.models[0].model === "glm-5.3-flash");
  assert(calls.length === 2);
});
Deno.test("GreenPT treats zero, a missing header and HTTP failures as different results", async () => {
  const zero = await readGreenpt("test-key", (url) =>
    Promise.resolve(
      url.endsWith("/usage")
        ? greenResponse(404, {})
        : greenResponse(200, { "X-Credits-Remaining": "0" }),
    ));
  assert(zero.balance.amount === 0 && zero.spend === null);
  const onlyDocumented = readGreenpt(
    "test-key",
    () =>
      Promise.resolve(greenResponse(200, { "x-credit-balance": "5" }, "{}")),
  );
  let invalid = false;
  try {
    await onlyDocumented;
  } catch (error) {
    invalid = safeError(error) === "invalid_response";
  }
  assert(invalid);
  for (const status of [401, 402, 429]) {
    let seen = "";
    try {
      await readGreenpt(
        "test-key",
        (url) =>
          Promise.resolve(
            greenResponse(status, { "X-Credits-Remaining": "0" }),
          ),
      );
    } catch (error) {
      seen = safeError(error);
    }
    assert(seen === `provider_http_${status}`, seen);
  }
  let network = "";
  try {
    await readGreenpt(
      "test-key",
      () => Promise.reject(new TypeError("offline")),
    );
  } catch (error) {
    network = safeError(error);
  }
  assert(network === "provider_unavailable");
  const brokenUsage = await readGreenpt("test-key", (url) =>
    Promise.resolve(
      url.endsWith("/usage")
        ? greenResponse(200, {}, "{")
        : greenResponse(200, { "X-Credits-Remaining": "2.5" }),
    ));
  assert(brokenUsage.balance.amount === 2.5 && brokenUsage.spend === null);
  assert(
    parseGreenSpend({
      totalCostEur: "0",
      totalCalls: 0,
      from: "2026-09-12T12:00:00Z",
      until: "2026-10-12T12:00:00Z",
    })?.amount === 0,
  );
  assert(parseGreenSpend({ totalCostEur: "nope", totalCalls: 1 }) === null);
});
Deno.test("GreenPT key prefers private configuration and still accepts OpenCode", async () => {
  const home = await Deno.makeTempDir();
  const authDir = `${home}/.local/share/opencode`;
  await Deno.mkdir(authDir, { recursive: true });
  await Deno.writeTextFile(
    `${authDir}/auth.json`,
    JSON.stringify({
      greenpt: { key: " from-file " },
      openrouter: { key: "keep" },
    }),
  );
  assert(await resolveGreenptKey(home) === "from-file");
  assert(await resolveGreenptKey(home, " explicit ") === "explicit");
  assert(await resolveGreenptKey(home, "  ") === "from-file");
  await Deno.writeTextFile(
    `${authDir}/auth.json`,
    JSON.stringify({ openrouter: { key: "keep" } }),
  );
  let missing = "";
  try {
    await resolveGreenptKey(home);
  } catch (error) {
    missing = safeError(error);
  }
  assert(missing === "login_required");
  const bare = await Deno.makeTempDir();
  let absent = "";
  try {
    await resolveGreenptKey(bare);
  } catch (error) {
    absent = safeError(error);
  }
  assert(absent === "credentials_missing");
  assert(await resolveGreenptKey(bare, "configured") === "configured");
  await Deno.remove(home, { recursive: true });
  await Deno.remove(bare, { recursive: true });
});
Deno.test("GreenPT failure keeps the last balance and a distinct error", async () => {
  let mode = "ok";
  const cache = new Cache(async (id) => {
    if (id !== "greenpt") {
      return { ...empty(id), updatedAt: "2026-10-02T00:00:00Z", stale: false };
    }
    if (mode === "ok") {
      return {
        ...empty(id),
        balance: { amount: 0, currency: "EUR" },
        updatedAt: "2026-10-12T00:00:00Z",
        stale: false,
        error: null,
      };
    }
    throw new Error(mode);
  });
  await cache.refresh();
  for (
    const error of [
      "provider_http_401",
      "provider_http_402",
      "provider_http_429",
      "invalid_response",
      "offline",
    ]
  ) {
    mode = error;
    await cache.refresh();
    const meter = cache.meters.find((item) => item.id === "greenpt");
    assert(meter?.stale === true);
    assert(meter?.balance?.amount === 0);
    assert(meter?.updatedAt === "2026-10-12T00:00:00Z");
    assert(
      meter?.error === (error === "offline" ? "provider_unavailable" : error),
    );
  }
});
Deno.test("both GreenPT accounts are collected, cached and rendered independently", async () => {
  const home = await Deno.makeTempDir();
  const originalFetch = globalThis.fetch;
  try {
    await Deno.mkdir(`${home}/.local/share/opencode`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.local/share/opencode/auth.json`,
      JSON.stringify({ greenpt: { key: "original-test-key" } }),
    );
    const ids = await meterIds(home, "additional-test-key");
    assert(ids.length === 5 && ids.includes("greenpt_opencode"));
    assert((await meterIds(home)).length === 4);
    assert((await meterIds(home, " original-test-key ")).length === 4);
    let failOriginal = false;
    const keys: string[] = [];
    globalThis.fetch = (_input, init) => {
      const key = new Headers(init?.headers).get("Authorization");
      keys.push(key!);
      if (key === "Bearer original-test-key" && failOriginal) {
        return Promise.resolve(new Response("", { status: 401 }));
      }
      if (String(_input).endsWith("/usage")) {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(
        new Response("{}", {
          headers: {
            "X-Credits-Remaining": key === "Bearer original-test-key"
              ? "0.95"
              : "10",
          },
        }),
      );
    };
    const cache = new Cache(
      (id) =>
        id.startsWith("greenpt")
          ? collect(id, home, { greenptKey: "additional-test-key" })
          : Promise.resolve(empty(id)),
      300,
      ids,
    );
    await cache.refresh();
    assert(
      keys.filter((key) => key === "Bearer original-test-key").length === 2,
    );
    assert(
      keys.filter((key) => key === "Bearer additional-test-key").length === 2,
    );
    const mine = cache.meters.find((m) => m.id === "greenpt_opencode")!;
    const other = cache.meters.find((m) => m.id === "greenpt")!;
    assert(mine.balance?.amount === 0.95 && other.balance?.amount === 10);
    assert(
      mine.label === "GreenPT · moje" && other.label === "GreenPT · dodatkowe",
    );
    const json = JSON.stringify(cache.snapshot());
    assert(
      !json.includes("test-key") && render(cache.meters).cards.length === 5,
    );
    failOriginal = true;
    await cache.refresh();
    const stale = cache.meters.find((m) => m.id === "greenpt_opencode")!;
    assert(
      stale.stale && stale.balance?.amount === 0.95 &&
        stale.error === "provider_http_401",
    );
    assert(!cache.meters.find((m) => m.id === "greenpt")!.stale);
    await Deno.remove(`${home}/.local/share/opencode/auth.json`);
    assert((await meterIds(home, "additional-test-key")).length === 5);
  } finally {
    globalThis.fetch = originalFetch;
    await Deno.remove(home, { recursive: true });
  }
});
Deno.test("GreenPT card shows the euro balance, spend and error state", () => {
  assert(money(0) === "0.00" && money(0.41) === "0.41");
  assert(money(0.00001815) === "0.00001815");
  assert(errorLabel("provider_http_401") === "odrzucony klucz");
  assert(errorLabel("provider_http_402") === "brak środków");
  assert(errorLabel("provider_http_429") === "limit zapytań");
  assert(errorLabel("invalid_response") === "niepoprawny pomiar");
  assert(errorLabel("provider_unavailable") === "awaria sieci");
  const fresh = render([{
    ...empty("greenpt"),
    stale: false,
    updatedAt: "2026-10-12T12:05:00Z",
    balance: { amount: 9.99998185, currency: "EUR" },
    spend: {
      amount: 0.00001815,
      currency: "EUR",
      from: "2026-09-12T12:00:00.000Z",
      until: "2026-10-12T12:00:00.000Z",
      calls: 2,
      models: [{ model: "glm-5.3-flash", amount: 0.00001815, calls: 2 }],
    },
  }]);
  const card = fresh.cards[0];
  assert(card.balance?.amount === "10.00" && card.balance?.currency === "EUR");
  assert(card.spend?.line.includes("0.00001815 EUR"));
  assert(
    card.spend?.line.includes("12.09") && card.spend?.line.includes("12.10"),
  );
  assert(card.spend?.models === "glm-5.3-flash · 0.00001815 EUR");
  assert(card.status.startsWith("stan ") && card.errorLabel === null);
  assert(card.level === "normal" && fresh.summary.startsWith("Stan "));
  const failed = render([{
    ...empty("greenpt", "provider_http_402"),
    updatedAt: "2026-10-12T12:05:00Z",
    balance: { amount: 0, currency: "EUR" },
  }]);
  assert(failed.cards[0].balance?.amount === "0.00");
  assert(
    failed.cards[0].status.startsWith("nieaktualne · brak środków · stan "),
  );
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
