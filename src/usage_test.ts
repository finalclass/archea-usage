import { empty, parseBalance, parseCodex, parseGrok } from "./providers.ts";
import { Cache } from "./cache.ts";
import { handler, hash } from "./http.ts";
import { render } from "../omarchy/usage-widget.ts";
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
  assert(r.text === "AI —" && r.tooltip.includes("brak danych"));
});
