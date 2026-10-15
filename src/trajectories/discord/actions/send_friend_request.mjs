// Send a Discord friend request, through the shared Discord action runner
// (../../_shared/discord/run.mjs): the account, its seat, the ban signal and
// the kept verdict are the runner's.
//
// Env: DISCORD_TARGET_HANDLE (required): the username of the account to
// friend (Discord's global names carry no #discriminator for most accounts).
//
// The Friends panel's add tab and its username field are found by the vision
// model; the request counts once Discord's own answer to the relationship
// request succeeds. Each request and its outcome are kept in the account's
// metadata (friend_requests_sent).
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { runDiscordAction } from '../../_shared/discord/run.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, fillDescribed } from '../../_shared/page/judged/seen.mjs';
import { responseAfterAction } from '../../_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';

const TARGET = statedText(['DISCORD_TARGET_HANDLE'], 'the username of the Discord account to send a friend request to');

await runDiscordAction({
  action: 'send_friend_request',
  url: 'https://discord.com/channels/@me',
  run: { target: TARGET },
  act: async (s, acct) => {
    await clickDescribed(s.page, 'the tab of the Friends panel that adds a friend');
    await fillDescribed(s.page, 'the field that takes the username to add as a friend', TARGET);
    const typed = await s.page.evaluate(() => document.activeElement.value);
    if (typed !== TARGET) throw new Error(`DISCORD_FRIEND_TARGET_MISMATCH: the add-friend field holds ${JSON.stringify(typed)}`);
    const send = s.page.locator('form:has(input:focus) button[type="submit"]').first();
    if (!(await send.count()) || !(await send.isEnabled()))
      throw new Error('DISCORD_FRIEND_REQUEST_NOT_ENABLED: the add-friend form shows no enabled send control after the handle');
    const answer = await responseAfterAction(
      s.page,
      (request) => request.method() === 'POST' && /\/users\/@me\/relationships$/.test(new URL(request.url()).pathname),
      () => humanClickLocator(s.page, send),
    );
    const outcome = answer.ok() ? 'sent' : `refused with HTTP ${answer.status()}: ${await answer.text()}`;
    const sent = Array.isArray(acct.metadata.friend_requests_sent) ? acct.metadata.friend_requests_sent : [];
    updateAccountMetadata(acct.id, {
      friend_requests_sent: [...sent, { target: TARGET, at: new Date().toISOString(), success: answer.ok(), outcome }],
    });
    if (!answer.ok()) throw new Error(`DISCORD_FRIEND_REQUEST_REFUSED: ${outcome}`);
    return `${acct.username} sent a friend request to ${TARGET}`;
  },
});
