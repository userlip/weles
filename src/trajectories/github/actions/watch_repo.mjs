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
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { pageCondition, pageSettled } from '../../_shared/page/settled.mjs';

const GITHUB_ORIGIN = 'https://github.com';

/** A repository stated as owner/repo or as its URL. */
function repositoryUrl(raw) {
  if (raw.startsWith('http')) return raw;
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `${GITHUB_ORIGIN}/${raw}`;
  throw new Error(`"${raw}" is neither owner/repo nor a URL`);
}

// The repository is the caller's (REPO_URL or TARGET_URL, or the
// most-starred match of SEARCH_QUERY), and so is how closely it is watched:
// WATCH_LEVEL (or the request's text) names the entry of GitHub's watch menu
// as GitHub labels it. Neither is assumed: the run never opens GitHub's
// trending page or picks a level itself.
const statedRepo =
  process.env.REPO_URL?.trim() || process.env.TARGET_URL?.trim();
const repoUrl = statedRepo ? repositoryUrl(statedRepo) : undefined;
const SEARCH_QUERY = process.env.SEARCH_QUERY?.trim();
if (!repoUrl && !SEARCH_QUERY)
  throw new Error(
    'GITHUB_WATCH_TARGET_REQUIRED: none of REPO_URL, TARGET_URL or SEARCH_QUERY is set: nothing names the repository to watch; nothing is assumed',
  );
const WATCH_LEVEL = statedText(
  ['WATCH_LEVEL', 'SVC_TEXT'],
  "the entry of GitHub's watch menu to choose, as GitHub labels it",
  'GITHUB_WATCH_LEVEL_REQUIRED',
);

const acct = await getSocialAccount('github');
if (!acct) throw new Error('no active github account to watch with');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'github_watch_repo',
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
  await s.goto(
    repoUrl
      ? repoUrl
      : `${GITHUB_ORIGIN}/search?q=${encodeURIComponent(SEARCH_QUERY)}&type=repositories&s=stars&o=desc`,
  );
  checkReachable(s, 'github');
  await pageSettled(s.page);
  try {
    await assertAuthed('github', s, { label: 'github_watch_repo' });
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
  // GitHub's watch control: a button labelled "Watch..." opens a menu of
  // watch levels; the chosen level is the checked entry.
  const watchBtn = s.page
    .locator('button[aria-label^="Watch"]')
    .filter({ visible: true })
    .first();
  await watchBtn.waitFor({ state: 'visible' });
  const ariaBefore = await watchBtn.getAttribute('aria-label');
  await humanClickLocator(s.page, watchBtn);
  const levelEntry = s.page
    .locator('label, button, [role="menuitemradio"]')
    .filter({ hasText: WATCH_LEVEL })
    .filter({ visible: true })
    .first();
  if (!(await levelEntry.count()))
    throw new Error(
      `GITHUB_WATCH_LEVEL_UNOFFERED: the watch menu offers no entry "${WATCH_LEVEL}"`,
    );
  if ((await levelEntry.getAttribute('aria-checked')) === 'true') {
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`PASS: already watching at "${WATCH_LEVEL}" (${ariaBefore})`);
  } else {
    await humanClickLocator(s.page, levelEntry);
    // The choice is taken when the watch control's label changes; a flash
    // error is GitHub refusing it.
    const result = await pageCondition(
      s.page,
      (before) => {
        const visible = (node) =>
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility === 'visible';
        const button = Array.from(
          document.querySelectorAll('button[aria-label^="Watch"]'),
        ).find(visible);
        const label = button?.getAttribute('aria-label');
        if (label && label !== before) return { state: 'changed', label };
        const error = Array.from(
          document.querySelectorAll('.flash-error'),
        ).find(visible);
        if (error?.textContent?.trim())
          return { state: 'refused', label, message: error.textContent.trim() };
        return null;
      },
      ariaBefore,
    );
    if (result.state === 'refused')
      throw new Error(
        `GITHUB_WATCH_REFUSED: ${result.message}; before=${ariaBefore}; after=${result.label}`,
      );
    ban = await detectGitHubBanSignals(s.page, s.capturedResponses);
    console.log(`PASS: watch control shows ${result.label}`);
  }
  console.log(`[ban-signal] ${ban?.signal}`);
} catch (e) {
  console.error('GITHUB_WATCH_FAILED:', e);
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
      const dir = runRecordingsDir('github_watch_repo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'github_watch_repo',
            repo_url: repoUrl,
            search_query: SEARCH_QUERY,
            watch_level: WATCH_LEVEL,
            watched_url: s.page.url(),
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
// Reached only when the watch itself succeeded: a ban signal that could not
// be recorded still fails the run, with its cause.
if (recordError)
  throw new Error(
    'GITHUB_BAN_RECORD_FAILED: the watch ran but its ban signal was not recorded',
    { cause: recordError },
  );
