import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { pageSettled } from '../../_shared/page/settled.mjs';

const GITHUB_ORIGIN = 'https://github.com';

/** A repository stated as owner/repo or as its URL. */
function repositoryUrl(raw) {
  if (raw.startsWith('http')) return raw;
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `${GITHUB_ORIGIN}/${raw}`;
  throw new Error(`REPO_URL "${raw}" is neither owner/repo nor a URL`);
}

// The repository to star is the caller's: REPO_URL or TARGET_URL names it,
// or SEARCH_QUERY asks for the most-starred repository matching a query.
// With none of them the run is refused rather than starring whatever
// GitHub's trending page shows first.
const statedRepo = process.env.REPO_URL?.trim();
const repoUrl = statedRepo
  ? repositoryUrl(statedRepo)
  : process.env.TARGET_URL?.trim();
const SEARCH_QUERY = process.env.SEARCH_QUERY?.trim();
if (!repoUrl && !SEARCH_QUERY)
  throw new Error(
    'GITHUB_STAR_TARGET_REQUIRED: none of REPO_URL, TARGET_URL or SEARCH_QUERY is set: nothing names the repository to star; nothing is assumed',
  );

const acct = await getSocialAccount('github');
if (!acct) throw new Error('no active github account to star with');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'github_star',
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
  const cookies = storedJar.filter((c) => {
    if (typeof c.domain !== 'string') return false;
    const domain = c.domain.replace(/^\./, '');
    return githubHost === domain || githubHost.endsWith(`.${domain}`);
  });
  if (cookies.length) {
    await s.ctx.addCookies(cookies);
    console.log(`[star] Injected ${cookies.length} github.com cookies`);
  }
  await s.goto(
    repoUrl
      ? repoUrl
      : `${GITHUB_ORIGIN}/search?q=${encodeURIComponent(SEARCH_QUERY)}&type=repositories&s=stars&o=desc`,
  );
  checkReachable(s, 'github');
  await pageSettled(s.page);

  // GitHub names the signed-in user in its user-login meta tag; a page
  // without it was rendered for nobody.
  const signedInAs = await s.page.evaluate(
    () => document.querySelector('meta[name="user-login"]')?.content,
  );
  if (!signedInAs)
    throw new Error(
      'not_logged_in: github rendered the page for no signed-in user; cookies are stale',
    );

  // From a search, open its most-starred result.
  if (!repoUrl) {
    const repoLink = s.page
      .locator('article h3 a, article h2 a, a[data-hydro-click*="REPOSITORY"]')
      .filter({ visible: true })
      .first();
    await repoLink.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, repoLink);
    await s.page.waitForLoadState('domcontentloaded');
    await pageSettled(s.page);
  }

  // Star form: <form action="/{owner}/{repo}/star"> → <button name="star"> Star</button>.
  // After submit, GitHub re-renders to <form action="/{owner}/{repo}/unstar">.
  const unstarForm = s.page
    .locator('form[action$="/unstar"]')
    .filter({ visible: true })
    .first();
  if (await unstarForm.count()) {
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`[ban-signal] ${ban?.signal}  PASS: already starred`);
  } else {
    const starBtn = s.page
      .locator('form[action$="/star"] button[type="submit"]')
      .filter({ visible: true })
      .first();
    await starBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, starBtn);
    // Wait for state flip — Unstar form appears, action attribute changes.
    await s.page
      .locator('form[action$="/unstar"]')
      .first()
      .waitFor({ state: 'visible' });
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`[ban-signal] ${ban?.signal}  PASS: starred`);
  }
} catch (e) {
  console.error('GITHUB_STAR_FAILED:', e);
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
      const dir = runRecordingsDir('github_star');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'github_star',
            repo_url: repoUrl,
            search_query: SEARCH_QUERY,
            starred_url: s.page.url(),
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
// Reached only when the star itself succeeded: a ban signal that could not
// be recorded still fails the run, with its cause.
if (recordError)
  throw new Error(
    'GITHUB_BAN_RECORD_FAILED: the star ran but its ban signal was not recorded',
    { cause: recordError },
  );
