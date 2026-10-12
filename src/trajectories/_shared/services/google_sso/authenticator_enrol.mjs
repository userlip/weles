// Enrolling a Google Authenticator for a signed-in Google account: reaching
// the authenticator setup page, reading the setup key Google shows behind
// "Can't scan it?", and confirming the first code computed from it.
//
// Page-level helpers only. They take the page and return what they saw; the
// account, the vault write and the run's result belong to the trajectory that
// calls them, so this module can be imported without any secret being read.
// Every step is one attempt: a page that does not show what the step needs is
// reported with what it showed instead, never clicked at again, and a browser
// error is the caller's to see.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { clickOffered, pageShows } from '../../page/judged/seen.mjs';
import { generateTotp } from './totp_secret.mjs';

/** The authenticator settings page, by its direct address. Every step reads
 * the page by its route, its fields and the vision model, in whatever
 * language the account uses; `hl=en` only keeps the refusal previews in one
 * language for whoever reads them. */
export const AUTHENTICATOR_SETUP_URL =
  'https://myaccount.google.com/two-step-verification/authenticator?hl=en';

/** Google's own route for the authenticator settings page. */
const AUTHENTICATOR_ROUTE = '/two-step-verification/authenticator';

export async function bodyText(page) {
  return await page.evaluate(() => document.body?.innerText || '');
}

/** A page's text for a refusal, whole, with any setup key redacted. */
function preview(text) {
  return redactKeys(text);
}

/** Clicks the control `description` names when the page offers it; false
 * when it does not. */
export async function clickByText(page, description, label) {
  const clicked = await clickOffered(page, description);
  if (clicked) console.log(`[google-authenticator-enrol] clicked ${label}`);
  return clicked;
}

/** Whether the page is a Google sign-in or challenge rather than the account. */
export function onSignIn(url) {
  return /accounts\.google\.com/.test(url);
}

/**
 * Reach the authenticator setup page for the signed-in account.
 * @returns {{ ok: true, url: string } | { ok: false, blocked: string, url: string, textPreview: string }}
 */
export async function openAuthenticatorSetup(page, wait) {
  await page.goto(AUTHENTICATOR_SETUP_URL, { waitUntil: 'domcontentloaded' });
  await wait();
  const url = page.url();
  if (onSignIn(url))
    return {
      ok: false,
      blocked: 'google_sign_in_required',
      url,
      textPreview: '',
    };
  if (new URL(url).pathname.includes(AUTHENTICATOR_ROUTE)) {
    return { ok: true, url };
  }
  const text = await bodyText(page);
  return {
    ok: false,
    blocked: 'authenticator_setup_page_not_reached',
    url,
    textPreview: preview(text),
  };
}

/**
 * Start the setup and reveal the setup key. Google shows the key as groups
 * of base32 letters behind "Can't scan it?"; the text is read from the page
 * and normalised to the bare base32 secret.
 * @returns {{ ok: true, secret: string } | { ok: false, blocked: string, textPreview: string }}
 */
export async function revealSetupKey(page, wait) {
  const textBefore = await bodyText(page);
  if (
    await pageShows(
      page,
      'Does the page ask to confirm removing or replacing an existing authenticator?',
    )
  ) {
    return {
      ok: false,
      blocked: 'authenticator_replacement_requires_consent',
      textPreview: preview(textBefore),
    };
  }
  // Enrolment may add a factor, but must not replace an existing authenticator
  // just because its seed is unavailable to Weles.
  const started = await clickByText(
    page,
    'a control that sets up or adds an authenticator app (not one that changes an existing one)',
    'set up authenticator',
  );
  if (!started) {
    return {
      ok: false,
      blocked: (await pageShows(
        page,
        'Does the page offer only changing an authenticator app that is already set up?',
      ))
        ? 'authenticator_replacement_requires_consent'
        : 'setup_action_not_found',
      textPreview: preview(textBefore),
    };
  }
  await wait();
  if (
    !(await clickByText(
      page,
      'the control that shows the setup key as text instead of a QR code',
      'show setup key',
    ))
  ) {
    return {
      ok: false,
      blocked: 'setup_key_reveal_not_found',
      textPreview: preview(await bodyText(page)),
    };
  }
  await wait();
  const text = await bodyText(page);
  const secret = extractSetupKey(text);
  if (!secret)
    return {
      ok: false,
      blocked: 'setup_key_not_shown',
      textPreview: preview(text),
    };
  return { ok: true, secret };
}

/** The base32 setup key in Google's grouped rendering, as one bare secret. */
export function extractSetupKey(text) {
  const match = String(text || '').match(
    /\b((?:[a-z2-7]{4}\s+){7}[a-z2-7]{4})\b/i,
  );
  if (!match) return '';
  return match[1].replace(/\s+/g, '').toUpperCase();
}

export function redactKeys(text) {
  return String(text || '').replace(
    /(?:[a-z2-7]{4}\s+){7}[a-z2-7]{4}/gi,
    '<redacted-setup-key>',
  );
}

/** The code for the current period. Google accepts the adjacent period as
 * RFC 6238 allows, so a code entered as its period ends is still taken and
 * no margin is chosen here. */
function freshCode(secret) {
  return generateTotp(secret);
}

/**
 * Enter the first code from `secret` and read whether Google accepted it.
 * @returns {{ ok: true, url: string } | { ok: false, blocked: string, textPreview: string }}
 */
export async function confirmSetupCode(page, wait, secret) {
  const input = page
    .locator(
      'input[type="tel"], input[type="text"], input[name="totpPin"], input[aria-label*="code" i]',
    )
    .filter({ visible: true })
    .first();
  // Whether the code field is on screen is decided by the field, never by the
  // page's prose. This page always explains that an authenticator app "gets
  // verification codes", so a text test for that phrase reported the field as
  // already shown, skipped the Next that reveals it, and refused with
  // `setup_code_input_not_found` while Google was still showing the setup key.
  if (!(await input.isVisible())) {
    if (
      !(await clickByText(
        page,
        'the Next button of the authenticator setup dialog',
        'next',
      ))
    ) {
      return {
        ok: false,
        blocked: 'setup_code_input_not_found',
        textPreview: preview(await bodyText(page)),
      };
    }
    await wait();
  }
  await input.waitFor({ state: 'visible' });
  const code = freshCode(secret);
  await humanFill(page, input, code);
  await input.press('Enter');
  await wait();
  const text = await bodyText(page);
  if (
    (await input.isVisible()) &&
    (await pageShows(
      page,
      'Does the setup dialog say the code is wrong or could not be verified?',
    ))
  ) {
    return {
      ok: false,
      blocked: 'setup_code_rejected',
      textPreview: preview(text),
    };
  }
  const url = new URL(page.url());
  if (
    url.hostname !== 'myaccount.google.com' ||
    !url.pathname.includes(AUTHENTICATOR_ROUTE) ||
    (await input.isVisible()) ||
    !(await pageShows(
      page,
      'Does the page show that an authenticator app is now set up for the account?',
    ))
  ) {
    return {
      ok: false,
      blocked: 'setup_confirmation_unobserved',
      textPreview: preview(text),
    };
  }
  return { ok: true, url: page.url() };
}
