// Create a Product Hunt account. Product Hunt offers no email and password
// signup, only OAuth; this signs up through an X account from Skarbiec that no
// Product Hunt account is linked to yet (findUsableTwitterAccount refuses by
// name when none is left): its cookies are put on X's domains, the OAuth and
// onboarding are walked (./register/onboarding.mjs), and the session counts as
// signed in once the auth probe reads it so. The account is recorded under the
// handle Product Hunt itself answers (extractPhHandle), with X's email and
// password, linked to that X account and bound to a character. One attempt:
// a repeat with the same X account, proxy and solver fails the same way and
// only adds signup volume. A refusal is thrown and sets the exit status.
import { WSession } from '../../../dist/session/wsession.js';
import { injectProviderCookies } from '../../../dist/platforms/_shared/cross_platform_oauth.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import {
  findUsableTwitterAccount,
  stampLinkedTwitter,
  extractPhHandle,
} from './_session.mjs';
import { assertAuthed } from '../_shared/auth/auth-probe.mjs';
import { findAccount } from '../_shared/skarbiec/accounts.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { completeProductHuntOnboarding } from './register/onboarding.mjs';

const HOME = 'https://www.producthunt.com/';

async function signup(s) {
  const twAccount = await findUsableTwitterAccount();
  const { username: twUsername, password: twPassword } = twAccount;
  const twEmail = twAccount.metadata.email;
  console.log(
    `[ph] using X account ${twUsername} (${twAccount.metadata.cookies.length} cookies)`,
  );
  // The Product Hunt account is recorded with X's email and password; without
  // them nothing is created, rather than an account recorded with invented ones.
  if (!twEmail || !twPassword)
    throw new Error(
      `PRODUCTHUNT_X_ACCOUNT_INCOMPLETE: X account ${twUsername} carries no ${twEmail ? 'password' : 'email'} in Skarbiec to record the Product Hunt account with; nothing was created`,
    );
  console.log(
    `[ph] injected ${await injectProviderCookies(s.ctx, 'twitter', twAccount.metadata.cookies, [])} X cookies`,
  );
  await completeProductHuntOnboarding(
    s,
    HOME,
    twAccount,
    twUsername,
    twPassword,
    twEmail,
  );

  await s.goto(HOME);
  await pageSettled(s.page);
  await assertAuthed('producthunt', s, {
    label: 'producthunt_register_post_oauth',
  });
  // Product Hunt's handle can differ from the X username.
  const phUsername = await extractPhHandle(s);
  if (phUsername !== twUsername)
    console.log(
      `[ph] Product Hunt handle "${phUsername}" differs from X "${twUsername}"`,
    );

  // An X account already linked to a Product Hunt user signs that same user in
  // again; it is recorded once, and never over a different X identity.
  const existing = findAccount('producthunt', phUsername);
  if (
    existing &&
    (existing.metadata.email !== twEmail ||
      existing.password !== twPassword ||
      (existing.metadata.linked_twitter_username &&
        existing.metadata.linked_twitter_username !== twUsername))
  )
    throw new Error(
      `PRODUCTHUNT_ACCOUNT_CONFLICT: ${phUsername} is already saved with a different X identity or credential; refusing to claim this account was recorded`,
    );
  if (existing)
    console.log(
      `[ph] Product Hunt account ${phUsername} is already recorded (${existing.id})`,
    );
  else
    console.log(
      `[ph] ${await s.saveAccount('producthunt', { username: phUsername, email: twEmail, password: twPassword })}`,
    );
  await stampLinkedTwitter(phUsername, twUsername);
  console.log(
    `[bind] ${JSON.stringify(await autoBindCharacter(phUsername, 'producthunt'))}`,
  );
  return phUsername;
}

const s = await WSession.start({
  label: 'producthunt_register',
  proxy: statedProxy('the Product Hunt signup'),
});
try {
  console.log(`PASS: ${await signup(s)}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
