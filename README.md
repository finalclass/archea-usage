# Archea Usage

One self-hosted Deno service for Codex quota windows,
OpenRouter and GreenPT account credit balances. Includes an Omarchy Quickshell plugin and
a native Android home-screen widget. No CodexBar dependency.

Provider collectors adapted from `fc/operators/src/usage.ts` at `dcc7c0e`.
GreenPT prepaid balance is the euro amount in `X-Credits-Remaining` on
authenticated `GET https://api.greenpt.ai/v1/agents`. That call does not start
a run and does not bill inference. Checked on 12 October 2026, the same
response has no `x-credit-balance` header; `GET /v1/models` has neither header,
and a `glm-5.3-flash` completion can succeed without `x-credit-balance`. Those
names are not substitutes. A missing or non-numeric `X-Credits-Remaining` is
`invalid_response`, including when only `x-credit-balance` is present. Numeric
zero is a real balance. `401`, `402` and `429` stay `provider_http_401`,
`provider_http_402` and `provider_http_429`. A network failure is
`provider_unavailable`. Each of those keeps the previous successful reading and
marks it stale.

Account spend comes from `GET https://api.greenpt.ai/v1/agents/usage`. On
12 October 2026 it returned the server's window (the previous 30 days), total
EUR, call count, and per-model cost and token counts, and it described that
total as whole-account API spend. The body field `remainingCreditsEur` is not
used as the balance. There is no per-API-key breakdown in that payload.
`GET /v1/usage` and `GET /v1/credits` return 404. The account portal page
`https://account.greenpt.ai/api/usage` is HTML and describes per-key analytics,
but it is not a machine-readable source, so per-key cost is not reported.
A failed or unusable usage response omits `spend` and does not invalidate a
balance read in the same refresh. Clients share this cached snapshot; refreshing
a client does not call GreenPT again. Provider endpoints for Grok/Codex are internal and can change.
Credentials are read from the owner's existing CLI login files and are never
returned by the API. Grok and Codex OAuth access tokens are renewed automatically
when they are within ten minutes of expiry, and a 401 triggers one recovery and
one retry. Initial login and revoked refresh tokens still require the provider
CLI (`grok login` or `codex login`); the API reports `login_required` and preserves
the last successful reading. Transient renewal failures are retried at the next
scheduled poll; a still-valid access token remains usable in the meantime.
Grok's reported billing period end is returned without inventing a reset date.
OpenRouter balance is not a weekly subscription quota.

