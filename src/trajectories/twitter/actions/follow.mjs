// Follow an X account through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env: TARGET_USER (required; @ optional): the handle to follow.
//
// The follow and following controls are scoped to the handle through their
// accessible label, so a "Who to follow" suggestion beside the profile is
// never touched.
import { detectTwitterBanSignals } from '../../../../dist/platforms/twitter/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { X_ORIGIN } from './toggle.mjs';
import { takeOnce } from '../../_shared/page/controls/toggle.mjs';

const TARGET_HANDLE = statedText(
  ['TARGET_USER'],
  'the X account to follow',
  'TWITTER_FOLLOW_TARGET_REQUIRED',
).replace(/^@/, '');
if (!TARGET_HANDLE)
  throw new Error('TARGET_USER is "@" alone: it names no X account');

await runAction({
  platform: 'twitter',
  action: 'follow',
  resolveUserUrl: () => `${X_ORIGIN}/${encodeURIComponent(TARGET_HANDLE)}`,
  banDetector: detectTwitterBanSignals,
  act: async (s) => {
    const followed = await takeOnce(
      s.page,
      s.page
        .locator(`[data-testid$="-follow"][aria-label*="${TARGET_HANDLE}"]`)
        .first(),
      s.page
        .locator(`[data-testid$="-unfollow"][aria-label*="${TARGET_HANDLE}"]`)
        .first(),
      `follow for @${TARGET_HANDLE}`,
    );
    return followed
      ? `already following @${TARGET_HANDLE}`
      : `followed @${TARGET_HANDLE}`;
  },
});
