import { collect, safeError } from "./providers.ts";
import { Cache } from "./cache.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function jwt(expiresAt: number) {
  return `header.${
    btoa(JSON.stringify({ exp: Math.floor(expiresAt / 1000) }))
  }.signature`;
}

function credentials(id: string, expiresAt = Date.now() + 3600000): any {
  return id === "codex"
    ? {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        access_token: jwt(expiresAt),
        refresh_token: "old-refresh",
        id_token: "old-id",
        account_id: "account-1",
      },
      last_refresh: "2026-10-01T00:00:00Z",
      extra: { preserved: true },
    }
    : {
      "https://auth.x.ai::test-client": {
        key: "old-access",
        refresh_token: "old-refresh",
        auth_mode: "oidc",
        oidc_issuer: "https://auth.x.ai",
        oidc_client_id: "test-client",
        expires_at: new Date(expiresAt).toISOString(),
        principal_type: "team",
        principal_id: "team-1",
        extra: { preserved: true },
      },
      other: { key: "other-account", refresh_token: "untouched" },
    };
}

function entry(id: string, document: any): any {
  return id === "codex"
    ? document.tokens
    : document["https://auth.x.ai::test-client"];
}

function reading(id: string): Response {
  return Response.json(
    id === "codex"
      ? {
        rate_limit: {
          secondary_window: { used_percent: 42, limit_window_seconds: 604800 },
        },
      }
      : { config: { creditUsagePercent: 7 } },
  );
}

async function fixture(
  id: string,
  document: any,
  test: (home: string, path: string, original: string) => Promise<void>,
) {
  const home = await Deno.makeTempDir({ prefix: "usage-auth-test-" });
  const path = `${home}/.${id}/auth.json`;
  await Deno.mkdir(`${home}/.${id}`, { mode: 0o700 });
  const original = JSON.stringify(document);
  await Deno.writeTextFile(path, original, { mode: 0o600 });
  const fetch = globalThis.fetch;
  try {
    await test(home, path, original);
  } finally {
    globalThis.fetch = fetch;
    await Deno.remove(home, { recursive: true });
  }
}

