// Upvote a Product Hunt launch, through the shared action runner: the
// account's fresh jar (or the sign-in through X when it is stale), the
// signed-in gate on the requested page, the verdict and its record are the
// runner's.
//
// Env: PRODUCTHUNT_URL (required): the launch page to upvote; nothing is
// upvoted by default.
//
// A launch page carries the inline vote button (data-test="vote-button")
// that records a vote; a product hub (/products/<slug>) carries only a button
// that navigates away, so a launch that redirected to its hub is refused. The
// vote counts once the button's own state (aria-pressed, or its count)
// changes after the click.
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { detectProductHuntBanSignals } from '../../../dist/platforms/producthunt/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { loginViaTwitter } from './_session.mjs';

const TARGET_URL = statedText(
  ['PRODUCTHUNT_URL'],
  'the Product Hunt launch page to upvote',
);
const onHub = (address) => new URL(address).pathname.startsWith('/products/');

/** The vote button's own state: pressed, and the count it shows. */
const voteState = async (button) => ({
  pressed: await button.getAttribute('aria-pressed'),
  count: (await button.innerText()).match(/\d+/)?.shift(),
});

await runAction({
  platform: 'producthunt',
  action: 'upvote',
  feedUrl: TARGET_URL,
  banDetector: detectProductHuntBanSignals,
  inlineRelogin: async (s, acct) => {
    await loginViaTwitter(s, acct);
    return { ok: true };
  },
  act: async (s) => {
    if (onHub(s.page.url()) && !onHub(TARGET_URL))
      throw new Error(
        `PRODUCTHUNT_LAUNCH_UNAVAILABLE: ${TARGET_URL} redirected to the product hub ${s.page.url()}, which records no launch vote`,
      );
    if (
      await clickOffered(
        s.page,
        'the button that accepts or closes the cookie notice',
      )
    )
      await pageSettled(s.page);
    const button = s.page
      .locator('button[data-test="vote-button"]')
      .filter({ visible: true })
      .first();
    if (!(await button.count()))
      throw new Error(
        `PRODUCTHUNT_VOTE_BUTTON_MISSING: ${s.page.url()} shows no launch vote button`,
      );
    const before = await voteState(button);
    await button.scrollIntoViewIfNeeded();
    await humanClickLocator(s.page, button);
    await pageSettled(s.page);
    const after = await voteState(button);
    if (before.pressed === after.pressed && before.count === after.count)
      throw new Error(
        `PRODUCTHUNT_VOTE_UNCHANGED: the vote button reads ${JSON.stringify(after)} after the click, as before`,
      );
    return `upvoted ${TARGET_URL}`;
  },
});
