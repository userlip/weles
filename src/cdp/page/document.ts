// What a CDP page asks of its current document: a selector's state, a
// screenshot, the main frame's URL. Each answer comes from the browser's own
// events and results; nothing is substituted when one is missing.
import { writeFileSync } from 'node:fs';
import { CDPConnection } from '../connection.js';
import { CDPError } from '../errors.js';
import { FrameTree } from './frame.js';

const XPATH_PREFIX = 'xpath=';

// The selector states of the Playwright page interface this page implements,
// and whether each is met by the element being present in the document.
export type SelectorState = 'attached' | 'detached' | 'visible' | 'hidden';
const MET_BY_PRESENCE: Record<SelectorState, boolean> = {
  attached: true,
  visible: true,
  detached: false,
  hidden: false,
};

function selectorCheck(selector: string, state: SelectorState): string {
  const base = selector.startsWith(XPATH_PREFIX)
    ? `document.evaluate(${JSON.stringify(selector.slice(XPATH_PREFIX.length))},document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue`
    : `document.querySelector(${JSON.stringify(selector)})`;
  return MET_BY_PRESENCE[state] ? `!!(${base})` : `!(${base})`;
}

/**
 * Waits until `selector` reaches `state` in the main frame's document,
 * resolved inside the page by a MutationObserver: the DOM change that
 * satisfies the selector ends the wait. When the main frame started loading a
 * new document during the wait, the new document is asked the same question;
 * any other failure is the caller's.
 */
export async function waitForSelectorIn(
  conn: CDPConnection,
  sessionId: string,
  frames: FrameTree,
  selector: string,
  state: SelectorState,
): Promise<void> {
  const condition = selectorCheck(selector, state);
  const js = `new Promise((resolve) => {
    const check = () => ${condition};
    if (check()) { resolve(true); return; }
    new MutationObserver((_, observer) => { if (check()) { observer.disconnect(); resolve(true); } })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  })`;
  for (;;) {
    const frame = frames.mainFrame;
    if (!frame) throw new CDPError('No main frame');
    let replaced = false;
    const onLoading = (params: any) => {
      if (params.frameId === frame.frameId) replaced = true;
    };
    conn.on('Page.frameStartedLoading', onLoading, sessionId);
    try {
      await frame.evaluate(js);
      return;
    } catch (error) {
      if (!replaced) throw error;
    } finally {
      conn.off('Page.frameStartedLoading', onLoading, sessionId);
    }
  }
}

/**
 * A screenshot of the page in `format`. A full-page capture clips to the
 * document's own content rectangle at the visual viewport's scale, both as
 * the browser measures them.
 */
export async function captureScreenshot(
  conn: CDPConnection,
  sessionId: string,
  options: { path?: string; fullPage?: boolean; format: string },
): Promise<Buffer> {
  const params: Record<string, any> = { format: options.format };
  if (options.fullPage) {
    const { cssContentSize, cssVisualViewport } = await conn.send(
      'Page.getLayoutMetrics',
      undefined,
      sessionId,
    );
    params.clip = { ...cssContentSize, scale: cssVisualViewport.scale };
    params.captureBeyondViewport = true;
  }
  const { data } = await conn.send('Page.captureScreenshot', params, sessionId);
  const buf = Buffer.from(data, 'base64');
  if (options.path) writeFileSync(options.path, buf);
  return buf;
}

/**
 * Resolves once the main frame's URL, as a cross-document or same-document
 * navigation reports it, satisfies `matches`.
 */
export function waitForMainFrameUrl(
  conn: CDPConnection,
  sessionId: string,
  frames: FrameTree,
  matches: (url: string) => boolean,
): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const settle = (frameId: string, url: string) => {
    if (frameId !== frames.mainFrame?.frameId || !matches(url)) return;
    conn.off('Page.frameNavigated', onNavigated, sessionId);
    conn.off('Page.navigatedWithinDocument', onWithinDocument, sessionId);
    resolve();
  };
  const onNavigated = (params: any) => settle(params.frame.id, params.frame.url);
  const onWithinDocument = (params: any) => settle(params.frameId, params.url);
  conn.on('Page.frameNavigated', onNavigated, sessionId);
  conn.on('Page.navigatedWithinDocument', onWithinDocument, sessionId);
  return promise;
}
