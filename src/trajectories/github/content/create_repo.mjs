import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

// The repository's name and description are public under the account's name
// and are the caller's; neither is drawn from a word pool or written here.
const REPO_NAME = statedText(
  ['REPO_NAME'],
  'the name of the repository to create',
)
  // GitHub decides how long a name may be and says so; no cut is chosen here.
  .replace(/[^a-zA-Z0-9_.-]/g, '');
const REPO_DESC = statedText(
  ['REPO_DESC'],
  'the public description of the repository',
);

const acct = await getSocialAccount('github');
if (!acct) {
  console.log('FAIL: no active github account');
  process.exit(1);
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'github_create_repo',
  proxy: proxyUrl,
  persona,
});
let ban = null;
try {
  const cookies = (acct.metadata?.cookies ?? []).filter((c) =>
    (c.domain ?? '').includes('github.com'),
  );
  if (cookies.length) await s.ctx.addCookies(cookies);
  await s.goto('https://github.com/new');
  checkReachable(s, 'github');
  await pageSettled(s.page);
  const loggedOut = await s.page.evaluate(
    () => !!document.querySelector('a[href="/login"]'),
  );
  if (loggedOut) throw new Error('not_logged_in: cookies stale');

  // Deterministic Playwright. GitHub /new form selectors:
  //   input#repository-name-input  — repo name
  //   input[name="Description"]    — description
  //   button[type="submit"] containing "Create repository" — submit
  // README/gitignore/license toggles are optional; skip them — empty repo
  // is fine for our use case (organic-looking workspaces).
  const nameIn = s.page.locator('input#repository-name-input').first();
  await nameIn.waitFor({ state: 'visible' });
  await humanFill(s.page, nameIn, REPO_NAME);
  await pageSettled(s.page);
  const descIn = s.page.locator('input[name="Description"]').first();
  await humanFill(s.page, descIn, REPO_DESC);
  await pageSettled(s.page);
  await humanClickLocator(
    s.page,
    s.page
      .locator('button[type="submit"]')
      .filter({ hasText: 'Create repository' })
      .first(),
  );

  await submitAnswered(
    s.page,
    /github\.com\/new\b/,
    s.page
      .locator('.flash-error, [role="alert"], .error')
      .filter({ hasText: /\S/ })
      .first(),
  );
  const finalUrl = s.page.url?.() ?? '';
  if (
    !new RegExp(`github\\.com/${acct.username}/${REPO_NAME}(?:/|$)`).test(
      finalUrl,
    )
  ) {
    throw new Error(`repo_not_created: final url=${finalUrl}`);
  }
  ban = await banSignalOf(
    detectGitHubBanSignals,
    s,
    'after creating the repository',
  );
  console.log(
    `[ban-signal] ${ban?.signal}  PASS: created ${acct.username}/${REPO_NAME}`,
  );
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectGitHubBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('github_create_repo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'github_create_repo',
            repo_name: REPO_NAME,
            ...ban,
            ts: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.log('[ban-signal] persist err:', e.message);
    }
  }
  await s.close();
}
