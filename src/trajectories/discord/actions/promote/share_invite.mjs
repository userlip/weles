// Create a Discord invite for a channel and share it, through the shared
// Discord action runner (../../../_shared/discord/run.mjs): the account, its
// seat, the ban signal and the kept verdict are the runner's.
//
// Env: SERVER_CHANNEL_PATH (required; '<guild_id>/<channel_id>') the channel
// invited to; TARGET_HANDLES (optional) comma-separated usernames the invite
// is sent to by direct message (../../../_shared/discord/direct.mjs).
//
// The channel's invite control is found by the vision model; the invite is
// the one Discord's own answer to the invite request names. A direct message
// that fails fails the run after every target was tried. Each invite and the
// messages that carried it are kept in the account's metadata (invites_sent).
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { sendDirectMessage } from '../../../_shared/discord/direct.mjs';
import { readDiscordReply } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { pageSettled, responseAfterAction } from '../../../_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../../_shared/skarbiec/accounts.mjs';

const CHANNEL = statedText(['SERVER_CHANNEL_PATH'], "the channel the invite is for, as '<guild_id>/<channel_id>'");
const TARGETS = process.env.TARGET_HANDLES
  ? process.env.TARGET_HANDLES.split(',')
      .map((handle) => handle.trim())
      .filter(Boolean)
  : [];
const channel = /^(?<guild>\d+)\/(?<id>\d+)$/.exec(CHANNEL);
if (!channel) throw new Error(`DISCORD_INVITE_CHANNEL_INVALID: SERVER_CHANNEL_PATH must be guild_id/channel_id, not ${JSON.stringify(CHANNEL)}`);
const invites = new RegExp(`^/api/v\\d+/channels/${channel.groups.id}/invites$`);

await runDiscordAction({
  action: 'share_invite',
  url: `https://discord.com/channels/${CHANNEL}`,
  run: { channel: CHANNEL, targets: TARGETS },
  act: async (s, acct) => {
    const answer = await responseAfterAction(
      s.page,
      (request) => request.method() === 'POST' && invites.test(new URL(request.url()).pathname),
      () => clickDescribed(s.page, 'the button that invites people to this channel'),
    );
    const invite = await readDiscordReply(answer, 'create_invite', 'DISCORD_INVITE');
    const url = `https://discord.gg/${invite.code}`;
    console.log(`[share_invite] created ${url}`);
    const sent = [];
    const failures = [];
    for (const target of TARGETS) {
      await s.goto('https://discord.com/channels/@me');
      await pageSettled(s.page);
      await sendDirectMessage(s, target, url).then(
        (message) => sent.push({ target, message, at: new Date().toISOString() }),
        (error) => failures.push(error),
      );
    }
    const kept = Array.isArray(acct.metadata.invites_sent) ? acct.metadata.invites_sent : [];
    updateAccountMetadata(acct.id, { invites_sent: [...kept, { channel: CHANNEL, url, at: new Date().toISOString(), dm_targets: sent }] });
    if (failures.length) throw new AggregateError(failures, `the invite ${url} reached ${sent.length} of ${TARGETS.length} targets: ${failures.map((e) => e.message).join('; ')}`);
    return `${acct.username} created ${url} and sent it to ${sent.length} target(s)`;
  },
});
