import { pageSettled } from '../../page/settled.mjs';
import {
  clickDescribed,
  fillOffered,
  pageShows,
} from '../../page/judged/seen.mjs';
import { GA_BASE, defaultInput, siteHost } from '../action-catalog.mjs';
import {
  safeGoto,
  bodyText,
  waitRendered,
  clickDomElement,
  clickAnyLocator,
  clickLocator,
  fillDomInput,
} from '../page-interaction.mjs';
import {
  dismissGoogleAnalyticsOverlays,
  clickGaNext,
  waitForGaStep,
  waitForGaStepOrShown,
  selectVisibleChoice,
  setOptionalDropdown,
  setGoogleAnalyticsIndustry,
  setGoogleAnalyticsBusinessSize,
  setGoogleAnalyticsObjective,
  clickGoogleAnalyticsCreateButton,
} from './wizard-controls.mjs';
import {
  extractGaMeasurementId,
  fillGoogleAnalyticsWebStreamStep,
  openGoogleAnalyticsCreatedStreamDetail,
} from './web-stream.mjs';

function gaRegistrationInputs() {
  const siteUrl = defaultInput('SITE_URL', 'https://www.needher.ai');
  const propertyName = defaultInput('PROPERTY_NAME', 'NeedHer AI');
  return {
    accountName: defaultInput('ACCOUNT_NAME', propertyName),
    propertyName,
    siteUrl,
    streamName: defaultInput('STREAM_NAME', `${propertyName} Web`),
    timezone: defaultInput('TIMEZONE', 'United States'),
    currency: defaultInput('CURRENCY', 'US Dollar'),
    domain: siteHost(siteUrl),
  };
}

