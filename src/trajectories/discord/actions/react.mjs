import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectDiscordBanSignals } from '../../../../dist/platforms/discord/ban_signals.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

const channelPath = statedText(
  ['SERVER_CHANNEL_PATH'],
  'the Discord channel to react in, as <server id>/<channel id> (or @me/<dm id>)',
);
const acct = await getSocialAccount('discord');
if (!acct) {
  console.log('FAIL: no active discord account');
  process.exit(1);
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'discord_react',
  proxy: proxyUrl,
  persona,
});
const _stored = (acct.metadata?.cookies ?? []).filter((c) =>
  /discord\.com/.test(c.domain ?? ''),
);
// Without its stored session the run lands on the login wall and reports a
// failed reaction with no word of why, so a failed injection fails the run.
let unauthenticated = null;
if (_stored.length)
  await s.ctx
    .addCookies(_stored.map((c) => ({ ...c, path: c.path || '/' })))
    .catch((error) => {
      unauthenticated = `the stored discord cookies could not be injected: ${error}`;
    });
if (acct.metadata?.discord_token)
  await s.ctx
    .addInitScript(
      `localStorage.setItem("token",${JSON.stringify(JSON.stringify(acct.metadata.discord_token))})`,
    )
    .catch((error) => {
      const token = `the stored discord token could not be injected: ${error}`;
      unauthenticated = unauthenticated ? `${unauthenticated}; ${token}` : token;
    });
let ban = null;
try {
  if (unauthenticated) throw new Error(unauthenticated);
  await s.goto(`https://discord.com/channels/${channelPath}`);
  checkReachable(s, 'discord');
  // Wait for chat messages to render — each message <li id="chat-messages-{channelId}-{messageId}">.
  await s.page
    .locator('li[id^="chat-messages-"]')
    .first()
    .waitFor({ state: 'visible' });
  // Pick the most recent message — last in document order with non-empty content.
  const targetId = await s.page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('li[id^="chat-messages-"]'),
    ).reverse();
    for (const li of items) {
      const m = li.id.match(/^chat-messages-(\d+)-(\d+)$/);
      if (m) return { channelId: m[1], messageId: m[2] };
    }
    return null;
  });
  if (!targetId) throw new Error('no message id found in rendered chat');
  // PUT reaction via Discord's web API. localStorage.token carries the
  // Authorization header (matches every other web-client request); this is
  // exactly what the picker UI does once you click an emoji.
  const result = await s.page.evaluate(async ({ channelId, messageId }) => {
    const tk = (() => {
      try {
        return JSON.parse(localStorage.token);
      } catch {
        return null;
      }
    })();
    if (!tk) return { error: 'no_token_in_localstorage' };
    const emoji = encodeURIComponent('\u{1F44D}'); // 👍
    const r = await fetch(
      `/api/v9/channels/${channelId}/messages/${messageId}/reactions/${emoji}/%40me`,
      {
        method: 'PUT',
        headers: { Authorization: tk },
      },
    );
    return { status: r.status };
  }, targetId);
  if (result?.error) throw new Error(`react failed: ${result.error}`);
  if (result?.status !== 204 && result?.status !== 200)
    throw new Error(`react PUT returned ${result?.status}`);
  ban = await banSignalOf(detectDiscordBanSignals, s, 'after the reaction');
  console.log(
    `[ban-signal] ${ban?.signal}  PASS: reacted on message ${targetId.messageId}`,
  );
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectDiscordBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('discord_react');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'discord_react',
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
