// The Google Analytics setup wizard's controls. Steps are read from the
// stepper's own selected label; fields, radios and menu items are found by
// their debug ids and values; and where the wizard offers only wording, the
// control is described to the vision model, which reads it in whatever
// language and copy GA serves.

import { humanFill } from '../../../../../dist/human/keyboard.js';
import { pageSettled } from '../../page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
  pageShows,
} from '../../page/judged/seen.mjs';
import { defaultInput } from '../action-catalog.mjs';
import {
  escapeRegExp,
  waitRendered,
  clickLocator,
  clickDirectLocator,
  clickAnyLocator,
  clickDomElement,
  activeStepPanel,
} from '../page-interaction.mjs';

async function selectedGaStep(page) {
  try {
    return await page.evaluate(() => {
      const visible = (node) => {
        const style = window.getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          box.width > 0 &&
          box.height > 0
        );
      };
      const labels = Array.from(
        document.querySelectorAll(
          '.mat-step-header[aria-selected="true"] .mat-step-text-label',
        ),
      );
      return (
        labels
          .find((node) => visible(node))
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() || ''
      );
    });
  } catch (error) {
    throw new Error(
      `GA wizard selected step could not be read from ${page.url()}: ${error.message}`,
      { cause: error },
    );
  }
}

// The wizard moves when the page has settled after the click that advanced
// it; a step that has not changed then did not advance, and says so by name.
async function waitForGaStep(page, pattern, description) {
  await pageSettled(page);
  const step = await selectedGaStep(page);
  if (pattern.test(step)) return;
  throw new Error(
    `${description} did not advance; selected_step=${JSON.stringify(step)}`,
  );
}

// Like waitForGaStep, for a step that may also leave the stepper: the wizard
// advanced when the stepper shows the step or the page shows what `question`
// asks about.
async function waitForGaStepOrShown(page, stepPattern, question, description) {
  await pageSettled(page);
  const step = await selectedGaStep(page);
  if (stepPattern.test(step) || (await pageShows(page, question))) return;
  throw new Error(
    `${description} did not advance; selected_step=${JSON.stringify(step)}; url=${page.url()}`,
  );
}

async function dismissGoogleAnalyticsOverlays(page) {
  for (const selector of [
    'button[aria-label*="Close"]',
    '[role="button"][aria-label*="Close"]',
    'material-button.close',
    'button.close',
    '.close-button',
  ]) {
    await clickAnyLocator(page, [page.locator(selector)]).catch(() => false);
  }
  await clickOffered(
    page,
    'a button that dismisses a promotional dialog or tip without accepting an offer',
  );
}

async function clickGaNext(
  page,
  description = 'GA wizard next button',
  expectedStepPattern = null,
) {
  await dismissGoogleAnalyticsOverlays(page);
  await clickDescribed(
    page,
    'the enabled button that advances the setup wizard to its next step',
  );
  if (expectedStepPattern) {
    await waitForGaStep(page, expectedStepPattern, description);
    return;
  }
  await waitRendered(page, 40);
}

// Chooses the option `description` names; when the page offers none, the
// first visible choice the wizard shows.
async function selectVisibleChoice(page, description) {
  if (await clickOffered(page, description)) return true;
  const controls = page
    .locator(
      'mat-radio-button, mat-checkbox, [role="radio"], [role="checkbox"], label, button',
    )
    .filter({ visible: true });
  const count = await controls.count();
  if (count > 0) {
    await clickLocator(page, controls.nth(0)).catch(() => false);
    return true;
  }
  return false;
}

// Opens the dropdown `description` names, types `value` into its search and
// picks the option that carries it.
async function setOptionalDropdown(page, description, value) {
  if (!value) return false;
  if (!(await clickOffered(page, description))) return false;
  const search = page
    .locator('input:not([type="hidden"])')
    .filter({ visible: true })
    .last();
  if (await search.isVisible().catch(() => false)) {
    await humanFill(page, search, value);
    await pageSettled(page);
  }
  if (
    await clickDomElement(
      page,
      [
        '.cdk-overlay-container [debug-id="option-item"]',
        '.cdk-overlay-container [role="option"]',
        '.cdk-overlay-container mat-option',
        '.cdk-overlay-container button',
      ],
      new RegExp(escapeRegExp(value), 'i'),
    ).catch(() => false)
  )
    return true;
  await page.keyboard.press('Escape');
  return false;
}

async function setGoogleAnalyticsIndustry(page) {
  const business = page
    .locator('ga-business-info')
    .filter({ visible: true })
    .first();
  const trigger = business
    .locator(
      'industry-selector button[debug-id="menu-open-button"], searchable-select[required] button[debug-id="menu-open-button"]',
    )
    .filter({ visible: true })
    .first();
  if (!(await clickDirectLocator(page, trigger).catch(() => false)))
    return false;
  await pageSettled(page);

  const search = page
    .locator(
      '.cdk-overlay-container input:not([type="hidden"]), .cdk-overlay-container textarea',
    )
    .filter({ visible: true })
    .first();
  if (await search.isVisible().catch(() => false)) {
    await humanFill(page, search, defaultInput('INDUSTRY_CATEGORY', 'Other'));
    await pageSettled(page);
  }

  const preferred = new RegExp(
    `^${escapeRegExp(defaultInput('INDUSTRY_CATEGORY', 'Other'))}$`,
    'i',
  );
  return clickDomElement(
    page,
    [
      '.cdk-overlay-container [debug-id="option-item"]',
      '.cdk-overlay-container [role="menuitem"]',
      '.cdk-overlay-container [role="option"]',
      '.cdk-overlay-container button',
    ],
    preferred,
  ).catch(() => false);
}

async function setGoogleAnalyticsBusinessSize(page) {
  const business = page
    .locator('ga-business-info')
    .filter({ visible: true })
    .first();
  const value = defaultInput('BUSINESS_SIZE', '1');
  const sizeRadio = business
    .locator(`input[type="radio"][value="${escapeRegExp(value)}"]`)
    .first();
  if (await sizeRadio.count()) {
    await sizeRadio.check({ force: true });
    await pageSettled(page);
    if (await sizeRadio.isChecked().catch(() => false)) return true;
  }
  return clickOffered(page, 'the smallest business size option');
}

async function setGoogleAnalyticsObjective(page) {
  const panel = activeStepPanel(page);
  const objective = defaultInput(
    'BUSINESS_OBJECTIVE',
    'Understand web and/or app traffic',
  );
  const preferred = panel
    .locator(
      `input[type="checkbox"][name*="${objective.replace(/"/g, '\\"')}"]`,
    )
    .first();
  if (await preferred.count()) {
    await preferred.check({ force: true });
    await pageSettled(page);
    if (await preferred.isChecked().catch(() => false)) return true;
  }
  return clickOffered(page, `the business objective "${objective}"`);
}

async function clickGoogleAnalyticsCreateButton(page) {
  const panel = activeStepPanel(page);
  await pageSettled(page);
  if (
    await clickAnyLocator(page, [
      panel.locator(
        'button[aria-label="Create an account with a property"], button.create-button',
      ),
    ]).catch(() => false)
  )
    return;
  await clickDescribed(
    page,
    'the enabled button that creates the account at the end of the business objectives step',
  );
}

export {
  selectedGaStep,
  waitForGaStep,
  waitForGaStepOrShown,
  dismissGoogleAnalyticsOverlays,
  clickGaNext,
  selectVisibleChoice,
  setOptionalDropdown,
  setGoogleAnalyticsIndustry,
  setGoogleAnalyticsBusinessSize,
  setGoogleAnalyticsObjective,
  clickGoogleAnalyticsCreateButton,
};
