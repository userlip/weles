// An account's ban signal, read after an action. Detection reads the live
// page and the captured responses, and either can fail (a closed target, a
// navigation in flight). A detection that fails answers no signal, so the
// action's own result still stands, but the failure is said with its cause:
// a run that printed "[ban-signal] undefined" left nobody able to tell a
// healthy account from one whose health was never read.
export async function banSignalOf(detect, session, moment) {
  try {
    return await detect(session.page, session.capturedResponses);
  } catch (error) {
    console.error(`[ban-signal] detection ${moment} failed: ${error}`);
    return null;
  }
}
