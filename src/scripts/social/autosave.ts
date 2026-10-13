/**
 * Draft autosave that cannot fight the server's revision guard: edits are
 * debounced into one save, never two saves run at once (an edit during a
 * save waits for it), and the first failed save -- typically post_changed,
 * someone else edited the post -- stops autosave for good. The composer
 * reports that and asks the person to reopen the post.
 */
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class AutosaveQueue {
  private timer: unknown = null;
  private dirty = false;
  private running: Promise<void> | null = null;
  private _stopped = false;

  constructor(private save: () => Promise<void>, private delayMs: number, private timers: Timers = realTimers) {}

  get stopped(): boolean { return this._stopped; }

  /** Call on every edit. */
  touch(): void {
    if (this._stopped) return;
    this.dirty = true;
    if (this.running) return; // scheduled when the running save finishes
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => { this.timer = null; void this.run(); }, this.delayMs);
  }

  /** Save now if anything is pending (before closing, before submitting). */
  async flush(): Promise<void> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (this.running) await this.running;
    if (this.dirty && !this._stopped) await this.run();
  }

  stop(): void {
    this._stopped = true;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  private run(): Promise<void> {
    if (this._stopped || !this.dirty) return Promise.resolve();
    this.dirty = false;
    this.running = this.save()
      .catch(() => { this.stop(); })
      .finally(() => {
        this.running = null;
        if (this.dirty && !this._stopped) this.touch();
      });
    return this.running;
  }
}
