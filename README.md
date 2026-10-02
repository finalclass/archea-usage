# Archea Usage

One self-hosted Deno service for Grok subscription usage, Codex quota windows,
OpenRouter and GreenPT account credit balances. Includes an Omarchy Quickshell plugin and
a native Android home-screen widget. No CodexBar dependency.

Provider collectors adapted from `fc/operators/src/usage.ts` at `dcc7c0e`.
GreenPT uses the workaround recommended by support on 23 September 2026:
a minimal `green-l-raw` completion (`.` and `max_tokens: 1`), then reads
`X-Credits-Remaining` as the prepaid euro balance. Each scheduled refresh
therefore incurs a small inference charge. Clients share the cached result.
A missing/invalid header is an error, never a zero balance. Provider endpoints for Grok/Codex are internal and can change.
Credentials are read from the owner's existing CLI login files and are never
returned by the API. The service does not refresh or rewrite those login files;
renew expired logins using the provider CLI. Grok's reported billing period end
is returned without inventing a reset date. OpenRouter balance is not a weekly
subscription quota.

## API

`GET /v1/usage` returns a versioned JSON snapshot. Provider polling runs every
300 seconds, independently of client requests. Failed polls retain the last
successful reading with `stale: true` and a sanitized error. Missing values are
null/unavailable, never fabricated zero values. Times are UTC ISO 8601.

All routes require HTTP Basic Authentication, including `/health`, `/`, and:

- `/downloads/omarchy.tar.gz`
- `/downloads/android.apk`

The server binds only to loopback. Expose it through an HTTPS reverse proxy. Do
not enable access logging with Authorization headers. The public source
repository contains no account configuration or credentials.

Run `deno task check` and `deno task test`. Set `USAGE_CONFIG` to a private JSON
file with `credentials: {username, passwordHash}` (SHA-256 of a strong generated
password), `providerHome`, `downloads`, `port` (default 7350), and
`intervalSeconds` (default 300). Run `deno task serve`.

## Omarchy

Download and extract the authenticated `/downloads/omarchy.tar.gz`, then:

```
deno run --allow-env=HOME --allow-read --allow-write omarchy/install.ts
```

Fill `~/.config/archea-usage/client.json` with `url`, `username`, `password`;
keep mode 600. Enable using `omarchy plugin enable archea.usage` and restart the
shell when required. The plugin uses the existing Deno runtime, polls only our
API every five minutes. Right-click opens four provider cards; right-click
again closes them. Left-click on the bar widget or a card opens
`https://szymon.archea.dev`. Resets use the local device timezone and Polish
weekday/hour format, for example `środa, 07:51`. Each provider card turns yellow
at 80% usage and red at 100%; prepaid balances have no invented quota threshold. No provider secrets on the
desktop. Configuration is separate from the downloadable plugin.

## Android

Install `/downloads/android.apk` (Android 8+), open Archea Usage, set the HTTPS
base URL and Basic Auth login/password, and tap “Zapisz i sprawdź połączenie”.
Then add the Archea Usage widget to the launcher. Credentials are encrypted with
Android Keystore AES-GCM; backups and cleartext HTTP are disabled. Redirects are
rejected so credentials cannot be forwarded to another host. Failed requests
retain the cached readings and visibly report the error.

The Android scheduler refreshes approximately every 15 minutes, subject to
Android battery/Doze scheduling. Tap “Odśwież” for an immediate scheduled
refresh; the API itself still polls providers every five minutes. Tap a card
or the title to open `https://szymon.archea.dev`; the separate settings button
opens configuration. A two-column card grid uses the same 80%/100% colors and
local weekday/time format as Omarchy. Widget size is adjustable. No analytics or external SDKs.

GitHub Actions builds with JDK 17, Gradle 8.11.1, AGP 8.9.2 and SDK 35, runs
lint and Android emulator instrumentation tests, and uploads a signed APK.
Signing keys are private GitHub Actions secrets (`ANDROID_KEYSTORE` base64
PKCS12, `ANDROID_SIGNING_PASSWORD`), never committed. Keep that key for future
upgrades.

## Deployment and rollback

See `deployment/` for the unit and proxy template. Stop/disable only
`archea-usage.service`, remove only its Caddy site, validate/reload Caddy, and
remove only the `usageproxy` Incus proxy device to roll back. Preserve the
private credentials/signing key and avoid changing Operators or T3.
