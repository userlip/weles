// Waiting for a page to finish what a navigation or a click started, measured
// by the page itself instead of a clock: the document has loaded and its DOM
// has gone two consecutive animation frames without a mutation. A page that
// keeps changing keeps the wait open; the run's cancellation ends it.
//
// This is the core (TypeScript) counterpart of
// src/trajectories/_shared/page/settled.mjs, for modules compiled into dist.
// The page operations a settle needs: evaluate in the document, and the
// navigation events that tell a replaced document from a failure. A page
// emits them itself; a frame's come from the page that holds it.
type NavigationEvents = {
  on(event: 'framenavigated', listener: (frame: unknown) => void): unknown;
  off(event: 'framenavigated', listener: (frame: unknown) => void): unknown;
};
export type NavigatingPage =
  | (NavigationEvents & { mainFrame(): unknown })
  | { page(): NavigationEvents };
export type EvaluatingPage = {
  evaluate(pageFunction: () => Promise<void>): Promise<unknown>;
} & NavigatingPage;

function navigationOf(target: NavigatingPage): {
  events: NavigationEvents;
  frame: unknown;
} {
  if ('mainFrame' in target) return { events: target, frame: target.mainFrame() };
  return { events: target.page(), frame: target };
}

// What a read answers when a navigation replaced the document under it.
export const DOCUMENT_REPLACED = Symbol('weles:document-replaced');

// Runs `read` against `page`. A read the page's own navigation interrupted
// answers DOCUMENT_REPLACED, so the caller asks the new document; any other
// failure is the caller's error. The replacement is the frame's navigation
// event observed during the read (one event-loop turn is allowed for it to
// arrive after the driver's rejection), as
// src/trajectories/_shared/page/navigation/read.mjs reads it, never words in
// the error the driver raised.
export async function readAcrossReplacement<T>(
  page: NavigatingPage,
  read: () => Promise<T>,
): Promise<T | typeof DOCUMENT_REPLACED> {
  let replaced = false;
  const { events, frame } = navigationOf(page);
  const onNavigated = (navigated: unknown) => {
    if (navigated === frame) replaced = true;
  };
  events.on('framenavigated', onNavigated);
  try {
    return await read();
  } catch (error) {
    if (!replaced) {
      const turn = Promise.withResolvers<void>();
      setImmediate(turn.resolve);
      await turn.promise;
    }
    if (!replaced) throw error;
    return DOCUMENT_REPLACED;
  } finally {
    events.off('framenavigated', onNavigated);
  }
}

// Runs inside the page: settled once this animation frame and the one before
// it both passed without a DOM mutation.
function settleInPage(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const quiet = () => {
    let changed = true;
    let quietBefore = false;
    const observer = new MutationObserver(() => {
      changed = true;
    });
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const frame = () => {
      const quietNow = !changed;
      changed = false;
      if (quietNow && quietBefore) {
        observer.disconnect();
        resolve();
        return;
      }
      quietBefore = quietNow;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  if (document.readyState === 'complete') quiet();
  else window.addEventListener('load', quiet, { once: true });
  return promise;
}

export async function pageSettled(page: EvaluatingPage): Promise<void> {
  // When a navigation replaces the document mid-wait, the new document is the
  // one that has to settle.
  while (
    (await readAcrossReplacement(page, () => page.evaluate(settleInPage))) ===
    DOCUMENT_REPLACED
  );
}
