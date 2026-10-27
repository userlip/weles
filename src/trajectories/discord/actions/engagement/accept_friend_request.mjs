// Accept inbound Discord friend requests, through the shared Discord action
// runner (../../../_shared/discord/run.mjs): the account, its seat, the ban
// signal and the kept verdict are the runner's.
//
// Env: ACCEPT_LIMIT (required): how many pending requests are accepted; how
// many strangers the account befriends is the caller's to say.
//
// The Friends panel's Pending tab and each request's accept control are found
// by the vision model; a request counts once Discord's own answer to its
// relationship PUT is the empty success it gives, and each is kept in the
// account's metadata (friend_requests_accepted) as it is acknowledged. The
// run ends early when no incoming request is left.
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { readDiscordNoContent } from '../../../_shared/discord/response.mjs';
import { statedCount } from '../../../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';
import {
  pageSettled,
  responseAfterAction,
} from '../../../_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../../_shared/skarbiec/accounts.mjs';

const ACCEPT_LIMIT = statedCount(
  'ACCEPT_LIMIT',
  'how many pending friend requests are accepted',
  'DISCORD_ACCEPT_LIMIT_INVALID',
);
const RELATIONSHIP = /^\/api\/v\d+\/users\/@me\/relationships\/(?<id>\d+)$/;

await runDiscordAction({
  action: 'accept_friend_request',
  url: 'https://discord.com/channels/@me',
  run: { limit: ACCEPT_LIMIT },
  act: async (s, acct) => {
    await clickDescribed(s.page, 'the Pending tab of the Friends panel');
    await pageSettled(s.page);
    const accepted = [];
    while (accepted.length < ACCEPT_LIMIT) {
      if (
        !(await pageShows(
          s.page,
          'Does the Pending tab list an incoming friend request with an accept button?',
        ))
      )
        break;
      const answer = await responseAfterAction(
        s.page,
        (request) =>
          request.method() === 'PUT' &&
          RELATIONSHIP.test(new URL(request.url()).pathname),
        () =>
          clickDescribed(
            s.page,
            'the accept button of the first incoming friend request',
          ),
      );
      await readDiscordNoContent(
        answer,
        'accept_friend_request',
        'DISCORD_ACCEPT',
      );
      const entry = {
        target_id: new URL(answer.url()).pathname.match(RELATIONSHIP).groups.id,
        at: new Date().toISOString(),
      };
      accepted.push(entry);
      updateAccountMetadata(acct.id, (current) => ({
        ...current,
        friend_requests_accepted: [
          ...(Array.isArray(current.friend_requests_accepted)
            ? current.friend_requests_accepted
            : []),
          entry,
        ],
      }));
      console.log(`[accept_friend] accepted ${entry.target_id}`);
      await pageSettled(s.page);
    }
    return `${acct.username} accepted ${accepted.length} friend request(s) of the ${ACCEPT_LIMIT} allowed`;
  },
});
