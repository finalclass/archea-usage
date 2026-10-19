import { activeMeterIds, empty, type Meter, safeError } from "./providers.ts";
export class Cache {
  meters: Meter[];
  private pending: Promise<void> | null = null;
  lastAttempt: string | null = null;
  constructor(
    private fetcher: (id: string) => Promise<Meter>,
    readonly intervalSeconds = 300,
    ids: string[] = activeMeterIds,
  ) {
    this.meters = ids.map((id) => {
      const meter = empty(id);
      if (id === "greenpt" && ids.includes("greenpt_opencode")) {
        meter.label = "GreenPT · dodatkowe";
      }
      return meter;
    });
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  private async run() {
    this.lastAttempt = new Date().toISOString();
    this.meters = await Promise.all(this.meters.map(async (old) => {
      try {
        return await this.fetcher(old.id);
      } catch (e) {
        return { ...old, stale: true, error: safeError(e) };
      }
    }));
  }
  snapshot() {
    return {
      version: 1,
      refreshIntervalSeconds: this.intervalSeconds,
      lastAttempt: this.lastAttempt,
      meters: this.meters,
    };
  }
}
