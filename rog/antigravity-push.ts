// Uses the signed-in CLI's quota command. No model turn or credential copying.
import { reset, type Window } from "../src/providers.ts";
import { pushUrl } from "./claude-push.ts";

type Reading = { windows: Window[] } | { error: string };
type Result = { success: boolean; stdout: string };
type Runner = (cli: string) => Promise<Result>;

export function parseAntigravity(data: any): Window[] {
  if (
    data?.status !== "SUCCESS" || data.command?.name !== "usage" ||
    !Array.isArray(data.command.data?.groups)
  ) throw new Error("invalid_response");
  const windows: Window[] = [];
  for (const group of data.command.data.groups) {
    if (typeof group?.name !== "string" || !/^gemini\b/i.test(group.name)) {
      continue;
    }
    if (!Array.isArray(group.buckets)) throw new Error("invalid_response");
    for (const bucket of group.buckets) {
      if (bucket?.disabled === true) continue;
      const fraction = bucket?.remaining_fraction;
      if (
        typeof bucket?.id !== "string" ||
        !/^gemini-[a-z0-9-]{1,25}$/.test(bucket.id) ||
        typeof fraction !== "number" || !Number.isFinite(fraction) ||
        fraction < 0 || fraction > 1 ||
        windows.some((w) => w.label === bucket.id)
      ) throw new Error("invalid_response");
      const resetsAt = reset(bucket.reset_time);
      if (bucket.reset_time != null && !resetsAt) {
        throw new Error("invalid_response");
      }
      windows.push({
        label: bucket.id,
        usedPercent: (1 - fraction) * 100,
        resetsAt,
      });
    }
  }
  if (!windows.length || windows.length > 6) {
    throw new Error("invalid_response");
  }
  return windows;
}

async function runCli(cli: string): Promise<Result> {
  const child = new Deno.Command(cli, {
    args: ["-p", "/usage", "--output-format", "json"],
    stdin: "null",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const timer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch { /* Already exited. */ }
  }, 45000);
  try {
    const result = await child.output();
    return {
      success: result.success,
      stdout: new TextDecoder().decode(result.stdout),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function readAntigravity(
  cli = "agy",
  run: Runner = runCli,
): Promise<Reading> {
  let result: Result;
  try {
    result = await run(cli);
  } catch (error) {
    return {
      error: error instanceof Deno.errors.NotFound
        ? "credentials_missing"
        : "provider_unavailable",
    };
  }
  if (!result.success) return { error: "provider_unavailable" };
  try {
    return { windows: parseAntigravity(JSON.parse(result.stdout)) };
  } catch {
    return { error: "invalid_response" };
  }
}

if (import.meta.main) {
  const home = Deno.env.get("HOME")!;
  const config = JSON.parse(
    await Deno.readTextFile(
      Deno.args[0] ?? `${home}/.config/archea-usage/push.json`,
    ),
  );
  // Reuse the existing push secret; only public quota readings leave ROG.
  const url = pushUrl(config.url);
  url.pathname = "/v1/push/antigravity";
  const reading = await readAntigravity(Deno.args[1] ?? "agy");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(reading),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  await response.body?.cancel().catch(() => {});
  console.log(
    `Antigravity: ${
      "windows" in reading
        ? `${reading.windows.length} quota windows`
        : reading.error
    }; Archea HTTP ${response.status}`,
  );
  if (response.status !== 204) Deno.exitCode = 1;
}
