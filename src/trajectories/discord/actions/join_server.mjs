// Join a Discord server through an invite, as the active Discord account.
//
// Env: INVITE_URL (required): an https discord.gg/<code> or
// discord.com/invite/<code> address, without credentials or a port.
//
// The account is seated with its stored cookies and web token
// (../../_shared/discord/session.mjs). The invite's accept control and any
// rules screen after it are found by the vision model, and the join counts
// when Discord lands in a channel of the server. The verdict is read through
// the shared ban-signal reader and kept through the shared verdict writer.
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectDiscordBanSignals } from '../../../../dist/platforms/discord/ban_signals.js';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { keepVerdict } from '../../_shared/action/verdict.mjs';
import { seatDiscordAccount } from '../../_shared/discord/session.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
} from '../../_shared/page/judged/seen.mjs';

const LABEL = 'discord_join_server';
const INVITE_URL = statedText(
  ['INVITE_URL'],
  'the Discord invite to join through (https://discord.gg/<code>)',
);
const invite = new URL(INVITE_URL);
const inviteCode =
  invite.hostname === 'discord.gg'
    ? /^\/[\w-]+\/?$/.test(invite.pathname)
    : invite.hostname === 'discord.com' &&
      /^\/invite\/[\w-]+\/?$/.test(invite.pathname);
if (
  invite.protocol !== 'https:' ||
  invite.port ||
  invite.username ||
  invite.password ||
  !inviteCode
)
  throw new Error(
    `DISCORD_INVITE_URL_INVALID: ${INVITE_URL} is not an https discord.gg/<code> or discord.com/invite/<code> address without credentials or a port`,
  );

const acct = await getSocialAccount('discord');
if (!acct) throw new Error('no active discord account to join with');
const run = { invite_url: INVITE_URL };
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: LABEL,
  proxy: proxyUrl,
  persona,
});
try {
  await seatDiscordAccount(s, acct);
  await s.goto(INVITE_URL);
  checkReachable(s, 'discord');
  await clickDescribed(s.page, 'the button that accepts the invite and joins');
  // The click lands in the joined channel, or shows a rules screen first.
  if (
    await clickOffered(
      s.page,
      'the button that submits or completes the server rules screen',
    )
  )
    await pageSettled(s.page);
  if (!/^\/channels\/\d+/.test(new URL(s.page.url()).pathname))
    throw new Error(
      `DISCORD_JOIN_UNCONFIRMED: Discord did not land in a channel of the server; it is at ${s.page.url()}`,
    );
  const banSignal = await banSignalOf(detectDiscordBanSignals, s, 'after joining');
  if (!banSignal.healthy)
    throw Object.assign(
      new Error(`the page reads ${banSignal.signal} after joining`),
      { banSignal },
    );
  await keepVerdict(LABEL, acct, banSignal, run);
  console.log(`[ban-signal] ${banSignal.signal}  PASS: joined`);
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
