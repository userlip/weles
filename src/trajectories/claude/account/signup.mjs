// Creating a Claude account on a fresh identity: the address is on an inbound
// domain Weles reads, so the sign-in code claude.ai mails is read from it,
// and the onboarding pages that follow are answered from the identity.

import { humanFill } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { emailCodeSignIn } from '../../_shared/subscription-auth/email_code.mjs';
import { failOnPage } from './page_steps.mjs';

/** claude.ai's own sign-in page; a new address is an account created. */
const LOGIN_PAGE = new URL('/login', 'https://claude.ai');

/** Where the app lands once onboarding is over. */
const APP_ROUTES = ['/new', '/chat', '/recents'];

/** A name field onboarding asks to be filled. */
const NAME_FIELD =
  'input[name*="name" i],input[placeholder*="name" i],input[autocomplete="name"],input[autocomplete="given-name"]';

async function fillName(page, identity) {
  const field = page.locator(NAME_FIELD).filter({ visible: true }).first();
  if (!(await field.count())) return false;
  if (await field.inputValue()) return false;
  await humanFill(page, field, `${identity.firstName} ${identity.lastName}`);
  return true;
}

// The confirmations onboarding requires - age and terms - are ticked one at a
// time while the model still sees one unticked; an optional box such as a
// newsletter opt-in is left as it is.
async function tickConsents(page) {
  let ticked = false;
  while (
    await pageShows(
      page,
      'Is there an unticked checkbox that confirms the age requirement or accepts the terms or policies (not a newsletter or marketing opt-in)?',
    )
  ) {
    await clickDescribed(
      page,
      'the unticked checkbox that confirms the age requirement or accepts the terms or policies',
    );
    ticked = true;
  }
  return ticked;
}

// The control onboarding moves on with, when the page offers one.
async function advance(page) {
  if (
    !(await pageShows(
      page,
      'Does the page offer a button that moves the onboarding forward?',
    ))
  )
    return false;
  await clickDescribed(page, 'the button that moves the onboarding forward');
  return true;
}

/**
 * Sign the identity up and walk onboarding until the app shows. Each page is
 * answered from what it shows; a page that asks for nothing this walk can
 * give (a phone number, an unknown question) fails with its DOM.
 */
export async function signUp(session, identity, mark) {
  const page = session.page;
  await session.goto(LOGIN_PAGE.href);
  await pageSettled(page);
  await emailCodeSignIn(
    session,
    { email: identity.email, loginMethod: 'email_code' },
    'anthropic',
    mark,
  );
  mark('onboarding');
  for (;;) {
    await pageSettled(page);
    const { pathname } = new URL(page.url());
    if (APP_ROUTES.some((route) => pathname.startsWith(route))) {
      mark('account_created');
      return;
    }
    // A phone number is asked for in a telephone field.
    if (
      await page.locator('input[type="tel"]').filter({ visible: true }).count()
    )
      await failOnPage(
        page,
        'phone_verification_required',
        'onboarding',
        'claude.ai asks the new account for a phone number, which this sign-up does not supply',
      );
    const named = await fillName(page, identity);
    const ticked = await tickConsents(page);
    const advanced = await advance(page);
    if (!named && !ticked && !advanced)
      await failOnPage(
        page,
        'onboarding_page_unrecognized',
        'onboarding',
        'claude.ai showed an onboarding page with no name to fill, no confirmation to tick and no control to continue with',
      );
  }
}
