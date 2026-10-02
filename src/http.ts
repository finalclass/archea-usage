import { Cache } from "./cache.ts";
export type Credentials = { username: string; passwordHash: string };
export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function equal(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
export async function authorized(
  req: Request,
  creds: Credentials,
): Promise<boolean> {
  try {
    const header = req.headers.get("authorization") ?? "";
    if (!/^Basic /i.test(header)) return false;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
    );
    const i = decoded.indexOf(":");
    if (i < 0) return false;
    const usernameOk = equal(decoded.slice(0, i), creds.username);
    const passwordOk = equal(
      await hash(decoded.slice(i + 1)),
      creds.passwordHash,
    );
    return usernameOk && passwordOk;
  } catch {
    return false;
  }
}
const baseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export function handler(cache: Cache, creds: Credentials, downloads: string) {
  return async (req: Request): Promise<Response> => {
    if (!await authorized(req, creds)) {
      return new Response("Authentication required", {
        status: 401,
        headers: {
          ...baseHeaders,
          "WWW-Authenticate": 'Basic realm="Archea Usage", charset="UTF-8"',
        },
      });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { ...baseHeaders, Allow: "GET, HEAD" },
      });
    }
    const path = new URL(req.url).pathname;
    const json = (data: unknown) =>
      new Response(req.method === "HEAD" ? null : JSON.stringify(data), {
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    if (path === "/health") return json({ ok: true });
    if (path === "/v1/usage") return json(cache.snapshot());
    const files: Record<string, [string, string]> = {
      "/downloads/omarchy.tar.gz": ["omarchy.tar.gz", "application/gzip"],
      "/downloads/android.apk": [
        "android.apk",
        "application/vnd.android.package-archive",
      ],
    };
    if (files[path]) {
      const [file, mime] = files[path];
      try {
        const bytes = await Deno.readFile(`${downloads}/${file}`);
        return new Response(req.method === "HEAD" ? null : bytes, {
          headers: {
            ...baseHeaders,
            "Content-Type": mime,
            "Content-Disposition": `attachment; filename="${file}"`,
          },
        });
      } catch {
        return new Response("Download not available", {
          status: 404,
          headers: baseHeaders,
        });
      }
    }
    if (path === "/") {
      return new Response(
        req.method === "HEAD"
          ? null
          : '<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Archea Usage</title><style>body{font:16px system-ui;max-width:50rem;margin:2rem auto;padding:1rem;background:#101820;color:#eee}a{color:#8ed3ff}pre{white-space:pre-wrap}</style><h1>Zużycie AI</h1><p><a href="/downloads/omarchy.tar.gz">Plugin Omarchy</a> · <a href="/downloads/android.apk">Widget Android (APK)</a> · <a href="/v1/usage">API JSON</a></p><pre id="data">Ładowanie…</pre><script>async function load(){try{const r=await fetch("/v1/usage");if(!r.ok)throw Error(r.status);const d=await r.json();document.getElementById("data").textContent=d.meters.map(m=>m.label+"\\n"+(m.windows.map(w=>w.label+": "+w.usedPercent+"% zużyte · reset: "+(w.resetsAt?new Date(w.resetsAt).toLocaleString():"brak danych")).join("\\n")||(m.balance?m.balance.amount+" "+m.balance.currency:"brak danych"))+"\\nAktualizacja: "+(m.updatedAt?new Date(m.updatedAt).toLocaleString():"—")+(m.stale?" · nieaktualne":"")+(m.error?" · "+m.error:"")).join("\\n\\n")}catch(e){document.getElementById("data").textContent="Nie udało się pobrać danych"}}load();setInterval(load,300000)</script></html>',
        {
          headers: {
            ...baseHeaders,
            "Content-Type": "text/html; charset=utf-8",
          },
        },
      );
    }
    return new Response("Not found", { status: 404, headers: baseHeaders });
  };
}