async function openGoogleAnalyticsCreateAccount(s) {
  await safeGoto(s, GA_BASE);
  await pageSettled(s.page);
  await dismissGoogleAnalyticsOverlays(s.page);

  const currentHash = new URL(s.page.url()).hash;
  const scope = currentHash.match(/^#\/(a\d+p\d+)\b/)?.[1];
  const adminUrl = scope ? `${GA_BASE}#/${scope}/admin` : `${GA_BASE}#/admin`;
  await safeGoto(s, adminUrl);
  await pageSettled(s.page);
  await dismissGoogleAnalyticsOverlays(s.page);

  const createButton = [
    s.page.locator('button[data-guidedhelpid="create-entity-trigger"]'),
    s.page.locator('.create-entity-menu-trigger'),
  ];
  if (!(await clickAnyLocator(s.page, createButton).catch(() => false))) {
    await safeGoto(s, adminUrl);
    await pageSettled(s.page);
    await dismissGoogleAnalyticsOverlays(s.page);
    await clickAnyLocator(s.page, createButton, 'GA Admin Create button');
  }
  await pageSettled(s.page);
  await clickDescribed(s.page, 'the menu item that creates a new account');
  await waitRendered(s.page, 40);
}

async function fillGoogleAnalyticsAccountStep(s, values) {
  const filled = await fillDomInput(
    s.page,
    [
      'input[debug-id="account-name-input"]',
      'ga-account-setup input:not([type="hidden"])',
    ],
    values.accountName,
  );
  if (
    !filled &&
    !(await fillOffered(s.page, 'the account name field', values.accountName))
  ) {
    throw new Error('GA account-name field was not fillable');
  }
  if (
    !(await clickDomElement(s.page, [
      'button[debug-id="account-next-step-button"]',
    ]))
  ) {
    await clickGaNext(
      s.page,
      'GA account setup next button',
      /Property creation/i,
    );
    return;
  }
  await waitForGaStep(
    s.page,
    /Property creation/i,
    'GA account setup next button',
  );
}

async function fillGoogleAnalyticsPropertyStep(s, values) {
  const filled = await fillDomInput(
    s.page,
    [
      'input[data-guidedhelpid="property-name-input"]',
      'input[debug-id="property-name-input"]',
      'ga-property-setup input:not([type="hidden"])',
    ],
    values.propertyName,
  );
  if (
    !filled &&
    !(await fillOffered(s.page, 'the property name field', values.propertyName))
  ) {
    throw new Error('GA property-name field was not fillable');
  }
  await setOptionalDropdown(
    s.page,
    'the reporting time zone dropdown',
    values.timezone,
  );
  await setOptionalDropdown(s.page, 'the currency dropdown', values.currency);
  if (
    !(await clickDomElement(s.page, [
      'button[debug-id="property-next-step-button"]',
    ]))
  ) {
    await clickGaNext(
      s.page,
      'GA property setup next button',
      /Business details/i,
    );
    return;
  }
  await waitForGaStep(
    s.page,
    /Business details/i,
    'GA property setup next button',
  );
}

async function fillGoogleAnalyticsBusinessStep(s) {
  await setGoogleAnalyticsIndustry(s.page).catch(() => false);
  if (!(await setGoogleAnalyticsBusinessSize(s.page)))
    await selectVisibleChoice(s.page, 'the smallest business size option');
  await clickGaNext(
    s.page,
    'GA business details next button',
    /Business objectives/i,
  );
}

async function fillGoogleAnalyticsObjectivesStep(s) {
  if (!(await setGoogleAnalyticsObjective(s.page)))
    await selectVisibleChoice(
      s.page,
      'the business objective about understanding web traffic',
    );
  await clickGoogleAnalyticsCreateButton(s.page);
  await waitForGaStepOrShown(
    s.page,
    /Data collection/i,
    'Does the page show the terms of service agreement or the data collection / web stream setup?',
    'GA business objectives create button',
  );
}

async function acceptGoogleAnalyticsTermsIfPresent(s) {
  if (
    !(await pageShows(
      s.page,
      'Does the page show a terms of service or data processing agreement to accept?',
    ))
  )
    return;

  // The required agreement boxes are checked, then the acceptance control.
  const boxes = s.page
    .locator('mat-checkbox, input[type="checkbox"], [role="checkbox"]')
    .filter({ visible: true });
  for (const box of await boxes.all()) {
    if ((await box.getAttribute('aria-checked')) !== 'true')
      await clickLocator(s.page, box);
  }
  const accept = s.page.locator('button[debug-id="accept-button"]').first();
  if (await accept.isVisible()) await clickLocator(s.page, accept);
  else await clickDescribed(s.page, 'the button that accepts the agreement');
  await waitForGaStepOrShown(
    s.page,
    /Data collection/i,
    'Does the page show the data collection or web stream setup?',
    'GA terms accept button',
  );
}

async function googleAnalyticsRegisterSite(s) {
  const values = gaRegistrationInputs();
  await openGoogleAnalyticsCreateAccount(s);
  await fillGoogleAnalyticsAccountStep(s, values);
  await fillGoogleAnalyticsPropertyStep(s, values);
  await fillGoogleAnalyticsBusinessStep(s, values);
  await fillGoogleAnalyticsObjectivesStep(s, values);
  await acceptGoogleAnalyticsTermsIfPresent(s);
  await fillGoogleAnalyticsWebStreamStep(s, values);
  await openGoogleAnalyticsCreatedStreamDetail(s, values);

  await pageSettled(s.page);
  const text = await bodyText(s.page);
  const measurementId = extractGaMeasurementId(text);
  if (measurementId) return { registration: { ...values, measurementId } };
  throw new Error(
    `GA registration completed no visible measurement id; final_url=${s.page.url()}; body_preview=${text.replace(/\s+/g, ' ')}`,
  );
}

export {
  gaRegistrationInputs,
  openGoogleAnalyticsCreateAccount,
  fillGoogleAnalyticsAccountStep,
  fillGoogleAnalyticsPropertyStep,
  fillGoogleAnalyticsBusinessStep,
  fillGoogleAnalyticsObjectivesStep,
  acceptGoogleAnalyticsTermsIfPresent,
  googleAnalyticsRegisterSite,
};
