// The consent screen a provider shows between its sign-in and the caller's
// site, answered the way a person answers it: the vision model (through
// src/trajectories/_shared/page/judged/seen.mjs) says whether the settled page
// asks to grant an app access and where the control that grants it is, in
// whatever language and wording the provider uses.
import { clickOffered, pageShows } from '../page/judged/seen.mjs';

const CONSENT_SCREEN =
  'Does this page ask the signed-in user to grant another app or site access to their account?';
const GRANT_CONTROL =
  'the button that grants the requested access (not the one that declines or cancels it)';

/**
 * Answer every consent screen the provider shows, each once. A page with no
 * consent screen ends the walk; a consent screen that offers no control to
 * grant, or that is shown again at the address already answered, is refused
 * by name with the address.
 */
export async function answerOAuthConsent(page) {
  const answered = new Set();
  for (;;) {
    if (!(await pageShows(page, CONSENT_SCREEN))) return;
    const at = page.url();
    if (answered.has(at))
      throw new Error(
        `oauth_consent_not_accepted: the consent screen at ${at} is still shown after its grant was clicked`,
      );
    answered.add(at);
    if (!(await clickOffered(page, GRANT_CONTROL)))
      throw new Error(
        `oauth_consent_ungrantable: the consent screen at ${at} shows no control that grants the requested access`,
      );
  }
}