for (const id of ["grok", "codex"]) {
  Deno.test(`${id}: renew before expiry and atomically persist rotated credentials`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() + 300000),
      async (home, path) => {
        let exchanges = 0, polls = 0;
        globalThis.fetch = async (input, init) => {
          const url = String(input);
          assert(
            init?.redirect === "error" && init.signal instanceof AbortSignal,
          );
          if (url.includes("/token")) {
            exchanges++;
            assert(
              url ===
                (id === "codex"
                  ? "https://auth.openai.com/oauth/token"
                  : "https://auth.x.ai/oauth2/token"),
            );
            assert(init.method === "POST");
            const params = id === "codex"
              ? JSON.parse(String(init.body))
              : Object.fromEntries(init.body as URLSearchParams);
            assert(
              params.grant_type === "refresh_token" &&
                params.refresh_token === "old-refresh",
            );
            if (id === "grok") {
              assert(
                params.client_id === "test-client" &&
                  params.principal_type === "team" &&
                  params.principal_id === "team-1",
              );
            } else assert(params.client_id === "app_EMoamEEZ73f0CkXaXp7hrann");
            return Response.json({
              access_token: jwt(Date.now() + 3600000),
              refresh_token: "rotated-refresh",
              id_token: "new-id",
              expires_in: 3600,
            });
          }
          polls++;
          const saved = JSON.parse(await Deno.readTextFile(path));
          assert(
            new Headers(init.headers).get("Authorization") ===
              `Bearer ${
                id === "codex"
                  ? saved.tokens.access_token
                  : entry(id, saved).key
              }`,
          );
          if (id === "codex") {
            assert(
              new Headers(init.headers).get("ChatGPT-Account-Id") ===
                "account-1",
            );
          }
          return reading(id);
        };
        const meter = await collect(id, home);
        await collect(id, home);
        assert(
          !meter.stale && meter.error === null && meter.updatedAt &&
            exchanges === 1 && polls === 2,
        );
        const saved = JSON.parse(await Deno.readTextFile(path));
        assert(entry(id, saved).refresh_token === "rotated-refresh");
        if (id === "codex") {
          assert(
            saved.tokens.id_token === "new-id" && saved.extra.preserved &&
              saved.last_refresh !== "2026-10-01T00:00:00Z",
          );
        } else {assert(
            entry(id, saved).extra.preserved &&
              saved.other.refresh_token === "untouched" &&
              Date.parse(entry(id, saved).expires_at) > Date.now(),
          );}
        const mode = (await Deno.stat(path)).mode;
        if (mode !== null) assert((mode & 0o777) === 0o600);
        const files = [];
        for await (const f of Deno.readDir(`${home}/.${id}`)) {
          files.push(f.name);
        }
        assert(files.sort().join() === "auth.json,auth.json.lock");
      },
    );
  });

  Deno.test(`${id}: recover a 401 once, preserving unrotated refresh token and metadata`, async () => {
    await fixture(id, credentials(id), async (home, path) => {
      let exchanges = 0, polls = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("/token")) {
          exchanges++;
          return Response.json({
            access_token: "renewed-access",
            expires_in: 3600,
          });
        }
        polls++;
        return polls === 1 ? new Response(null, { status: 401 }) : reading(id);
      };
      const meter = await collect(id, home);
      assert(!meter.stale && exchanges === 1 && polls === 2);
      const saved = JSON.parse(await Deno.readTextFile(path));
      assert(entry(id, saved).refresh_token === "old-refresh");
      if (id === "codex") {
        assert(
          saved.tokens.id_token === "old-id" &&
            saved.tokens.account_id === "account-1",
        );
      }
    });
  });

  Deno.test(`${id}: a second 401 stops recovery`, async () => {
    await fixture(id, credentials(id), async (home) => {
      let exchanges = 0, polls = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("/token")) {
          exchanges++;
          return Response.json({
            access_token: "new-access",
            expires_in: 3600,
          });
        }
        polls++;
        return new Response(null, { status: 401 });
      };
      let error;
      try {
        await collect(id, home);
      } catch (e) {
        error = safeError(e);
      }
      assert(error === "login_required" && exchanges === 1 && polls === 2);
    });
  });

  Deno.test(`${id}: revoked refresh token keeps the cached reading and requires login`, async () => {
    await fixture(id, credentials(id), async (home, path, original) => {
      let fail = false, exchanges = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("/token")) {
          exchanges++;
          return Response.json({
            error: "invalid_grant",
            error_description: "private-token-must-not-leak",
          }, { status: 400 });
        }
        return fail ? new Response(null, { status: 401 }) : reading(id);
      };
      const cache = new Cache(async (provider) =>
        provider === id ? await collect(id, home) : { id: provider } as any
      );
      await cache.refresh();
      const old = cache.meters.find((meter) => meter.id === id)!;
      fail = true;
      await cache.refresh();
      await cache.refresh();
      const stale = cache.meters.find((meter) => meter.id === id)!;
      assert(
        stale.stale && stale.error === "login_required" &&
          stale.updatedAt === old.updatedAt &&
          JSON.stringify(stale.windows) === JSON.stringify(old.windows),
      );
      assert(exchanges === 1 && await Deno.readTextFile(path) === original);
      assert(!JSON.stringify(cache.snapshot()).includes("private-token"));
      const login = credentials(id);
      entry(id, login).refresh_token = "new-login-refresh";
      await Deno.writeTextFile(path, JSON.stringify(login));
      fail = false;
      await cache.refresh();
      assert(!cache.meters.find((meter) => meter.id === id)!.stale);
    });
  });

  Deno.test(`${id}: CLI renewal while holding the shared lock is adopted without exchange`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() - 1000),
      async (home, path) => {
        const lock = await Deno.open(`${path}.lock`, {
          read: true,
          write: true,
          create: true,
        });
        await lock.lock(true);
        let polls = 0;
        globalThis.fetch = async (input) => {
          assert(
            !String(input).includes("/token"),
            "Sibling renewal should be adopted",
          );
          polls++;
          return reading(id);
        };
        let released = false;
        try {
          const pending = collect(id, home);
          await new Promise((resolve) => setTimeout(resolve, 100));
          const login = credentials(id);
          entry(id, login).refresh_token = "cli-refresh";
          const saved = JSON.stringify(login);
          await Deno.writeTextFile(path, saved);
          lock.close();
          released = true;
          assert(
            !(await pending).stale && polls === 1 &&
              await Deno.readTextFile(path) === saved,
          );
        } finally {
          if (!released) lock.close();
        }
      },
    );
  });

  Deno.test(`${id}: concurrent expiry polls exchange a refresh token only once`, async () => {
    await fixture(id, credentials(id, Date.now() - 1000), async (home) => {
      let exchanges = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("/token")) {
          exchanges++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return Response.json({
            access_token: jwt(Date.now() + 3600000),
            refresh_token: "rotated",
            expires_in: 3600,
          });
        }
        return reading(id);
      };
      const meters = await Promise.all([
        collect(id, home),
        collect(id, home),
        collect(id, home),
      ]);
      assert(exchanges === 1 && meters.every((meter) => !meter.stale));
    });
  });

  Deno.test(`${id}: CLI login during an exchange is preserved`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() - 1000),
      async (home, path) => {
        const login = credentials(id);
        entry(id, login).refresh_token = "new-login";
        if (id === "codex") login.tokens.account_id = "account-2";
        const saved = JSON.stringify(login);
        globalThis.fetch = async (input, init) => {
          if (String(input).includes("/token")) {
            await Deno.writeTextFile(path, saved);
            return Response.json({
              access_token: "obsolete-result",
              refresh_token: "obsolete-refresh",
              expires_in: 3600,
            });
          }
          if (id === "codex") {
            assert(
              new Headers(init?.headers).get("ChatGPT-Account-Id") ===
                "account-2",
            );
          }
          return reading(id);
        };
        assert(
          !(await collect(id, home)).stale &&
            await Deno.readTextFile(path) === saved,
        );
      },
    );
  });

  Deno.test(`${id}: transient proactive failure uses a valid access token`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() + 300000),
      async (home, path, original) => {
        globalThis.fetch = async (input) =>
          String(input).includes("/token")
            ? Response.json({ error: "temporarily_unavailable" }, {
              status: 503,
            })
            : reading(id);
        assert(
          !(await collect(id, home)).stale &&
            await Deno.readTextFile(path) === original,
        );
      },
    );
  });

  Deno.test(`${id}: missing refresh tokens and non-auth errors do not initiate OAuth`, async () => {
    const document = credentials(id);
    delete entry(id, document).refresh_token;
    await fixture(id, document, async (home) => {
      let status = 200;
      globalThis.fetch = async (input) => {
        assert(!String(input).includes("/token"));
        return status === 200 ? reading(id) : new Response(null, { status });
      };
      assert(!(await collect(id, home)).stale);
      for (
        const expected of [[429, "provider_http_429"], [
          401,
          "login_required",
        ]] as const
      ) {
        status = expected[0];
        let error;
        try {
          await collect(id, home);
        } catch (e) {
          error = safeError(e);
        }
        assert(error === expected[1]);
      }
    });
  });

  Deno.test(`${id}: expired tokens retry transient failures on the next poll`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() - 1000),
      async (home, path, original) => {
        let exchanges = 0;
        globalThis.fetch = async (input) => {
          assert(
            String(input).includes("/token"),
            "An expired token should be renewed before polling",
          );
          exchanges++;
          return Response.json({ error: "temporarily_unavailable" }, {
            status: 503,
          });
        };
        for (let i = 0; i < 2; i++) {
          let error;
          try {
            await collect(id, home);
          } catch (e) {
            error = safeError(e);
          }
          assert(error === "auth_refresh_failed");
        }
        assert(exchanges === 2 && await Deno.readTextFile(path) === original);
      },
    );
  });

  Deno.test(`${id}: malformed OAuth success preserves the original credentials`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() - 1000),
      async (home, path, original) => {
        globalThis.fetch = async (input) => {
          assert(String(input).includes("/token"));
          return Response.json({
            refresh_token: "must-not-replace-the-original",
          });
        };
        let error;
        try {
          await collect(id, home);
        } catch (e) {
          error = safeError(e);
        }
        assert(
          error === "invalid_response" &&
            await Deno.readTextFile(path) === original,
        );
      },
    );
  });

  Deno.test(`${id}: read-only auth directory is rejected before spending a refresh token`, async () => {
    await fixture(
      id,
      credentials(id, Date.now() - 1000),
      async (home, path, original) => {
        await Deno.writeTextFile(`${path}.lock`, "", { mode: 0o600 });
        await Deno.chmod(`${home}/.${id}`, 0o500);
        let exchanges = 0;
        globalThis.fetch = async () => {
          exchanges++;
          return Response.json({});
        };
        try {
          let error;
          try {
            await collect(id, home);
          } catch (e) {
            error = safeError(e);
          }
          assert(
            error === "credentials_write_failed" && exchanges === 0 &&
              await Deno.readTextFile(path) === original,
          );
        } finally {
          await Deno.chmod(`${home}/.${id}`, 0o700);
        }
      },
    );
  });
}
