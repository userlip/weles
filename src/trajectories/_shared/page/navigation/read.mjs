// Only an observed main-frame replacement makes an interrupted read retryable.
// Closure and crash are terminal, even when navigation happened first.
export const DOCUMENT_REPLACED = Symbol('weles:document-replaced');

export async function readAcrossNavigation(page, read) {
  let replaced = false;
  let terminalCode;
  const failure = (cause) =>
    Object.assign(
      new Error(
        `${terminalCode}: page read cannot continue; last URL ${page.url()}`,
        { cause },
      ),
      { code: terminalCode, pageUrl: page.url() },
    );
  if (page.isClosed()) {
    terminalCode = 'PAGE_CLOSED';
    throw failure();
  }
  const onNavigated = (frame) => {
    if (frame === page.mainFrame()) replaced = true;
  };
  const onClose = () => {
    terminalCode = 'PAGE_CLOSED';
  };
  const onCrash = () => {
    terminalCode = 'PAGE_CRASHED';
  };
  page.on('framenavigated', onNavigated);
  page.on('close', onClose);
  page.on('crash', onCrash);
  try {
    return await read();
  } catch (error) {
    if (!replaced && !terminalCode && !page.isClosed())
      await new Promise((resolve) => setImmediate(resolve));
    if (!terminalCode && page.isClosed()) terminalCode = 'PAGE_CLOSED';
    if (terminalCode) throw failure(error);
    if (replaced) return DOCUMENT_REPLACED;
    throw error;
  } finally {
    page.off('framenavigated', onNavigated);
    page.off('close', onClose);
    page.off('crash', onCrash);
  }
}

// A read whose document was replaced by a navigation the caller expects (an
// OAuth redirect chain, a poll across page loads) answers `whenReplaced`, the
// value meaning "not there yet" to that caller; closure and crash still throw.
export async function readOr(page, read, whenReplaced) {
  const value = await readAcrossNavigation(page, read);
  return value === DOCUMENT_REPLACED ? whenReplaced : value;
}

// readOr for a function evaluated in the page.
export function navEval(page, fn, whenReplaced, arg) {
  return readOr(page, () => page.evaluate(fn, arg), whenReplaced);
}
