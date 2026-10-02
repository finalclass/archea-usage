import { Cache } from "./src/cache.ts";
import { collect } from "./src/providers.ts";
import { type Credentials, handler } from "./src/http.ts";
const configPath = Deno.env.get("USAGE_CONFIG");
if (!configPath) throw new Error("USAGE_CONFIG required");
const config = JSON.parse(await Deno.readTextFile(configPath)) as {
  credentials: Credentials;
  providerHome: string;
  downloads: string;
  port?: number;
  intervalSeconds?: number;
};
if (
  !config.credentials?.username ||
  !/^[a-f0-9]{64}$/.test(config.credentials?.passwordHash)
) throw new Error("Invalid authentication configuration");
const interval = config.intervalSeconds ?? 300;
if (!Number.isInteger(interval) || interval < 60) {
  throw new Error("Interval must be at least 60 seconds");
}
const cache = new Cache((id) => collect(id, config.providerHome), interval);
await cache.refresh();
const timer = setInterval(() => {
  void cache.refresh();
}, interval * 1000);
const server = Deno.serve(
  { hostname: "127.0.0.1", port: config.port ?? 7350 },
  handler(cache, config.credentials, config.downloads),
);
Deno.addSignalListener("SIGTERM", () => {
  clearInterval(timer);
  void server.shutdown();
});
