export type LeaseCallback = (ticketId: string, action: string) => void;

interface LeaseEntry {
  ticketId: string;
  remainingMs: number;
  onTimeout: string;
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
}

export class LeaseManager {
  private leases = new Map<string, LeaseEntry>();
  private callback: LeaseCallback;

  constructor(callback: LeaseCallback) {
    this.callback = callback;
  }

  start(ticketId: string, ttlSeconds: number, onTimeout: string): void {
    this.clear(ticketId);
    const entry: LeaseEntry = {
      ticketId,
      remainingMs: ttlSeconds * 1000,
      onTimeout,
      timer: null,
      startedAt: Date.now(),
    };
    entry.timer = setTimeout(() => {
      this.leases.delete(ticketId);
      this.callback(ticketId, onTimeout);
    }, entry.remainingMs);
    this.leases.set(ticketId, entry);
  }

  pause(ticketId: string): void {
    const entry = this.leases.get(ticketId);
    if (!entry || !entry.timer) return;
    clearTimeout(entry.timer);
    entry.timer = null;
    const elapsed = Date.now() - entry.startedAt;
    entry.remainingMs = Math.max(0, entry.remainingMs - elapsed);
  }

  resume(ticketId: string): void {
    const entry = this.leases.get(ticketId);
    if (!entry || entry.timer) return;
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => {
      this.leases.delete(ticketId);
      this.callback(ticketId, entry.onTimeout);
    }, entry.remainingMs);
  }

  clear(ticketId: string): void {
    const entry = this.leases.get(ticketId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.leases.delete(ticketId);
  }

  dispose(): void {
    for (const entry of this.leases.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.leases.clear();
  }
}
