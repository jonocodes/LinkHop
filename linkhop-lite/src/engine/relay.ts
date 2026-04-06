import type { AnyProtocolEvent } from "../protocol/types.js";

export type RelayListener = (event: AnyProtocolEvent) => void;

export interface RelayOptions {
  /** If set, events older than this are dropped on delivery */
  retentionMs?: number;
}

/**
 * In-memory fake ntfy relay for testing.
 * Holds topics, subscriptions, and a log of all published events.
 * No network, no async — everything is synchronous for deterministic tests.
 */
export class InMemoryRelay {
  private subscriptions = new Map<string, Set<RelayListener>>();
  private topicEvents = new Map<string, { event: AnyProtocolEvent; publishedAt: number }[]>();
  private options: RelayOptions;

  /** Events dropped by explicit drop rules */
  dropped: AnyProtocolEvent[] = [];

  /** Topics where next N publishes will be silently dropped */
  private dropNext = new Map<string, number>();

  /** Topics where next N deliveries will be duplicated */
  private dupNext = new Map<string, number>();

  constructor(options: RelayOptions = {}) {
    this.options = options;
  }

  subscribe(topic: string, listener: RelayListener): () => void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(listener);

    // Deliver retained events (within retention window)
    const retained = this.getRetained(topic);
    for (const entry of retained) {
      listener(entry.event);
    }

    return () => {
      this.subscriptions.get(topic)?.delete(listener);
    };
  }

  publish(topic: string, event: AnyProtocolEvent): void {
    // Check drop rule
    const dropCount = this.dropNext.get(topic) ?? 0;
    if (dropCount > 0) {
      this.dropNext.set(topic, dropCount - 1);
      this.dropped.push(event);
      return;
    }

    // Store in topic log
    if (!this.topicEvents.has(topic)) {
      this.topicEvents.set(topic, []);
    }
    this.topicEvents.get(topic)!.push({ event, publishedAt: Date.now() });

    // Deliver to subscribers
    const listeners = this.subscriptions.get(topic);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);

        // Check dup rule
        const dupCount = this.dupNext.get(topic) ?? 0;
        if (dupCount > 0) {
          this.dupNext.set(topic, dupCount - 1);
          listener(event);
        }
      }
    }
  }

  /** Drop the next N publishes to a topic (simulates lost events) */
  dropNextPublishes(topic: string, count: number): void {
    this.dropNext.set(topic, count);
  }

  /** Duplicate the next N deliveries on a topic */
  duplicateNextDeliveries(topic: string, count: number): void {
    this.dupNext.set(topic, count);
  }

  /** Get all events stored on a topic */
  getTopicLog(topic: string): AnyProtocolEvent[] {
    return (this.topicEvents.get(topic) ?? []).map((e) => e.event);
  }

  /** Clear all state */
  reset(): void {
    this.subscriptions.clear();
    this.topicEvents.clear();
    this.dropNext.clear();
    this.dupNext.clear();
    this.dropped = [];
  }

  private getRetained(topic: string): { event: AnyProtocolEvent; publishedAt: number }[] {
    const entries = this.topicEvents.get(topic) ?? [];
    if (this.options.retentionMs === undefined) return entries;
    const cutoff = Date.now() - this.options.retentionMs;
    return entries.filter((e) => e.publishedAt >= cutoff);
  }
}
