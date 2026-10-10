type Document = Record<string, any>;
type Credential = {
  document: Document;
  entry: Document;
  scope: string | null;
  token: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

const earlyRefreshMs = 10 * 60 * 1000;
const rejectedRefreshTokens = new Map<string, string>();

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function changed(a: Credential, b: Credential): boolean {
  return a.token !== b.token || a.refreshToken !== b.refreshToken ||
    a.scope !== b.scope || a.entry.account_id !== b.entry.account_id;
}

function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1].replaceAll("-", "+").replaceAll(
      "_",
      "/",
    );
    const exp = JSON.parse(atob(payload)).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

async function read(path: string, id: string): Promise<Credential> {
  const document = JSON.parse(await Deno.readTextFile(path));
  const scope = id === "grok"
    ? Object.keys(document).find((key) =>
      text(document[key]?.key) &&
      document[key]?.oidc_issuer === "https://auth.x.ai"
    ) ?? Object.keys(document).find((key) => text(document[key]?.key))
    : null;
  const entry = id === "codex" ? document.tokens : document[scope!];
  const token = id === "codex" ? entry?.access_token : entry?.key;
  if (!text(token)) throw new Error("login_required");
  const expiry = id === "grok" && text(entry.expires_at)
    ? Date.parse(entry.expires_at)
    : null;
  return {
    document,
    entry,
    scope: scope ?? null,
    token,
    refreshToken: text(entry.refresh_token) ? entry.refresh_token : null,
    expiresAt: expiry !== null && Number.isFinite(expiry)
      ? expiry
      : jwtExpiry(token),
  };
}

async function save(
  path: string,
  document: Document,
  temp: string,
  file: Deno.FsFile,
): Promise<void> {
  try {
    const bytes = new TextEncoder().encode(
      JSON.stringify(document, null, 2) + "\n",
    );
    let offset = 0;
    while (offset < bytes.length) {
      offset += await file.write(bytes.subarray(offset));
    }
    await file.sync();
    await Deno.rename(temp, path);
  } catch {
    throw new Error("credentials_write_failed");
  }
}

async function exchange(id: string, credential: Credential): Promise<Document> {
  if (!credential.refreshToken) throw new Error("login_required");
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: credential.refreshToken,
    client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
  };
  if (id === "grok") {
    if (
      credential.entry.oidc_issuer !== "https://auth.x.ai" ||
      !text(credential.entry.oidc_client_id)
    ) throw new Error("login_required");
    params.client_id = credential.entry.oidc_client_id;
    for (const key of ["principal_type", "principal_id"]) {
      if (text(credential.entry[key])) params[key] = credential.entry[key];
    }
  }
  const response = await fetch(
    id === "codex"
      ? "https://auth.openai.com/oauth/token"
      : "https://auth.x.ai/oauth2/token",
    {
      method: "POST",
      headers: id === "codex"
        ? { "Content-Type": "application/json" }
        : undefined,
      body: id === "codex"
        ? JSON.stringify(params)
        : new URLSearchParams(params),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.error === "string"
      ? body.error
      : body?.error?.code;
    if (
      response.status === 401 ||
      (response.status === 400 && [
        "invalid_grant",
        "refresh_token_expired",
        "refresh_token_reused",
        "refresh_token_revoked",
      ].includes(code))
    ) throw new Error("login_required");
    throw new Error("auth_refresh_failed");
  }
  const tokens = await response.json();
  if (!text(tokens.access_token)) throw new Error("invalid_response");
  for (const key of ["refresh_token", "id_token"]) {
    if (tokens[key] != null && !text(tokens[key])) {
      throw new Error("invalid_response");
    }
  }
  return tokens;
}

