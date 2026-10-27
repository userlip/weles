// Send a Snapchat friend request through the shared action runner: the
// account's session and proxy, the signed-in gate (signing in again through
// ./sign_in.mjs when the kept session is gone), the ban signal and the kept
// verdict are runAction's. The user is the caller's (TARGET_USERNAME). The
// web app's controls are found by the vision model; the request counts once
// the user's result shows it as sent.
import { humanType } from '../../../dist/human/keyboard.js';
import { detectSnapchatBanSignals } from '../../../dist/platforms/snapchat/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';
import { WEB_APP, reloginSnapchat } from './sign_in.mjs';

const TARGET = statedText(
  ['TARGET_USERNAME'],
  'the Snapchat user a real account sends a friend request to',
);

await runAction({
  platform: 'snapchat',
  action: 'add_friend',
  feedUrl: WEB_APP.href,
  banDetector: detectSnapchatBanSignals,
  inlineRelogin: reloginSnapchat,
  act: async (s) => {
    await clickDescribed(s.page, "the web app's search field");
    await humanType(s.page, TARGET);
    await clickDescribed(
      s.page,
      `the button that adds the Snapchat user ${TARGET} as a friend, in that user's search result`,
    );
    if (
      !(await pageShows(
        s.page,
        `Does the search result for ${TARGET} show the friend request as sent or the user as added?`,
      ))
    )
      throw new Error(
        `SNAPCHAT_FRIEND_REQUEST_UNCONFIRMED: the result for ${TARGET} does not show the request as sent`,
      );
    return `friend request sent to ${TARGET}`;
  },
});
