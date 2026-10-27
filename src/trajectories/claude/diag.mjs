// Page-state capture for the claude login trajectory's failure paths. Each
// read settles on its own, so a closed or navigating page still yields the
// fields it can, and a field it cannot read names the error that stopped it,
// instead of throwing over the real failure. Keeps the captured-field set
// identical across failure points so blobs from different stall points are
// directly comparable.

/** A settled read as the blob shows it: the value, or the read's error. */
function shown(label, settled) {
  return settled.status === 'fulfilled'
    ? settled.value
    : `${label}-err:${settled.reason.message}`;
}

export async function pageDiag(page, { html = false } = {}) {
  const key = html ? 'html' : 'bodyText';
  const [url, title, content] = await Promise.allSettled([
    // `url()` answers at once and throws on a page that is gone.
    Promise.resolve().then(() => page.url()),
    page.title(),
    (html ? page.content() : page.locator('body').innerText()).then((text) =>
      text.replace(/\s+/g, ' '),
    ),
  ]);
  // The console lines the trajectory's listener collected; a run that
  // installed no listener says so rather than showing an empty console.
  const consoleLines = Array.isArray(globalThis.__claudeConsole)
    ? JSON.stringify(globalThis.__claudeConsole)
    : 'not-captured';
  return `url=${shown('url', url)} title=${JSON.stringify(shown('title', title))} console=${consoleLines} ${key}=${JSON.stringify(shown(html ? 'html' : 'body', content))}`;
}
