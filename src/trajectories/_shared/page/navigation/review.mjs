// Operator review has an observable end, not an unresolved promise: it ends
// when the page or its context closes or the process is told to stop, and a
// page that crashes during review is refused as PAGE_CRASHED.
export async function reviewUntilClosed(session) {
  const { page, ctx } = session;
  if (page.isClosed()) return;
  const { promise, resolve, reject } = Promise.withResolvers();
  const onClose = () => resolve();
  const onCrash = () =>
    reject(
      Object.assign(new Error('page crashed during operator review'), {
        code: 'PAGE_CRASHED',
        operation: 'operator_review',
        pageUrl: page.url(),
      }),
    );
  page.on('close', onClose);
  page.on('crash', onCrash);
  ctx.on('close', onClose);
  process.on('SIGINT', onClose);
  process.on('SIGTERM', onClose);
  try {
    await promise;
  } finally {
    page.off('close', onClose);
    page.off('crash', onCrash);
    ctx.off('close', onClose);
    process.off('SIGINT', onClose);
    process.off('SIGTERM', onClose);
  }
}
