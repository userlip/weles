// The Google Analytics setup wizard's controls. Steps are read from the
// stepper's own selected label; fields, radios and menu items are found by
// their debug ids and values; and where the wizard offers only wording, the
// control is described to the vision model, which reads it in whatever
// language and copy GA serves. A stated answer the wizard offers no control
// for fails the step by name; nothing is picked in its place.

import { humanFill } from '../../../../../dist/human/keyboard.js';
import { pageSettled } from '../../page/settled.mjs';
import { clickDescribed, clickOffered, pageShows } from '../../page/judged/seen.mjs';
import { input } from '../action-catalog.mjs';
import {
  escapeRegExp,
  clickDirectLocator,
  clickAnyLocator,
  clickDomElement,
  activeStepPanel,
} from '../page-interaction.mjs';

const OVERLAY_OPTIONS = [
  '.cdk-overlay-container [debug-id="option-item"]',
  '.cdk-overlay-container [role="menuitem"]',
  '.cdk-overlay-container [role="option"]',
  '.cdk-overlay-container mat-option',
  '.cdk-overlay-container button',
];

/** The stepper's selected step label, or null when the stepper shows none. */
async function selectedGaStep(page) {
  try {
    return await page.evaluate(() => {
      const visible = (node) => {
        const style = window.getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
      };
      const label = Array.from(
        document.querySelectorAll('.mat-step-header[aria-selected="true"] .mat-step-text-label'),
      ).find((node) => visible(node));
      return label ? label.textContent.replace(/\s+/g, ' ').trim() : null;
    });
  } catch (error) {
    throw new Error(`GA wizard selected step could not be read from ${page.url()}: ${error.message}`, { cause: error });
  }
}

// The wizard moves when the page has settled after the click that advanced
// it; a step that has not changed then did not advance, and says so by name.
async function waitForGaStep(page, pattern, description) {
  await pageSettled(page);
  const step = await selectedGaStep(page);
  if (step !== null && pattern.test(step)) return;
  throw new Error(`${description} did not advance; selected_step=${JSON.stringify(step)}`);
}

// Like waitForGaStep, for a step that may also leave the stepper: the wizard
// advanced when the stepper shows the step or the page shows what `question`
// asks about.
async function waitForGaStepOrShown(page, stepPattern, question, description) {
  await pageSettled(page);
  const step = await selectedGaStep(page);
  if ((step !== null && stepPattern.test(step)) || (await pageShows(page, question))) return;
  throw new Error(`${description} did not advance; selected_step=${JSON.stringify(step)}; url=${page.url()}`);
}

async function dismissGoogleAnalyticsOverlays(page) {
  for (const selector of [
    'button[aria-label*="Close"]',
    '[role="button"][aria-label*="Close"]',
    'material-button.close',
    'button.close',
    '.close-button',
  ])
    await clickAnyLocator(page, [page.locator(selector)]);
  await clickOffered(page, 'a button that dismisses a promotional dialog or tip without accepting an offer');
}

/** Advance the wizard; with `expectedStepPattern`, the step it must reach. */
async function clickGaNext(page, description, expectedStepPattern) {
  await dismissGoogleAnalyticsOverlays(page);
  await clickDescribed(page, 'the enabled button that advances the setup wizard to its next step');
  if (expectedStepPattern) await waitForGaStep(page, expectedStepPattern, description);
  else await pageSettled(page);
}

/** Type `value` into the open overlay's search, when it has one, and pick the option `option` matches. */
async function pickOverlayOption(page, value, option, what) {
  const search = page
    .locator('.cdk-overlay-container input:not([type="hidden"]), .cdk-overlay-container textarea')
    .filter({ visible: true })
    .first();
  if (await search.isVisible()) {
    await humanFill(page, search, value);
    await pageSettled(page);
  }
  if (await clickDomElement(page, OVERLAY_OPTIONS, option)) return;
  await page.keyboard.press('Escape');
  throw new Error(`GA ${what} offers no option ${JSON.stringify(value)}`);
}

/**
 * Set the dropdown `description` names to `value`. An input the caller did
 * not state leaves the wizard's own preselection; a stated one the wizard
 * offers no dropdown or option for fails the step.
 */
async function setOptionalDropdown(page, description, value) {
  if (!value) return;
  if (!(await clickOffered(page, description)))
    throw new Error(`GA wizard offers no ${description} for the stated ${JSON.stringify(value)}`);
  await pickOverlayOption(page, value, new RegExp(escapeRegExp(value), 'i'), description);
}

/** The stated INDUSTRY_CATEGORY, picked from GA's industry menu; unstated, the menu is left as GA has it. */
async function setGoogleAnalyticsIndustry(page) {
  const industry = input('INDUSTRY_CATEGORY');
  if (!industry) return;
  const trigger = page
    .locator('ga-business-info')
    .filter({ visible: true })
    .first()
    .locator(
      'industry-selector button[debug-id="menu-open-button"], searchable-select[required] button[debug-id="menu-open-button"]',
    );
  if (!(await clickDirectLocator(page, trigger)))
    throw new Error(`GA business step offers no industry menu for the stated ${JSON.stringify(industry)}`);
  await pageSettled(page);
  await pickOverlayOption(page, industry, new RegExp(`^${escapeRegExp(industry)}$`, 'i'), 'industry menu');
}

/** The stated BUSINESS_SIZE: GA's size radio of that value, or the option the vision model finds by it. */
async function setGoogleAnalyticsBusinessSize(page) {
  const size = input('BUSINESS_SIZE');
  const sizeRadio = page
    .locator('ga-business-info')
    .filter({ visible: true })
    .first()
    .locator(`input[type="radio"][value="${escapeRegExp(size)}"]`)
    .first();
  if (await sizeRadio.count()) {
    await sizeRadio.check({ force: true });
    await pageSettled(page);
    if (await sizeRadio.isChecked()) return;
  }
  if (!(await clickOffered(page, `the business size option "${size}"`)))
    throw new Error(`GA business step offers no business size option ${JSON.stringify(size)}`);
}

/** The stated BUSINESS_OBJECTIVE: the checkbox named for it, or the option the vision model finds by it. */
async function setGoogleAnalyticsObjective(page) {
  const objective = input('BUSINESS_OBJECTIVE');
  const box = activeStepPanel(page)
    .locator(`input[type="checkbox"][name*="${objective.replace(/"/g, '\\"')}"]`)
    .first();
  if (await box.count()) {
    await box.check({ force: true });
    await pageSettled(page);
    if (await box.isChecked()) return;
  }
  if (!(await clickOffered(page, `the business objective "${objective}"`)))
    throw new Error(`GA objectives step offers no objective ${JSON.stringify(objective)}`);
}

async function clickGoogleAnalyticsCreateButton(page) {
  const panel = activeStepPanel(page);
  await pageSettled(page);
  if (
    await clickAnyLocator(page, [
      panel.locator('button[aria-label="Create an account with a property"], button.create-button'),
    ])
  )
    return;
  await clickDescribed(page, 'the enabled button that creates the account at the end of the business objectives step');
}

export {
  selectedGaStep,
  waitForGaStep,
  waitForGaStepOrShown,
  dismissGoogleAnalyticsOverlays,
  clickGaNext,
  setOptionalDropdown,
  setGoogleAnalyticsIndustry,
  setGoogleAnalyticsBusinessSize,
  setGoogleAnalyticsObjective,
  clickGoogleAnalyticsCreateButton,
};
