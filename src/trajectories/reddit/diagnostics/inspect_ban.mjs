/**
 * Reddit ban inspector — logs into an account, opens its home page and own
 * profile logged in and logged out, and prints each page's text beside the
 * account record Reddit itself serves (`/user/<name>/about.json`): its HTTP
 * status and body, where `data.is_suspended` says a suspension and a
 * logged-out 404 says the profile is hidden from others. Words on the page
 * are not classified: what Reddit states about the account is printed as it
 * states it.
 *
 * Usage:
 *   ACCOUNT_ID=<id> xvfb-run -a node src/trajectories/reddit/diagnostics/inspect_ban.mjs
 */
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { humanIdlePause } from '../../../../dist/human/mouse.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

const acct = await getSocialAccount('reddit');
if (!acct)
  throw new Error(
    'REDDIT_ACCOUNT_UNAVAILABLE: no active reddit account in the account store',
  );
console.log(`[inspect] account: ${acct.username}`);

const { proxyUrl } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'reddit_inspect_ban',
  proxy: proxyUrl,
  targetHost: 'www.reddit.com',
});

try {
  // Inject stored cookies so we're logged in
  const stored = Array.isArray(acct.metadata?.cookies)
    ? acct.metadata.cookies
    : [];
  const hasSession = stored.some((c) => /reddit_session/.test(c?.name ?? ''));
  if (hasSession) {
    const prepared = stored
      .filter((c) => c?.name && c?.value && (c.domain || c.url))
      .map((c) => ({ ...c, path: c.path || '/' }));
    await s.ctx.addCookies(prepared);
    console.log(`[inspect] injected ${prepared.length} cookies`);
  }

  // Navigate to homepage first (this is where ban banners usually appear)
  await s.page.goto('https://www.reddit.com/', {
    waitUntil: 'domcontentloaded',
  });
  // Reddit SPA needs time to hydrate — wait for content to appear
  await humanIdlePause('long');
  const homeUrl = s.page.url();
  const homeText = await s.page.evaluate(() => document.body?.innerText ?? '');
  await s.page.screenshot({
    path: `${runRecordingsDir('reddit_inspect_ban')}/homepage_logged_in.png`,
  });
  console.log(`[inspect] homepage url: ${homeUrl}`);
  console.log(`[inspect] homepage text:\n${homeText}`);

  // What Reddit states about the account, as it states it.
  const about = async (view) => {
    const response = await s.page.goto(
      `https://www.reddit.com/user/${encodeURIComponent(acct.username)}/about.json`,
    );
    if (!response)
      throw new Error(`the ${view} about.json navigation produced no response`);
    const body = await response.text();
    console.log(
      `[inspect] account record (${view}): HTTP ${response.status()} ${body}`,
    );
  };
  await about('logged in');

  // Now navigate to own profile
  const profileUrl = `https://www.reddit.com/user/${acct.username}/`;
  await s.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  const finalUrl = s.page.url();
  const fullText = await s.page.evaluate(() => document.body?.innerText ?? '');
  await s.page.screenshot({
    path: `${runRecordingsDir('reddit_inspect_ban')}/profile_logged_in.png`,
  });
  console.log(`[inspect] profile url: ${finalUrl}`);
  console.log(`[inspect] profile text:\n${fullText}`);

  // Now check the same profile WITHOUT cookies (logged-out view)
  console.log('[inspect] --- checking logged-out view ---');
  await s.ctx.clearCookies();
  await s.page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  const logoutUrl = s.page.url();
  const logoutText = await s.page.evaluate(
    () => document.body?.innerText ?? '',
  );
  console.log(`[inspect] logged-out url: ${logoutUrl}`);
  console.log(`[inspect] logged-out text:\n${logoutText}`);
  await about('logged out');
} catch (e) {
  console.log(`[inspect] error: ${e.message}`);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
