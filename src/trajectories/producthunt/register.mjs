import { WSession } from '../../../dist/session/wsession.js';
import { injectProviderCookies } from '../../../dist/platforms/_shared/cross_platform_oauth.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import {
  findUsableTwitterAccount,
  stampLinkedTwitter,
  extractPhHandle,
} from './_session.mjs';
import { assertAuthed, AuthProbeError } from '../_shared/auth/auth-probe.mjs';
import { findAccount } from '../_shared/skarbiec/accounts.mjs';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { completeProductHuntOnboarding } from './register/onboarding.mjs';

// ProductHunt does not offer email/password signup — only OAuth via Twitter,
// Google, Facebook, AngelList. This trajectory uses an existing Twitter account
// from the Twitter account pool in Skarbiec (inject cookies → OAuth through → onboard).

const URL = 'https://www.producthunt.com/';
const proxy = statedProxy('the Product Hunt signup');

// findUsableTwitterAccount + stampLinkedTwitter live in _session.mjs.

async function signup(s) {
  const twAccount = await findUsableTwitterAccount();
  if (!twAccount) throw new Error('no_twitter_account_in_db');
  const twCookies = twAccount.metadata?.cookies ?? [];
  const twUsername = twAccount.username;
  const twPassword = twAccount.password;
  const twEmail = twAccount.metadata?.email;
  const twStatus =
    twAccount.metadata?.status === undefined
      ? 'not recorded'
      : twAccount.metadata.status;
  console.log(
    `[ph] using twitter account: ${twUsername} status=${twStatus} (${twCookies.length} cookies)`,
  );
  // Product Hunt is signed into through X, so the account is recorded with
  // X's email and password. Without them no Product Hunt account is created:
  // one created first would be recorded with an invented address and
  // password, or not at all.
  if (!twEmail || !twPassword)
    throw new Error(
      `twitter_account_incomplete: X account ${twUsername} carries no ${twEmail ? 'password' : 'email'} in Skarbiec to record the Product Hunt account with; nothing was created`,
    );
  if (!twCookies.length) throw new Error('twitter_account_missing_cookies');

  const injected = await injectProviderCookies(s.ctx, 'twitter', twCookies);
  console.log(
    `[ph] injected ${injected} twitter cookies (x.com + twitter.com)`,
  );

  await completeProductHuntOnboarding(
    s,
    URL,
    twAccount,
    twUsername,
    twPassword,
    twEmail,
  );

  const cookies = await s.ctx.cookies();
  const phAuth = cookies.filter(
    (c) =>
      c.domain?.includes('producthunt.com') &&
      (c.name === '_producthunt_session' ||
        c.name === '_ph' ||
        c.name.includes('session') ||
        c.name.includes('auth')),
  );
  if (!phAuth.length) {
    console.log(
      `[ph] no producthunt auth cookies. all: ${cookies
        .filter((c) => c.domain?.includes('producthunt.com'))
        .map((c) => c.name)
        .join(', ')}`,
    );
    throw new Error('no_producthunt_auth_cookies');
  }
  console.log(`[ph] auth cookies: ${phAuth.map((c) => c.name).join(', ')}`);

  // The phAuth check above is too permissive — _producthunt_session_production
  // is set for logged-out visitors too and matches `name.includes('session')`,
  // so its presence does NOT prove authentication. Run a real auth probe.
  try {
    await s.goto(URL);
    await pageSettled(s.page);
    await assertAuthed('producthunt', s, {
      label: 'producthunt_register_post_oauth',
    });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) {
      throw new Error(`oauth_did_not_authenticate: ${probeErr.message}`);
    }
    throw probeErr;
  }

  // Extract the actual PH handle from the topbar user-image-link.
  // Product Hunt's handle can differ from the SSO provider's username.
  // Persist the handle shown by Product Hunt for subsequent profile URLs.
  //
  // Logic moved to _session.mjs#extractPhHandle: bounces between
  // homepage and /my/notifications because PH's homepage often serves
  // the SSR logged-out shell right after OAuth.
  const phUsername = await extractPhHandle(s);
  if (!phUsername)
    throw new Error(
      `ph_handle_unreadable: Product Hunt shows no handle for the account signed in through X ${twUsername}; the account was not recorded under a guessed name`,
    );
  if (phUsername !== twUsername)
    console.log(
      `[ph] platform_handle="${phUsername}" differs from twitter_username="${twUsername}" — using platform_handle`,
    );

  // Idempotency guard: if a PH row already exists with this username
  // (because the Twitter SSO source was already linked previously), skip
  // saveAccount so we don't write a duplicate row. PH's OAuth flow always
  // re-authenticates the same PH user when the Twitter account already
  // has a linked PH identity, so a re-run of register.mjs against the same
  // Twitter would otherwise produce N rows pointing at the same PH user.
  const existing = findAccount('producthunt', phUsername);
  if (
    existing &&
    (existing.metadata?.email !== twEmail ||
      existing.password !== twPassword ||
      (existing.metadata?.linked_twitter_username &&
        existing.metadata.linked_twitter_username !== twUsername))
  )
    throw new Error(
      `producthunt_account_conflict: ${phUsername} is already saved with a different X identity or credential; refusing to claim this account was recorded`,
    );
  if (existing) {
    console.log(
      `[ph] active PH account already exists for username="${phUsername}" id=${existing.id} — skipping saveAccount`,
    );
  } else {
    const result = await s.saveAccount('producthunt', {
      username: phUsername,
      email: twEmail,
      password: twPassword,
    });
    console.log(`[ph] ${result}`);
  }
  // A recovered partial save needs the same link and binding as a new row.
  await stampLinkedTwitter(phUsername, twUsername);
  console.log(
    `[bind] ${JSON.stringify(await autoBindCharacter(phUsername, 'producthunt'))}`,
  );
  return phUsername;
}

// Single attempt — the prior MAX_RETRIES=5 loop ran the same deterministic
// signup with the same Twitter SSO account, same proxy, and same captcha
// solver on every iteration; if attempt 1 fails (twitter cookies expired,
// captcha unsolvable, account purged) attempts 2-5 fail identically and
// just generate 5x the bot-signal volume against PH's signup endpoint.
// On failure, the worker queues a fresh row on next routine tick.
// The signup interaction uses the browser's configured input path.
const s = await WSession.start({ label: 'producthunt_register', proxy });
try {
  const username = await signup(s);
  console.log(`PASS: ${username}`);
  await s.close();
  process.exit(0);
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
  process.exit(1);
}
