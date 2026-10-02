import { empty, labels, type Meter, safeError } from "./providers.ts";
export class Cache {
  meters: Meter[] = Object.keys(labels).map((id) => empty(id));
  private pending: Promise<void> | null = null;
  lastAttempt: string | null = null;
  constructor(
    private fetcher: (id: string) => Promise<Meter>,
    readonly intervalSeconds = 300,
  ) {}
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
