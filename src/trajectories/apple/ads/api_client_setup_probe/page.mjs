// The probe's browser page: page diagnostics, the authenticated-session
// requirement and the keep-open tail. The persona comes from the shared
// profile reader (`_shared/profile/persona.mjs`).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewUntilClosed } from '../../../_shared/page/settled.mjs';
import { CLOSE_AFTER_PROBE, DIAG_DIR } from './settings.mjs';

const INDENT = '  ';
// Apple signs every product in on its identity host.
const APPLE_SIGN_IN_HOST = 'idmsa.apple.com';
// The controls Apple's sign-in form renders: the account and password fields
// and the single-character inputs of its verification code.
const SIGN_IN_CONTROLS = [
  '#account_name_text_field',
  '#password_text_field',
  'input[type="password"]',
  'input[type="tel"][maxlength="1"]',
].join(', ');

/** What one document shows: its text, controls and fields, read in the page. */
function documentState() {
  const squash = (value) => value.replace(/\s+/g, ' ').trim();
  return {
    url: location.href,
    title: document.title,
    text: squash(document.body.innerText),
    links: Array.from(document.querySelectorAll('a')).map((a) => ({
      text: squash(a.innerText),
      href: a.href,
    })),
    buttons: Array.from(document.querySelectorAll('button, [role="button"]'))
      .map((b) => squash(b.innerText))
      .filter(Boolean),
    inputs: Array.from(document.querySelectorAll('input, textarea')).map(
      (el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        label: el.getAttribute('aria-label'),
        placeholder: el.getAttribute('placeholder'),
        visible: el.checkVisibility(),
      }),
    ),
  };
}

/**
 * The page and every frame's state, written to the run's diagnostics. A
 * frame that cannot be read is recorded with the error it answered, so the
 * file says which document stayed unread and why.
 */
export async function pageDiag(page, label) {
  const frames = await Promise.all(
    page.frames().map((frame) =>
      frame
        .evaluate(documentState)
        .catch((e) => ({ url: frame.url(), unreadable: e.message })),
    ),
  );
  const data = { ...(await page.evaluate(documentState)), frames };
  const outPath = join(DIAG_DIR, `${label}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, INDENT));
  console.log(
    `[apple-ads-api-setup] ${label} url=${data.url} title=${JSON.stringify(data.title)} frames=${frames.length} json=${outPath}`,
  );
  return data;
}

export async function keepOpen(session, loggedIn) {
  try {
    if (loggedIn && !CLOSE_AFTER_PROBE && !session.page.isClosed()) {
      console.log(
        '[apple-ads-api-setup] keeping browser open for review; close the window or stop the command to finish; APPLE_ADS_CLOSE_AFTER_PROBE=1 skips review',
      );
      await reviewUntilClosed(session);
    }
  } finally {
    await session.close();
  }
}

/** Whether any frame of the page shows Apple's sign-in form. */
async function signInFormShown(page) {
  for (const frame of page.frames()) {
    if (await frame.locator(SIGN_IN_CONTROLS).first().isVisible()) return true;
  }
  return false;
}

/**
 * Whether the session is signed in to Apple Ads. A page on Apple's identity
 * host, one embedding it, or one showing its sign-in form is refused: this
 * probe never signs in, an explicitly authorized apple_login does.
 */
export async function requireAuthenticatedSession(s) {
  const url = s.page.url();
  if (url === 'about:blank') return false;
  const onSignInHost = new URL(url).hostname === APPLE_SIGN_IN_HOST;
  const embedsSignIn = Boolean(
    await s.page.locator(`iframe[src*="${APPLE_SIGN_IN_HOST}"]`).count(),
  );
  if (onSignInHost || embedsSignIn || (await signInFormShown(s.page))) {
    console.log(
      'FAIL_CLOSED: Apple login/password/2FA is required; this probe will not authenticate. An explicitly authorized apple_login is the only permitted login path.',
    );
    await pageDiag(s.page, 'apple_login_required');
    return false;
  }
  return true;
}
