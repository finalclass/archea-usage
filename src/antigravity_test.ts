import {
  parseAntigravity,
  publishAntigravity,
  readAntigravity,
} from "../rog/antigravity-push.ts";
import { empty, meterIds } from "./providers.ts";
import { Cache } from "./cache.ts";
import { handler, hash } from "./http.ts";
import { render } from "../omarchy/usage-widget.ts";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
const fixture = (fraction: unknown = 0.125) => ({
  status: "SUCCESS",
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "gemini-weekly",
              remaining_fraction: fraction,
              reset_time: "2026-11-29T08:59:36Z",
            },
            {
              id: "gemini-5h",
              remaining_fraction: 0,
              reset_time: "2026-11-22T13:59:36Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [{ id: "3p-weekly", remaining_fraction: 1 }],
        },
        {
          name: "Gemini 4 Argon",
          buckets: [{ id: "gemini-argon-wtu-weekly", remaining_fraction: 1 }],
        },
      ],
    },
  },
});
Deno.test("Antigravity uses structured CLI quota, including zero and separate Argon pool", () => {
  const windows = parseAntigravity(fixture());
  assert(windows.length === 3);
  assert(windows[0].usedPercent === 87.5);
  assert(windows[0].resetsAt === "2026-11-29T08:59:36.000Z");
  assert(windows[1].usedPercent === 100 && windows[2].usedPercent === 0);
  assert(windows[2].resetsAt === null);
  for (
    const bad of [
      null,
      {},
      { status: "ERROR" },
      fixture(null),
      fixture(-1),
      fixture(1.1),
      fixture("0.5"),
    ]
  ) {
    let failed = false;
    try {
      parseAntigravity(bad);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});
Deno.test("Antigravity CLI failures never expose stdout or stderr or invent a quota", async () => {
  const ok = await readAntigravity(
    "agy",
    async () => ({ success: true, stdout: JSON.stringify(fixture()) }),
  );
  assert("windows" in ok && ok.windows.length === 3);
  for (
    const run of [
      async () => ({ success: false, stdout: "secret-token" }),
      async () => ({ success: true, stdout: "secret-token" }),
      async () => {
        throw new Error("secret-token");
      },
    ]
  ) {
    const result = await readAntigravity("agy", run);
    assert("error" in result && !JSON.stringify(result).includes("secret"));
  }
});
Deno.test("Antigravity push reaches clients; last good quota survives collector failure and offline", async () => {
  let now = 1_800_000_000_000;
  const ids = await meterIds("/unused", undefined, { pushed: true });
  assert(ids.includes("antigravity"));
  const cache = new Cache(async (id) => empty(id), 300, ids, () => now);
  const app = handler(
    cache,
    { username: "unused", passwordHash: await hash("unused") },
    "/unused",
    { tokenHash: await hash("push") },
  );
  const push = (body: unknown, token = "push") =>
    app(
      new Request("https://usage.test/v1/push/antigravity", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
  assert(
    (await push({ windows: parseAntigravity(fixture()) }, "wrong")).status ===
      401,
  );
  assert((await push({ windows: parseAntigravity(fixture()) })).status === 204);
  const meter = cache.snapshot().meters.find((m) => m.id === "antigravity")!;
  const card = render([meter]).cards[0];
  assert(card.label === "Antigravity · Gemini");
  assert(card.peakLabel === "100%" && card.level === "critical");
  assert((card as Record<string, unknown>).quotaKind === undefined);
  assert(card.windows[0].percentLabel === "87.5%");
  assert(
    card.windows[0].level === "warning" && card.windows[0].percent === 87.5,
  );
  assert(card.windows[0].line.startsWith("Gemini · tydzień · do "));
  assert(card.value.includes("Gemini · tydzień: 87.5% zużyte"));
  assert(!/pozosta/i.test(JSON.stringify(card)));
  assert((await push({ error: "provider_unavailable" })).status === 204);
  const stale = cache.snapshot().meters.find((m) => m.id === "antigravity")!;
  assert(stale.stale && stale.windows[0].usedPercent === 87.5);
  now += cache.pushStaleMs + 1;
  assert(
    cache.snapshot().meters.find((m) => m.id === "antigravity")!.error ===
      "source_offline",
  );
});

Deno.test("Antigravity rejects malformed resets instead of inventing dates", () => {
  for (
    const date of [
      "12",
      ["2026-11-29T08:59:36Z"],
      42,
      {},
      "not-a-date",
      "2026-02-30T08:59:36Z",
    ]
  ) {
    const data: any = fixture();
    data.command.data.groups[0].buckets[0].reset_time = date;
    let failed = false;
    try {
      parseAntigravity(data);
    } catch {
      failed = true;
    }
    assert(failed);
  }
});
Deno.test("Antigravity push sanitizes invalid secrets and transport errors", async () => {
  const reading = { windows: parseAntigravity(fixture()) };
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls++;
    assert(
      new Headers(init?.headers).get("Authorization") === "Bearer test-token",
    );
    throw new Error("private Authorization: Bearer test-token");
  };
  assert(
    await publishAntigravity(
      { url: "https://example.com", token: "secret\nvalue" },
      reading,
      fetcher,
    ) === null,
  );
  assert(calls === 0);
  assert(
    await publishAntigravity(
      { url: "https://example.com", token: "test-token" },
      reading,
      fetcher,
    ) === null,
  );
  assert(Number(calls) === 1);
});
Deno.test("Antigravity cadence is independent of server polls and push cannot exceed 100 percent", async () => {
  let now = 1_800_000_000_000;
  const cache = new Cache(
    async (id) => empty(id),
    60,
    ["antigravity"],
    () => now,
  );
  cache.accept("antigravity", { windows: parseAntigravity(fixture()) });
  now += 181_000;
  assert(!cache.snapshot().meters[0].stale);
  now += 720_000;
  assert(cache.snapshot().meters[0].error === "source_offline");
  const app = handler(
    cache,
    { username: "unused", passwordHash: await hash("unused") },
    "/unused",
    { tokenHash: await hash("push") },
  );
  const response = await app(
    new Request("https://usage.test/v1/push/antigravity", {
      method: "POST",
      headers: { Authorization: "Bearer push" },
      body: JSON.stringify({
        windows: [{ label: "gemini-weekly", usedPercent: 110, resetsAt: null }],
      }),
    }),
  );
  assert(response.status === 400);
});

Deno.test("Antigravity HTTP push rejects malformed and impossible dates before updating cache", async () => {
  const cache = new Cache(async (id) => empty(id), 300, ["antigravity"]);
  const app = handler(
    cache,
    { username: "unused", passwordHash: await hash("unused") },
    "/unused",
    { tokenHash: await hash("push") },
  );
  const push = (resetsAt: unknown) =>
    app(
      new Request("https://usage.test/v1/push/antigravity", {
        method: "POST",
        headers: { Authorization: "Bearer push" },
        body: JSON.stringify({
          windows: [{ label: "gemini-weekly", usedPercent: 10, resetsAt }],
        }),
      }),
    );
  for (
    const invalid of [
      "12",
      ["2026-11-29T08:59:36Z"],
      42,
      {},
      "2026-02-30T08:59:36Z",
    ]
  ) {
    assert((await push(invalid)).status === 400);
    assert(cache.meters[0].updatedAt === null);
  }
  assert((await push("2026-11-29T08:59:36.123Z")).status === 204);
  assert(cache.meters[0].windows[0].resetsAt === "2026-11-29T08:59:36.123Z");
});

const meterOf = (id: string, label: string, usedPercent: number) => ({
  id,
  label,
  windows: [{ label: "weekly", usedPercent, resetsAt: null }],
  balance: null,
  spend: null,
  updatedAt: "2026-11-22T09:00:00.000Z",
  stale: false,
  error: null,
});
const single = (remaining: number) => ({
  status: "SUCCESS",
  command: {
    name: "usage",
    data: {
      groups: [{
        name: "Gemini Models",
        buckets: [{
          id: "gemini-weekly",
          remaining_fraction: remaining,
          reset_time: "2026-11-29T08:59:36Z",
        }],
      }],
    },
  },
});
Deno.test("Antigravity remaining quota becomes consumption exactly once from collector to card", () => {
  for (
    const [remaining, used, label, level] of [
      [1, 0, "0%", "normal"],
      [0.9, 10, "10%", "normal"],
      [0.5, 50, "50%", "normal"],
      [0.2, 80, "80%", "warning"],
      [0.21, 79, "79%", "normal"],
      [0, 100, "100%", "critical"],
    ] as const
  ) {
    const windows = parseAntigravity(single(remaining));
    assert(Math.abs(windows[0].usedPercent - used) < 1e-9);
    const card = render([{
      ...meterOf("antigravity", "Antigravity · Gemini", 0),
      windows,
    }]).cards[0];
    assert(card.peakLabel === label && card.level === level);
    assert(card.windows[0].percentLabel === label);
    assert(card.windows[0].level === level);
    // Floating point noise (0.9 remaining -> 9.999999999999998) never reaches the text.
    assert(card.value.startsWith("Gemini · tydzień: " + label + " zużyte\n"));
    // The bar fill is the consumed share, as on every other card.
    assert(Math.abs(card.windows[0].percent - used) < 1e-9);
  }
});
Deno.test("Highest consumption treats Antigravity like Claude, Codex and Grok", () => {
  const mixed = render([
    meterOf("claude", "Claude", 86),
    meterOf("codex", "Codex", 30),
    meterOf("grok", "Grok", 18),
    meterOf("antigravity", "Antigravity · Gemini", 0),
  ]);
  assert(mixed.text === "AI 86%" && mixed.class === "warning");
  assert(mixed.summary.startsWith("Najwyższe zużycie: 86%"));
  assert(mixed.cards.map((c) => c.peakLabel).join() === "86%,30%,18%,0%");
  assert(mixed.cards[3].level === "normal");
  const alone = render([meterOf("antigravity", "Antigravity · Gemini", 0)]);
  assert(alone.text === "AI 0%" && alone.class === "normal");
  assert(alone.summary.startsWith("Najwyższe zużycie: 0%"));
  assert(alone.cards[0].peakLabel === "0%");
  assert(alone.cards[0].value.startsWith("Tydzień: 0% zużyte"));
});
Deno.test("Antigravity HTTP push, cache and usage API feed consumption to the card", async () => {
  const cache = new Cache(async (id) => empty(id), 300, ["antigravity"]);
  const app = handler(
    cache,
    { username: "reader", passwordHash: await hash("reader-pass") },
    "/unused",
    { tokenHash: await hash("push") },
  );
  const pushed = await app(
    new Request("https://usage.test/v1/push/antigravity", {
      method: "POST",
      headers: { Authorization: "Bearer push" },
      body: JSON.stringify({ windows: parseAntigravity(fixture()) }),
    }),
  );
  assert(pushed.status === 204);
  const response = await app(
    new Request("https://usage.test/v1/usage", {
      headers: { Authorization: "Basic " + btoa("reader:reader-pass") },
    }),
  );
  assert(response.status === 200);
  const data = await response.json();
  const used = data.meters[0].windows.map((w: { usedPercent: number }) =>
    w.usedPercent
  );
  assert(used.join() === "87.5,100,0");
  const widget = render(data.meters);
  assert(widget.text === "AI 100%" && widget.class === "critical");
  assert(
    widget.cards[0].windows.map((w) => w.percentLabel).join() ===
      "87.5%,100%,0%",
  );
  assert(widget.cards[0].peakLabel === "100%");
});
