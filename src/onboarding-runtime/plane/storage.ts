// Journey storage in memory; the Weles CLI keeps its journey on disk with
// FileJourneyStorage (src/onboarding/journey-storage.ts). An entry never
// stored is answered null, as the JourneyStorage contract declares.
import type { JourneyBundle, JourneyProgress } from '../types';
import type { JourneyRuntimeEvent, JourneyStorage } from './contracts';

/** The stored entry under `key`; null when none was stored. */
function stored<T>(entries: Map<string, T>, key: string): T | null {
  if (!entries.has(key)) return null;
  return entries.get(key) as T;
}

export class MemoryJourneyStorage implements JourneyStorage {
  readonly #bundles = new Map<string, JourneyBundle>();
  readonly #progress = new Map<string, JourneyProgress>();
  readonly #events = new Map<string, JourneyRuntimeEvent>();

  async loadBundle(productId: string, journeyId: string) {
    return stored(this.#bundles, `${productId}\0${journeyId}`);
  }

  async saveBundle(bundle: JourneyBundle) {
    this.#bundles.set(
      `${bundle.definition.product_id}\0${bundle.definition.journey_id}`,
      bundle,
    );
  }

  async loadProgress(
    productId: string,
    journeyId: string,
    subjectHash: string,
  ) {
    return stored(this.#progress, `${productId}\0${journeyId}\0${subjectHash}`);
  }

  async commitProgress(
    productId: string,
    journeyId: string,
    progress: JourneyProgress,
    events: readonly JourneyRuntimeEvent[],
  ) {
    this.#progress.set(
      `${productId}\0${journeyId}\0${progress.subject_hash}`,
      progress,
    );
    for (const event of events) this.#events.set(event.event_id, event);
  }

  async pendingEvents() {
    return [...this.#events.values()];
  }
  async appendEvent(event: JourneyRuntimeEvent) {
    this.#events.set(event.event_id, event);
  }
  async removeEvent(eventId: string) {
    this.#events.delete(eventId);
  }
}
