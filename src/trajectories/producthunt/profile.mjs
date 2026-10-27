// Fill the Product Hunt profile (headline, about, location, website) at
// /my/details/edit, through the shared action runner: the account's fresh jar
// (or the sign-in through X when it is stale), the signed-in gate, the
// verdict and its record are the runner's.
//
// Env: PH_HEADLINE, PH_BIO and PH_LOCATION (required), PH_WEBSITE (optional):
// the profile is the account's public face, so its text is the caller's.
//
// Each field and the save control are found by the vision model; each value
// is checked in its field as typed, and the saved profile is read back from
// a reloaded form: a value it does not hold fails the run.
import { detectProductHuntBanSignals } from '../../../dist/platforms/producthunt/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed, fillDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { loginViaTwitter } from './_session.mjs';

const VALUES = {
  headline: statedText(['PH_HEADLINE'], 'the profile headline'),
  about: statedText(['PH_BIO'], 'the profile about text'),
  location: statedText(['PH_LOCATION'], 'the profile location'),
  ...(process.env.PH_WEBSITE ? { website: process.env.PH_WEBSITE } : {}),
};

/** Whether some field of the form holds exactly `value`. */
const formHolds = (page, value) =>
  page.evaluate(
    (wanted) =>
      [...document.querySelectorAll('input, textarea')].some(
        (field) => field.value === wanted,
      ),
    value,
  );

await runAction({
  platform: 'producthunt',
  action: 'profile',
  feedUrl: 'https://www.producthunt.com/my/details/edit',
  banDetector: detectProductHuntBanSignals,
  inlineRelogin: async (s, acct) => {
    await loginViaTwitter(s, acct);
    return { ok: true };
  },
  act: async (s, { acct }) => {
    for (const [field, value] of Object.entries(VALUES)) {
      await fillDescribed(s.page, `the profile's ${field} field`, value);
      if ((await s.page.evaluate(() => document.activeElement.value)) !== value)
        throw new Error(
          `PRODUCTHUNT_PROFILE_FIELD_MISMATCH: the ${field} field does not hold the stated value as typed`,
        );
    }
    await clickDescribed(s.page, 'the button that saves the profile');
    await pageSettled(s.page);
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
    for (const [field, value] of Object.entries(VALUES))
      if (!(await formHolds(s.page, value)))
        throw new Error(
          `PRODUCTHUNT_PROFILE_NOT_SAVED: the saved profile does not hold the stated ${field}`,
        );
    return `${acct.username} profile saved`;
  },
});
