// The page a session captures through, and the operator's own browser a
// session attaches to instead of launching one.

import { type BrowserContext, type Page, chromium } from 'playwright';
import { Capture, type CDPBrowserContext } from '../../../capture/capture.js';
import { installBrowserEvidencePolicy } from '../../../agent/browser-evidence-policy.js';
import type { OperatorCdpConfig } from '../../placement/operator-cdp.js';
import { recordingsDir } from '../../run-recordings.js';

/** A context adopted from the operator's own browser over the devtools port. */
export interface OperatorSession {
  kind: 'operator-cdp';
  ctx: BrowserContext;
  page: Page;
  capture: Capture;
  label: string;
}

// Capture takes the devtools-shaped context it screenshots through; a session
// hands it the one page it owns. The library's own context type is not
// structurally compatible with a Playwright page host, so the single-page
// host is asserted into it here, once.
export function captureFor(page: Page, label: string): Capture {
  const pageHost = {
    newPage: async () => page,
  } as unknown as CDPBrowserContext;
  return new Capture(pageHost, label ? recordingsDir(label) : undefined);
}

// The operator's browser is already running and already logged in: attach to
// its devtools endpoint, take the context and page it offers, and put the
// browser-evidence policy on before anything navigates.
export async function adoptOperatorBrowser(
  operatorCdp: OperatorCdpConfig,
  label: string,
): Promise<OperatorSession> {
  const browser = await chromium.connectOverCDP(operatorCdp.endpoint, {
    headers: { Authorization: `Bearer ${operatorCdp.token}` },
  });
  // A context the operator's browser does not already offer is created with
  // the browser's own locale: the identity there is the operator's, not one
  // Weles picks.
  const [kept] = browser.contexts();
  const ctx = kept
    ? kept
    : await browser.newContext(
        process.env.WELES_BROWSER_EVIDENCE_POLICY === 'spis-browser-evidence.1'
          ? { acceptDownloads: false, serviceWorkers: 'block' as const }
          : {},
      );
  await installBrowserEvidencePolicy(ctx, label);
  const [shown] = ctx.pages();
  const page = shown ? shown : await ctx.newPage();
  return {
    kind: 'operator-cdp',
    ctx,
    page,
    capture: captureFor(page, label),
    label,
  };
}