async function refresh(
  path: string,
  id: string,
  previous: Credential,
  forced: boolean,
): Promise<Credential> {
  let lock: Deno.FsFile;
  let stagedFile: Deno.FsFile | undefined;
  let stagedPath: string | undefined;
  try {
    lock = await Deno.open(`${path}.lock`, {
      read: true,
      write: true,
      create: true,
      mode: 0o600,
    });
  } catch {
    throw new Error("credentials_write_failed");
  }
  try {
    const deadline = performance.now() + 15000;
    while (!await lock.tryLock(true)) {
      if (performance.now() >= deadline) throw new Error("auth_refresh_failed");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await lock.truncate(0);
    await lock.write(
      new TextEncoder().encode(`${Deno.pid}:${Math.floor(Date.now() / 1000)}`),
    );
    const current = await read(path, id);
    if (changed(current, previous)) return current;
    if (
      !forced &&
      (current.expiresAt === null ||
        current.expiresAt > Date.now() + earlyRefreshMs)
    ) return current;
    if (rejectedRefreshTokens.get(path) === current.refreshToken) {
      throw new Error("login_required");
    }
    if (!current.refreshToken) throw new Error("login_required");
    stagedPath = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      stagedFile = await Deno.open(stagedPath, {
        write: true,
        createNew: true,
        mode: 0o600,
      });
    } catch {
      throw new Error("credentials_write_failed");
    }
    let tokens: Document;
    try {
      tokens = await exchange(id, current);
    } catch (error) {
      const latest = await read(path, id);
      if (changed(latest, current)) return latest;
      if (
        error instanceof Error && error.message === "login_required" &&
        current.refreshToken
      ) {
        rejectedRefreshTokens.set(path, current.refreshToken);
      }
      throw error;
    }
    const latest = await read(path, id);
    if (changed(latest, current)) return latest;
    const now = Date.now();
    if (id === "codex") {
      latest.entry.access_token = tokens.access_token;
      if (text(tokens.id_token)) latest.entry.id_token = tokens.id_token;
      latest.document.last_refresh = new Date(now).toISOString();
    } else {
      latest.entry.key = tokens.access_token;
      latest.entry.create_time = new Date(now).toISOString();
      const expiry = typeof tokens.expires_in === "number" &&
          Number.isFinite(tokens.expires_in) && tokens.expires_in > 0
        ? now + tokens.expires_in * 1000
        : jwtExpiry(tokens.access_token);
      latest.entry.expires_at = expiry === null
        ? null
        : new Date(expiry).toISOString();
    }
    if (text(tokens.refresh_token)) {
      latest.entry.refresh_token = tokens.refresh_token;
    }
    await save(path, latest.document, stagedPath, stagedFile);
    rejectedRefreshTokens.delete(path);
    return await read(path, id);
  } finally {
    stagedFile?.close();
    if (stagedPath) await Deno.remove(stagedPath).catch(() => {});
    lock.close();
  }
}

export async function authenticatedGet(
  id: string,
  home: string,
  url: string,
): Promise<any> {
  const path = `${home}/.${id}/auth.json`;
  let credential = await read(path, id);
  let refreshAttempted = false;
  let refreshFailure: unknown;
  if (
    credential.refreshToken && credential.expiresAt !== null &&
    credential.expiresAt <= Date.now() + earlyRefreshMs
  ) {
    refreshAttempted = true;
    try {
      credential = await refresh(path, id, credential, false);
    } catch (error) {
      if (credential.expiresAt !== null && credential.expiresAt <= Date.now()) {
        throw error;
      }
      refreshFailure = error;
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential.token}`,
      Accept: "application/json",
    };
    if (id === "codex" && text(credential.entry.account_id)) {
      headers["ChatGPT-Account-Id"] = credential.entry.account_id;
    }
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (response.ok) return await response.json();
    await response.body?.cancel();
    if (response.status !== 401) {
      throw new Error(`provider_http_${response.status}`);
    }
    if (attempt === 1) throw new Error("login_required");
    const latest = await read(path, id);
    if (changed(latest, credential)) {
      credential = latest;
    } else {
      if (refreshAttempted) throw refreshFailure ?? new Error("login_required");
      credential = await refresh(path, id, credential, true);
    }
  }
}
