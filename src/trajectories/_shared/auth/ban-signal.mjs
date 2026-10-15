// An account's ban signal, read after an action. Detection reads the live
// page and the captured responses, and either can fail (a closed target, a
// navigation in flight). A detection that fails answers the HEALTH_UNREAD
// signal, not healthy, carrying the moment and the cause, so every caller
// that prints, keeps or acts on the signal says that the health was never
// read and why, instead of printing "undefined" or reading nothing.

export const HEALTH_UNREAD = 'health_unread';

export async function banSignalOf(detect, session, moment) {
  let failure;
  try {
    return await detect(session.page, session.capturedResponses);
  } catch (error) {
    failure = error;
  }
  console.error(`[ban-signal] detection ${moment} failed: ${failure}`);
  return {
    healthy: false,
    signal: HEALTH_UNREAD,
    details: {
      moment,
      final_url: session.page.url(),
      error: failure instanceof Error ? failure.message : String(failure),
    },
  };
}
