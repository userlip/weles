import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import {
  pageSettled,
  responseAfterAction,
} from '../../_shared/page/settled.mjs';

const GITHUB_ORIGIN = 'https://github.com';
// Whom to follow is the caller's; without TARGET_USER the run is refused
// rather than following the first profile GitHub's explore page shows.
const TARGET_USER = statedText(
  ['TARGET_USER'],
  'the GitHub user to follow',
  'GITHUB_FOLLOW_TARGET_REQUIRED',
).replace(/^@/, '');
if (!TARGET_USER)
  throw new Error('TARGET_USER is "@" alone: it names no GitHub user');

const acct = await getSocialAccount('github');
if (!acct) throw new Error('no active github account to follow with');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'github_follow',
  proxy: proxyUrl,
  persona,
});

let ban = null;
let recordError = null;
try {
  // The account's stored jar, limited to the cookies GitHub's host would be
  // sent; an account with no stored jar has none to inject.
  const githubHost = new URL(GITHUB_ORIGIN).hostname;
  const storedJar = Array.isArray(acct.metadata?.cookies)
    ? acct.metadata.cookies
    : [];
  const stored = storedJar.filter((c) => {
    if (typeof c.domain !== 'string') return false;
    const domain = c.domain.replace(/^\./, '');
    return githubHost === domain || githubHost.endsWith(`.${domain}`);
  });
  if (stored.length) await s.ctx.addCookies(stored);

  await s.goto(`${GITHUB_ORIGIN}/${encodeURIComponent(TARGET_USER)}`);
  checkReachable(s, 'github');
  await pageSettled(s.page);
  try {
    await assertAuthed('github', s, { label: 'github_follow' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) {
      try {
        await markCookiesStale(acct.id);
      } catch (markError) {
        throw new AggregateError(
          [probeErr, markError],
          'GitHub authentication and stale-cookie recording failed',
        );
      }
    }
    throw probeErr;
  }

  // GitHub follow form: <form action="/users/follow?target=<name>"> with
  // <button> Follow </button>. After click form swaps to action="/users/
  // unfollow?target=<name>". Action regex matches the path; the visible
  // form is the one we want.
  const followForm = s.page
    .locator(`form[action*="/users/follow"]`)
    .filter({ visible: true })
    .first();
  const unfollowForm = s.page
    .locator(`form[action*="/users/unfollow"]`)
    .filter({ visible: true })
    .first();
  if (await unfollowForm.count()) {
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`PASS: already following ${TARGET_USER}`);
  } else {
    await followForm.waitFor({ state: 'visible' });
    const submit = followForm
      .locator(
        'button[type="submit"], button:not([type]), input[type="submit"]',
      )
      .filter({ visible: true })
      .first();
    await submit.waitFor({ state: 'visible' });
    const response = await responseAfterAction(
      s.page,
      (request) => {
        const url = new URL(request.url());
        return (
          request.method() === 'POST' &&
          url.origin === GITHUB_ORIGIN &&
          url.pathname === '/users/follow' &&
          url.searchParams.get('target')?.toLowerCase() ===
            TARGET_USER.toLowerCase()
        );
      },
      () => humanClickLocator(s.page, submit),
    );
    const responseError = await response.finished();
    if (responseError)
      throw new Error('GITHUB_FOLLOW_RESPONSE_FAILED', {
        cause: responseError,
      });
    if (!response.ok())
      throw new Error(
        `GITHUB_FOLLOW_REFUSED: HTTP ${response.status()} at ${response.url()}`,
      );
    await unfollowForm.waitFor({ state: 'visible' });
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`PASS: followed ${TARGET_USER}`);
  }
  console.log(`[ban-signal] ${ban?.signal}`);
} catch (e) {
  console.error('GITHUB_FOLLOW_FAILED:', e);
  ban = e?.banSignal;
  if (!ban) {
    try {
      ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    } catch (error) {
      console.error('GITHUB_BAN_OBSERVATION_FAILED:', error);
    }
  }
  throw e;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('github_follow');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'github_follow',
            target_user: TARGET_USER,
            ...ban,
            ts: new Date().toISOString(),
          },
          null,
          '  ',
        ),
      );
    } catch (error) {
      console.error('GITHUB_BAN_RECORD_FAILED:', error);
      recordError = error;
    }
  }
  await s.close();
}
// Reached only when the follow itself succeeded: a ban signal that could not
// be recorded still fails the run, with its cause.
if (recordError)
  throw new Error(
    'GITHUB_BAN_RECORD_FAILED: the follow ran but its ban signal was not recorded',
    { cause: recordError },
  );
