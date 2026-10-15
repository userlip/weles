// Follow one Instagram account through the shared action runner: the
// account's fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env: TARGET_USER (required; @ optional): the account to follow.
//
// Instagram's profile buttons carry no stable attribute, so the vision model
// reads whether the profile header already shows the account followed and
// finds its follow control; the follow counts once Instagram's own answer to
// friendships/create says the account is followed (or its request pending,
// for a private account).
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { responseAfterAction } from '../../_shared/page/settled.mjs';

const TARGET_USER = statedText(['TARGET_USER'], 'the Instagram account to follow', 'INSTAGRAM_FOLLOW_TARGET_REQUIRED').replace(
  /^@/,
  '',
);

await runAction({
  platform: 'instagram',
  action: 'follow',
  resolveUserUrl: () => `https://www.instagram.com/${encodeURIComponent(TARGET_USER)}/`,
  banDetector: detectInstagramBanSignals,
  act: async (s) => {
    if (await pageShows(s.page, `Does the profile header of @${TARGET_USER} show it is already followed (a Following or Requested button)?`))
      return `already following @${TARGET_USER}`;
    const answer = await responseAfterAction(
      s.page,
      (request) => request.method() === 'POST' && new URL(request.url()).pathname.includes('/friendships/create/'),
      () => clickDescribed(s.page, `the Follow button in the profile header of @${TARGET_USER} (not a suggested account)`),
    );
    if (!answer.ok()) throw new Error(`INSTAGRAM_FOLLOW_REFUSED: friendships/create answered HTTP ${answer.status()}`);
    const { friendship_status: status } = await answer.json();
    if (!status || !(status.following || status.outgoing_request))
      throw new Error(`INSTAGRAM_FOLLOW_NOT_TAKEN: friendships/create answered ${JSON.stringify(status)}`);
    return status.following ? `followed @${TARGET_USER}` : `follow request sent to @${TARGET_USER}`;
  },
});
