/**
 * Reddit shadowban ground-truth check.
 *
 * The account's real handle is read from Reddit's own /api/me.json in a
 * session carrying the account's cookies (Reddit may assign a handle that
 * differs from the stored username). Then REDDIT_SHADOWBAN_VANTAGES
 * independent, logged-out fetches (required, the caller's choice) of
 * /user/<handle>/about.json from fresh proxy sessions are aggregated into
 * one verdict ('shadowbanned' | 'healthy' | 'indeterminate'), robust to one
 * exit's edge answer.
 *
 * A shadowbanned account is marked so in its Skarbiec record, which takes it
 * out of routine rotation. The per-vantage results and the verdict are kept
 * in the run's recordings. An indeterminate verdict fails the run by name,
 * so the caller sees no verdict was reached.
 *
 * Usage:
 *   ACCOUNT_ID=<id> node src/trajectories/reddit/shadowban_check.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { probeShadowban } from '../../../dist/platforms/reddit/shadowban_probe.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { statedCount } from '../_shared/inputs/stated.mjs';
import { updateAccountMetadata } from '../_shared/skarbiec/accounts.mjs';

const ME = /\/api\/me\.json/;

/** The handle Reddit reports for the account's own session. */
async function realHandle(acct) {
  const { proxyUrl, persona } = await resolveAccountSession(acct);
  const s = await WSession.start({
    label: 'reddit_shadowban_handle_lookup',
    proxy: proxyUrl,
    persona,
    targetHost: 'www.reddit.com',
  });
  try {
    const stored = Array.isArray(acct.metadata?.cookies) ? acct.metadata.cookies : [];
    const cookies = stored.filter((c) => c?.name && c.value && c.domain && c.path);
    if (cookies.length) await s.ctx.addCookies(cookies);
    await s.goto('https://www.reddit.com/api/me.json');
    const answer = s.capturedResponses.find((r) => ME.test(r.url));
    if (!answer?.body) throw new Error('REDDIT_HANDLE_UNREAD: Reddit returned no /api/me.json body for the account');
    const me = JSON.parse(answer.body);
    const handle = me?.data?.name;
    if (typeof handle !== 'string' || !handle)
      throw new Error(`REDDIT_HANDLE_UNREAD: /api/me.json names no account (${answer.body})`);
    return handle;
  } finally {
    await s.close();
  }
}

try {
  const acct = await getSocialAccount('reddit');
  if (!acct) throw new Error('REDDIT_ACCOUNT_UNAVAILABLE: Skarbiec holds no active reddit account');
  const vantages = statedCount('REDDIT_SHADOWBAN_VANTAGES', 'how many logged-out vantages probe the profile');
  const handle = await realHandle(acct);
  console.log(`[shadowban_check] probing handle=${handle} (stored=${acct.username})`);
  const result = await probeShadowban(handle, vantages);
  console.log(`[shadowban_check] verdict=${result.verdict}`);
  for (const vantage of result.vantages) console.log(`[shadowban_check]   ${JSON.stringify(vantage)}`);

  const dir = runRecordingsDir('reddit_shadowban_check');
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${acct.username}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    outPath,
    JSON.stringify({ account_id: acct.id, username: acct.username, real_handle: handle, ...result }, null, ' '),
  );
  console.log(`[shadowban_check] snapshot -> ${outPath}`);

  if (result.verdict === 'shadowbanned') {
    updateAccountMetadata(acct.id, { status: 'shadowbanned' });
    console.log('[shadowban_check] stored status=shadowbanned in Skarbiec');
  }
  if (result.verdict === 'indeterminate')
    throw new Error(`REDDIT_SHADOWBAN_INDETERMINATE: the vantages reached no verdict (snapshot ${outPath})`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
