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
export type EvaluatingPage = {
  evaluate(pageFunction: () => Promise<void>): Promise<unknown>;
} & (
  | (NavigationEvents & { mainFrame(): unknown })
  | { page(): NavigationEvents }
);

function navigationOf(target: EvaluatingPage): {
  events: NavigationEvents;
  frame: unknown;
} {
  if ('mainFrame' in target) return { events: target, frame: target.mainFrame() };
  return { events: target.page(), frame: target };
}

// Runs inside the page.
function settleInPage(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const quiet = () => {
    let changed = true;
    let quietFrames = 0;
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
      quietFrames = changed ? 0 : quietFrames + 1;
      changed = false;
      if (quietFrames >= 2) {
        observer.disconnect();
        resolve();
        return;
      }
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
  // one that has to settle; any other failure is the caller's error. The
  // replacement is the settling frame's own navigation event observed during the
  // wait, as src/trajectories/_shared/page/navigation/read.mjs reads it, not
  // words in the error the driver raised.
  for (;;) {
    let replaced = false;
    const { events, frame } = navigationOf(page);
    const onNavigated = (navigated: unknown) => {
      if (navigated === frame) replaced = true;
    };
    events.on('framenavigated', onNavigated);
    try {
      await page.evaluate(settleInPage);
      return;
    } catch (error) {
      if (!replaced) throw error;
    } finally {
      events.off('framenavigated', onNavigated);
    }
  }
}
