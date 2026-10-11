// How a custom-Chromium context is torn down: the graceful close that flushes
// a persistent profile, the browser close, the reap of this run's Chromium
// tree and the removal of its fingerprint directory. Every step that fails is
// logged by name, because each one leaves something behind on the host.

import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import type { Browser, BrowserContext } from 'playwright';

export function closeWithProfileCleanup(
  context: BrowserContext,
  pwBrowser: Browser | null,
  fpDir: string,
): void {
  const origClose = context.close.bind(context);
  context.close = async () => {
    // Graceful close first so a persistent profile is flushed. A crashed
    // Chromium closes its protocol pipe, which Playwright reports as a
    // rejected close; that is logged by name and the reap below finishes it.
    await origClose().catch((error: Error) =>
      console.log(`[async_api] browser_context_close_failed: ${error.message}`),
    );
    await pwBrowser
      ?.close()
      .catch((error: Error) =>
        console.log(`[async_api] browser_close_failed: ${error.message}`),
      );
    // Backstop reap: kill THIS run's Chromium tree by its unique
    // --weles-fingerprint=<fpDir> arg. Concurrency-safe — the fpDir basename
    // is unique per launch, so this never touches a sibling run's browser.
    // No-op if the graceful close already terminated it; pkill's own exit
    // status for "nothing matched" is not a failure.
    const tag = fpDir.split('/').pop();
    if (tag)
      await new Promise<void>((resolve) =>
        execFile('pkill', ['-f', tag], () => resolve()),
      );
    try {
      rmSync(fpDir, { recursive: true, force: true });
    } catch (error) {
      // force: true already absorbs a missing directory, so this is real.
      console.log(
        `[async_api] fingerprint_dir_remove_failed ${fpDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}