Renewal follows the [Codex OAuth implementation](https://github.com/openai/codex/blob/main/codex-rs/login/src/auth/manager.rs)
and [Grok OAuth implementation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-login/src/oidc/protocol.rs).
Rotated tokens are saved atomically to the existing `auth.json` with mode 600,
preserving account metadata and other Grok login entries. Renewal is serialized
using `auth.json.lock` (shared with Grok CLI), and credentials are reloaded before
and after exchange to pick up CLI changes. Only the official OpenAI and xAI
issuers are supported; credentials are never sent to a configured alternate issuer.

## API

`GET /v1/usage` returns a versioned JSON snapshot. Provider polling runs every
300 seconds, independently of client requests. Failed polls retain the last
successful reading with `stale: true` and a sanitized error. Missing values are
null/unavailable, never fabricated zero values. Times are UTC ISO 8601.

Grok is excluded from the active providers and is not polled. Both widgets remove
its card on their next successful refresh, without a client update.

All routes require HTTP Basic Authentication, including `/health`, `/`, and:

- `/downloads/omarchy.tar.gz`
- `/downloads/android.apk`

The server binds only to loopback. Expose it through an HTTPS reverse proxy. Do
not enable access logging with Authorization headers. The public source
repository contains no account configuration or credentials.

Use Deno 2.9 or newer. Run `deno task check` and `deno task test`. Set `USAGE_CONFIG` to a private JSON
file with `credentials: {username, passwordHash}` (SHA-256 of a strong generated
password), `providerHome`, `downloads`, `port` (default 7350), and
`intervalSeconds` (default 300). Run `deno task serve`.

To measure a chosen GreenPT account, add `greenpt.key` to that private file
(mode 600). The key stays there: it is not written to the repository, the API,
logs, or the Omarchy and Android packages. If `greenpt.key` is absent or blank,
the service still reads `greenpt.key` from
`$providerHome/.local/share/opencode/auth.json`. When the explicit key differs
from the OpenCode key, both accounts are collected independently: `GreenPT · moje`
for OpenCode and `GreenPT · dodatkowe` for the configured key. Each keeps its own
balance, spend, timestamp and error state. Identical keys produce one card.
A missing original login remains visible as an error on its own card when an
additional key is configured. A missing file with no explicit key is `credentials_missing`; a file
without a GreenPT key is `login_required`.

Example, with the secret replaced locally:

```json
{
  "greenpt": { "key": "PASTE_THE_ACCOUNT_KEY" }
}
```

## Omarchy

Download and extract the authenticated `/downloads/omarchy.tar.gz`, then:

```
deno run --allow-env=HOME --allow-read --allow-write omarchy/install.ts
```

Fill `~/.config/archea-usage/client.json` with `url`, `username`, `password`;
keep mode 600. Enable using `omarchy plugin enable archea.usage` and restart the
shell when required. The plugin uses the existing Deno runtime, polls only our
API every five minutes. Left or right click on the bar icon toggles the cards.
The close button hides them. Resets use the local device timezone and Polish
weekday/hour format, for example `środa, 07:51`. Each quota card shows a limit
bar and turns yellow at 80% usage and red at 100%. A prepaid balance shows the
remaining amount, with no invented quota threshold. GreenPT also shows the
account spend in EUR for the period returned by the provider, the model split
when present, the measurement time, and a distinct stale/error label:
`odrzucony klucz`, `brak środków`, `limit zapytań`, `niepoprawny pomiar`,
`awaria sieci`, `brak logowania`, or `brak klucza`. The bar icon keeps the bar
color until one of those thresholds. No provider secrets on the
desktop. Configuration is separate from the downloadable plugin.

## Android

Install `/downloads/android.apk` (Android 8+), open Archea Usage, set the HTTPS
base URL and Basic Auth login/password, and tap “Zapisz i sprawdź połączenie”.
Then add the Archea Usage widget to the launcher. Credentials are encrypted with
Android Keystore AES-GCM; backups and cleartext HTTP are disabled. Redirects are
rejected so credentials cannot be forwarded to another host. Failed requests
retain the cached readings and visibly report the error.

The Android scheduler refreshes approximately every 15 minutes, subject to
Android battery/Doze scheduling. The 48 dp “Odśwież” button immediately shows a
spinner and “Odświeżanie…” until the scheduled request finishes (at least 750 ms).
Manual requests also run offline to report a connection error instead of waiting
indefinitely; repeated taps during a refresh do not enqueue more requests.
The API itself still polls providers every five minutes. Tap a card
or the title to open `https://szymon.archea.dev`; the separate settings button
opens configuration. The widget background does not open the website. A scrollable two-column card grid displays every account, including both GreenPT
accounts. Rows grow with their content instead of clipping it to a fixed height.
Names and reset dates wrap; balance amounts shrink to fit the card width and
the currency has its own line. The cards match Omarchy: a limit bar for
quota, the remaining amount for a prepaid balance, GreenPT spend and the same
stale/error labels, the same 80%/100% colors, and
the local weekday/time format. A failed client refresh keeps the last snapshot,
including the last GreenPT balance. Widget size is adjustable. No analytics or external SDKs.

GitHub Actions builds with JDK 17, Gradle 8.11.1, AGP 8.9.2 and SDK 35, runs
lint and Android emulator instrumentation tests, and uploads a signed APK.
Signing keys are private GitHub Actions secrets (`ANDROID_KEYSTORE` base64
PKCS12, `ANDROID_SIGNING_PASSWORD`), never committed. Keep that key for future
upgrades.

## Deployment and rollback

See `deployment/` for the unit and proxy template. The unit uses an example
`usage` account and `/home/usage`; replace these with the service owner's account,
home and checkout paths. OAuth renewal requires read/write access to the owner's
`.grok` and `.codex` directories (for locks and atomic token replacement), plus
network access to `auth.x.ai:443` and `auth.openai.com:443`. Keep the other home
paths read-only. `credentials_write_failed` indicates missing write permissions;
`auth_refresh_failed` indicates a temporary renewal or lock failure.

Stop/disable only
`archea-usage.service`, remove only its Caddy site, validate/reload Caddy, and
remove only the `usageproxy` Incus proxy device to roll back. Preserve the
private credentials/signing key and avoid changing Operators or T3.
