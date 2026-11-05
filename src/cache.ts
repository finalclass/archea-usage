import {
  activeMeterIds,
  empty,
  type Meter,
  pushedMeterIds,
  safeError,
  type Window,
} from "./providers.ts";
export class Cache {
  meters: Meter[];
  private pending: Promise<void> | null = null;
  // Last time a remote collector reported for a pushed meter, success or error.
  private received = new Map<string, number>();
  lastAttempt: string | null = null;
  constructor(
    private fetcher: (id: string) => Promise<Meter>,
    readonly intervalSeconds = 300,
    ids: string[] = activeMeterIds,
    private now: () => number = Date.now,
  ) {
    this.meters = ids.map((id) => {
      const meter = empty(id);
      if (id === "greenpt" && ids.includes("greenpt_opencode")) {
        meter.label = "GreenPT · dodatkowe";
      }
      return meter;
    });
  }
  /** A pushed reading is stale after three missed collector intervals. */
  get pushStaleMs(): number {
    return this.intervalSeconds * 3 * 1000;
  }
  accepts(id: string): boolean {
    return pushedMeterIds.includes(id) && this.meters.some((m) => m.id === id);
  }
  accept(id: string, reading: { windows: Window[] } | { error: string }) {
    const at = this.now();
    this.received.set(id, at);
    this.meters = this.meters.map((old) => {
      if (old.id !== id) return old;
      if ("error" in reading) {
        return { ...old, stale: true, error: reading.error };
      }
      return {
        ...old,
        windows: reading.windows,
        updatedAt: new Date(at).toISOString(),
        stale: false,
        error: null,
      };
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
      if (pushedMeterIds.includes(old.id)) return old;
      try {
        return await this.fetcher(old.id);
      } catch (e) {
        return { ...old, stale: true, error: safeError(e) };
      }
    }));
  }
  private current(meter: Meter): Meter {
    if (!pushedMeterIds.includes(meter.id)) return meter;
    const at = this.received.get(meter.id);
    if (at !== undefined && this.now() - at <= this.pushStaleMs) return meter;
    return { ...meter, stale: true, error: "source_offline" };
  }
  snapshot() {
    return {
      version: 1,
      refreshIntervalSeconds: this.intervalSeconds,
      lastAttempt: this.lastAttempt,
      meters: this.meters.map((m) => this.current(m)),
    };
  }
}
