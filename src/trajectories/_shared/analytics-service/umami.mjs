import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, responseAfterAction } from '../page/settled.mjs';
import {
  clickDescribed,
  fillOffered,
  pageShows,
} from '../page/judged/seen.mjs';
import {
  UMAMI_BASE,
  UMAMI_APP_BASE,
  input,
  defaultInput,
} from './action-catalog.mjs';
import {
  escapeRegExp,
  safeGoto,
  bodyText,
  clickDomElement,
} from './page-interaction.mjs';

async function umamiRegisterAccount(s) {
  await safeGoto(s, `${UMAMI_BASE}/signup`);
  await pageSettled(s.page);
  if (await pageShows(s.page, 'Does the page say it was not found?')) {
    await safeGoto(s, UMAMI_BASE);
    await clickDescribed(s.page, 'the button or link that starts signing up');
  }

  const email = input('EMAIL');
  const password = input('PASSWORD');
  const displayName = defaultInput(
    'DISPLAY_NAME',
    email.split('@')[0] || 'Weles User',
  );
  await fillOffered(s.page, 'the name field of the sign-up form', displayName);
  const emailInput = s.page
    .locator('input[type="email"], input[name="email"]')
    .filter({ visible: true })
    .first();
  const passwordInput = s.page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  if (!(await emailInput.isVisible()) || !(await passwordInput.isVisible()))
    throw new Error('Umami sign-up form shows no email or password field');
  await humanFill(s.page, emailInput, email);
  await humanFill(s.page, passwordInput, password);

  if (
    !(await clickDomElement(s.page, [
      'button[data-umami-event="signup-button-click"]',
      'form button[type="submit"]',
    ]))
  ) {
    await passwordInput.press('Enter');
    await pageSettled(s.page);
  }
  if (
    (await s.page.locator('input[aria-invalid="true"]').count()) ||
    (await pageShows(
      s.page,
      'Does the page say the sign-up failed (an error, an existing account or an invalid field)?',
    ))
  ) {
    throw new Error(
      `Umami sign-up failed: ${(await bodyText(s.page)).replace(/\s+/g, ' ')}`,
    );
  }
  if (
    await pageShows(
      s.page,
      'Does the page ask to verify the email address, or show the Umami analytics dashboard?',
    )
  ) {
    return { registration: { email, status: 'submitted_or_verified' } };
  }
  throw new Error(
    `Umami sign-up did not reach a verification or dashboard state: ${s.page.url()}`,
  );
}

async function umamiCreateWebsite(s) {
  await clickDescribed(s.page, 'the button that adds a website');
  const dialog = s.page.getByRole('dialog').filter({ visible: true }).first();
  await dialog.waitFor({ state: 'visible' });

  // The dialog's two fields are the website's name and its domain, in order.
  const fields = dialog
    .locator('input:not([type="hidden"]), textarea')
    .filter({ visible: true });
  if (!(await fields.nth(1).isVisible()))
    throw new Error('Umami Add website dialog fields were not fillable');
  await humanFill(s.page, fields.first(), input('DISPLAY_NAME'));
  await humanFill(s.page, fields.nth(1), input('DOMAIN'));

  const saveButton = dialog
    .locator('button[data-test="button-submit"], button[type="submit"]')
    .filter({ visible: true })
    .last();
  if (!(await saveButton.isVisible()))
    throw new Error('Umami Add website save button was not visible');
  if (!(await saveButton.isEnabled()))
    throw Object.assign(
      new Error('Umami Add website save button was disabled'),
      { code: 'UMAMI_WEBSITE_SAVE_NOT_ENABLED', pageUrl: s.page.url() },
    );

  const response = await responseAfterAction(
    s.page,
    (request) =>
      request.method() === 'POST' &&
      /gateway-us\.umami\.is\/api\/.*websites|cloud\.umami\.is\/analytics\/us\/api\/.*websites/i.test(
        request.url(),
      ),
    () => humanClickLocator(s.page, saveButton),
  );
  const status = response.status();
  const requestUrl = response.url();
  let body;
  try {
    body = await response.text();
  } catch (cause) {
    throw Object.assign(
      new Error(
        `Umami website-save response could not be read at ${requestUrl}`,
        { cause },
      ),
      {
        code: 'UMAMI_WEBSITE_RESPONSE_FAILED',
        requestMethod: 'POST',
        requestUrl,
        status,
      },
    );
  }
  if (!response.ok())
    throw Object.assign(
      new Error(`Umami Add website save failed: HTTP ${status} ${body}`),
      {
        code: 'UMAMI_WEBSITE_SAVE_HTTP_ERROR',
        requestMethod: 'POST',
        requestUrl,
        status,
      },
    );
  await pageSettled(s.page);
  await safeGoto(
    s,
    `${UMAMI_APP_BASE}/websites?search=${encodeURIComponent(input('DOMAIN'))}&page=1`,
  );

  const domainPattern = new RegExp(escapeRegExp(input('DOMAIN')), 'i');
  await pageSettled(s.page);
  if (domainPattern.test(await bodyText(s.page))) return;
  throw new Error(
    `Umami website ${input('DOMAIN')} was not visible after save`,
  );
}

export { umamiRegisterAccount, umamiCreateWebsite };
