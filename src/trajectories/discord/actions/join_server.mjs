// Join a Discord server through an invite, through the shared Discord action
// runner (../../_shared/discord/run.mjs): the account, its seat, the ban
// signal and the kept verdict are the runner's.
//
// Env: INVITE_URL (required): an https discord.gg/<code> or
// discord.com/invite/<code> address, without credentials or a port.
//
// The invite's accept control and any rules screen after it are found by the
// vision model, and the join counts when Discord lands in a channel of the
// server.
import { runDiscordAction } from '../../_shared/discord/run.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
} from '../../_shared/page/judged/seen.mjs';

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

await runDiscordAction({
  action: 'join_server',
  url: INVITE_URL,
  run: { invite_url: INVITE_URL },
  act: async (s) => {
    await clickDescribed(
      s.page,
      'the button that accepts the invite and joins',
    );
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
    return `joined through ${INVITE_URL}`;
  },
});
