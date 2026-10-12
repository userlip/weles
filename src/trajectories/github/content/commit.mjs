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
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

// The repository, file, message and text are the caller's: a commit lands in
// a real repository's history under the account's name, so none is written
// here.
const REPO_URL = statedText(
  ['REPO_URL'],
  'the GitHub repository (URL or owner/name) the commit goes to',
);
const FILE_PATH = statedText(
  ['FILE_PATH'],
  'the repository file the commit appends to',
);
const COMMIT_MESSAGE = statedText(
  ['COMMIT_MESSAGE'],
  'the commit message the repository history records',
);
// Kept exactly as given: its leading and trailing newlines are part of it.
const FILE_APPEND = process.env.FILE_APPEND;
if (!FILE_APPEND?.trim())
  throw new Error(
    'FILE_APPEND is not set: the text the commit appends to the file; nothing is assumed',
  );

function normalize(raw) {
  if (!raw) return '';
  if (raw.startsWith('http')) return raw.replace(/\/$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) return `https://github.com/${raw}`;
  return '';
}
const repoBase = normalize(REPO_URL);
if (!repoBase) {
  console.log('FAIL: REPO_URL required for commit');
  process.exit(1);
}

const acct = await getSocialAccount('github');
if (!acct) {
  console.log('FAIL: no active github account');
  process.exit(1);
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'github_commit',
  proxy: proxyUrl,
  persona,
});
let ban = null;
try {
  const cookies = (acct.metadata?.cookies ?? []).filter((c) =>
    (c.domain ?? '').includes('github.com'),
  );
  if (cookies.length) await s.ctx.addCookies(cookies);
  await s.goto(`${repoBase}/edit/main/${FILE_PATH}`);
  checkReachable(s, 'github');
  await pageSettled(s.page);
  const loggedOut = await s.page.evaluate(
    () => !!document.querySelector('a[href="/login"]'),
  );
  if (loggedOut) throw new Error('not_logged_in: cookies stale');
  const is404 = await s.page.evaluate(() =>
    /page not found/i.test(document.body.innerText || ''),
  );
  if (is404) throw new Error(`repo_or_file_404: url=${s.page.url?.() ?? ''}`);

  // Programmatic CodeMirror append: click the editor, send End+Enter via
  // keyboard, type the line. Direct DOM manipulation on CodeMirror would
  // bypass GitHub's diff-tracking, so we stay with keyboard events. An append
  // that fails stops here with its cause: swallowed, it surfaced later only as
  // commit_not_applied, with nothing saying the file was never changed.
  await humanClickLocator(
    s.page,
    s.page
      .locator(
        '.CodeMirror, [data-codemirror], textarea[name="value"], div[contenteditable="true"]',
      )
      .first(),
  );
  await s.page.keyboard.press('End');
  await s.page.keyboard.press('Enter');
  await humanType(s.page, FILE_APPEND.trim());
  await pageSettled(s.page);

  // Open the Commit-changes modal: toolbar button text is "Commit changes...".
  // GitHub's React editor renders it as <button> with primary styling.
  const openCommit = s.page
    .locator('button:has-text("Commit changes")')
    .filter({ visible: true })
    .first();
  await openCommit.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, openCommit);
  await pageSettled(s.page);
  // Modal commit message textarea — id="commit-message-input" / aria-label="Commit message".
  const msgIn = s.page
    .locator(
      'textarea[id="commit-message-input"], textarea[aria-label*="ommit message"], dialog textarea[name="commit_message"]',
    )
    .filter({ visible: true })
    .first();
  if (await msgIn.count()) {
    await humanClickLocator(s.page, msgIn);
    await s.page.keyboard.press('ControlOrMeta+A');
    await s.page.keyboard.press('Delete');
    await humanType(s.page, COMMIT_MESSAGE);
    // A commit made with GitHub's default message is not the change asked for.
    const held = await msgIn.inputValue();
    if (held !== COMMIT_MESSAGE)
      throw new Error(
        `commit message field holds ${JSON.stringify(held)}, not the message typed`,
      );
  }
  await pageSettled(s.page);
  // Modal confirm button — second "Commit changes" inside dialog/Box--overlay.
  const confirmCommit = s.page
    .locator(
      'dialog button:has-text("Commit changes"), [role="dialog"] button:has-text("Commit changes"), .Box--overlay button:has-text("Commit changes")',
    )
    .filter({ visible: true })
    .first();
  await confirmCommit.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, confirmCommit);

  await submitAnswered(
    s.page,
    /\/edit\//,
    s.page
      .locator('.flash-error, [role="alert"]')
      .filter({ hasText: /\S/ })
      .first(),
  );
  const finalUrl = s.page.url?.() ?? '';
  if (/\/edit\//.test(finalUrl))
    throw new Error(`commit_not_applied: still at ${finalUrl}`);
  ban = await banSignalOf(detectGitHubBanSignals, s, 'after the commit');
  console.log(
    `[ban-signal] ${ban?.signal}  PASS: committed to ${repoBase}/${FILE_PATH}`,
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
      const dir = runRecordingsDir('github_commit');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'github_commit',
            repo_url: repoBase,
            file_path: FILE_PATH,
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
