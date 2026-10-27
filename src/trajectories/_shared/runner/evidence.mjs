/**
 * A screenshot is evidence of a step, never the step itself. A page that is
 * mid-navigation or already closed refuses the capture, and that refusal is
 * worth a log line, not the end of the run. Returns the written path, or false
 * when nothing was captured.
 */
export async function screenshotIfPossible(s, label) {
  const [capture] = await Promise.allSettled([s.screenshot(label)]);
  if (capture.status === 'fulfilled') return capture.value;
  const cause =
    capture.reason instanceof Error
      ? capture.reason.message
      : String(capture.reason);
  console.log(`[screenshot] ${label} not captured: ${cause}`);
  return false;
}
