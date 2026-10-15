// React to a Discord message with an emoji, as the active Discord account.
//
// Env (all required; nothing is reacted to by default):
//   SERVER_CHANNEL_PATH   the channel, as <server id>/<channel id> (or @me/<dm id>)
//   DISCORD_MESSAGE_ID    the message reacted to
//   DISCORD_REACTION      the emoji, as Discord takes it in a reaction (a
//                         Unicode emoji, or name:id for a custom one)
//
// The account signs in with its stored cookies and its web token; a jar or
// token that cannot be set up fails the run. The reaction is the PUT the
// web client sends when an emoji is picked, authorised by the token the
// page holds, and counts only when Discord answers it with success. The
// verdict is read through the shared ban-signal reader and kept through the
// shared verdict writer.
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectDiscordBanSignals } from '../../../../dist/platforms/discord/ban_signals.js';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { keepVerdict } from '../../_shared/action/verdict.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { seatDiscordAccount } from '../../_shared/discord/session.mjs';

const LABEL = 'discord_react';
const channelPath = statedText(
  ['SERVER_CHANNEL_PATH'],
  'the Discord channel to react in, as <server id>/<channel id> (or @me/<dm id>)',
);
const MESSAGE_ID = statedText(
  ['DISCORD_MESSAGE_ID'],
  'the Discord message to react to',
);
const REACTION = statedText(
  ['DISCORD_REACTION'],
  'the emoji the reaction carries (a Unicode emoji, or name:id for a custom one)',
);
const [, channelId] = channelPath.split('/');
if (!channelId)
  throw new Error(
    `SERVER_CHANNEL_PATH "${channelPath}" names no channel after its server`,
  );

const acct = await getSocialAccount('discord');
if (!acct) throw new Error('no active discord account to react with');
const run = { channel: channelPath, message_id: MESSAGE_ID, reaction: REACTION };
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: LABEL,
  proxy: proxyUrl,
  persona,
});
try {
  await seatDiscordAccount(s, acct);
  await s.goto(`https://discord.com/channels/${channelPath}`);
  checkReachable(s, 'discord');
  const result = await s.page.evaluate(
    async ({ channel, message, emoji }) => {
      const stored = localStorage.token;
      if (!stored) return { error: 'the page holds no Discord token' };
      const answer = await fetch(
        `/api/v9/channels/${channel}/messages/${message}/reactions/${encodeURIComponent(emoji)}/%40me`,
        { method: 'PUT', headers: { Authorization: JSON.parse(stored) } },
      );
      return { ok: answer.ok, status: answer.status, body: await answer.text() };
    },
    { channel: channelId, message: MESSAGE_ID, emoji: REACTION },
  );
  if (result.error)
    throw new Error(`DISCORD_REACT_UNAUTHORISED: ${result.error}`);
  if (!result.ok)
    throw new Error(
      `DISCORD_REACT_REFUSED: Discord answered the reaction ${result.status}: ${result.body}`,
    );
  const banSignal = await banSignalOf(detectDiscordBanSignals, s, 'after the reaction');
  if (!banSignal.healthy)
    throw Object.assign(
      new Error(`the page reads ${banSignal.signal} after the reaction`),
      { banSignal },
    );
  await keepVerdict(LABEL, acct, banSignal, run);
  console.log(`[ban-signal] ${banSignal.signal}  PASS: reacted ${REACTION} on message ${MESSAGE_ID}`);
} catch (e) {
  const banSignal = e.banSignal
    ? e.banSignal
    : await banSignalOf(detectDiscordBanSignals, s, 'after the failure');
  console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${e.message}`);
  try {
    await keepVerdict(LABEL, acct, banSignal, run);
  } catch (writeError) {
    throw new AggregateError(
      [e, writeError],
      `${e.message}; and its ban signal was not kept: ${writeError.message}`,
    );
  }
  throw e;
} finally {
  await s.close();
}
