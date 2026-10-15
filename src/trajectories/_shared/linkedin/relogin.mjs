// Inline relogin for LinkedIn actions whose stored jar is stale.
//
// It signs the account in again on the action's own session, so the li_at
// cookie is minted on the proxy session the action already uses and the
// action that follows leaves from the same exit address: stale cookies and
// the page's storage are cleared, the sign-in form is submitted
// (./sign_in.mjs), and any checkpoint before or after it goes through the
// captcha solver (./checkpoint.mjs). Answers { ok: true, liAt, finalUrl };
// a relogin that does not reach li_at throws with where it ended.
import { pageSettled } from '../page/settled.mjs';
import { solveLinkedinCheckpoint } from './checkpoint.mjs';
import { onCheckpointRoute, onSignInPage, submitLinkedinPassword } from './sign_in.mjs';

const SIGN_IN_URL = 'https://www.linkedin.com/login';

export async function reloginLinkedinInline(s, acct) {
  const login = acct.metadata?.email ? acct.metadata.email : acct.username;
  const password = acct.metadata?.password;
  if (!login || !password)
    throw new Error(`LINKEDIN_RELOGIN_UNAVAILABLE: ${acct.username} holds no password to sign in again with`);
  // Stale cookies would bounce /login back to the feed.
  await s.ctx.clearCookies();
  await s.page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  if (onCheckpointRoute(s.page.url())) {
    const solved = await solveLinkedinCheckpoint(s, 'relogin-pre-form', login);
    if (solved.liAt) return { ok: true, liAt: solved.liAt, finalUrl: solved.finalUrl };
  }
  if (!onSignInPage(s.page.url()) && !onCheckpointRoute(s.page.url())) {
    // Auth state kept in the page's storage redirected away from /login.
    await s.page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await s.page.goto(SIGN_IN_URL, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
  }
  await submitLinkedinPassword(s, login, password);
  let liAt = (await s.ctx.cookies()).find((c) => c.name === 'li_at' && c.value);
  let finalUrl = s.page.url();
  if (!liAt && onCheckpointRoute(finalUrl))
    ({ liAt, finalUrl } = await solveLinkedinCheckpoint(s, 'relogin-post-submit', login));
  if (!liAt)
    throw new Error(`LINKEDIN_RELOGIN_UNSIGNED: no li_at cookie after the sign-in form; the session is at ${finalUrl}`);
  console.log(`[linkedin_relogin] li_at minted on the action's session at ${finalUrl}`);
  return { ok: true, liAt, finalUrl };
}
