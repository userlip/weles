// Post-register profile-build helper.
//
// LinkedIn shows a mandatory onboarding gate after signup:
//   "<First>, you're one step away from viewing this profile —
//    Add a job or school to continue and get discovered by recruiters."
// with tabs "Add a role" / "Add a school" + required Title + Company inputs.
//
// Without filling this, the fresh stooge cannot view any other profile and
// scrapes return the gated stub. Call this from linkedin_register.mjs after
// post-signup redirect completes and before saveAccount/PASS.

import { humanFill } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../../page/settled.mjs';
import { clickOffered, pageShows } from '../../page/judged/seen.mjs';
import { statedText } from '../../inputs/stated.mjs';

/**
 * The role and school the new profile shows, as the run's caller states them.
 * They are facts about the person the account belongs to, so none is made
 * up: each missing one is refused by name before the signup starts.
 */
export function statedOnboardingProfile() {
  const stated = (name, what) =>
    statedText([name], what, 'LINKEDIN_ONBOARDING_PROFILE_REQUIRED');
  return {
    title: stated('LINKEDIN_ROLE_TITLE', 'the job title the new profile shows'),
    company: stated(
      'LINKEDIN_ROLE_COMPANY',
      'the company the new profile names for that role',
    ),
    school: stated('LINKEDIN_SCHOOL', 'the school the new profile names'),
    degree: stated('LINKEDIN_DEGREE', 'the degree earned at that school'),
    fieldOfStudy: stated(
      'LINKEDIN_FIELD_OF_STUDY',
      'the field studied at that school',
    ),
  };
}

async function clickIfVisible(page, locator) {
  let visible = false;
  try {
    visible = await locator.isVisible();
  } catch (e) {
    console.log(`[onboarding] isVisible err: ${e.message}`);
    return false;
  }
  if (!visible) return false;
  await humanClickLocator(page, locator);
  return true;
}

async function fillIfVisible(page, locator, value) {
  let visible = false;
  try {
    visible = await locator.isVisible();
  } catch (e) {
    console.log(`[onboarding] isVisible err: ${e.message}`);
    return false;
  }
  if (!visible) return false;
  await humanFill(page, locator, value);
  return true;
}

/**
 * Fill the inline "Add a role" / "Add a school" widget that LinkedIn presents
 * after register. Returns { roleAdded, schoolAdded, viewable }.
 */
export async function fillPostRegisterOnboarding(page, profile) {
  console.log('[onboarding] post-register profile-build attempt');
  await pageSettled(page);

  let roleAdded = false;
  const { title, company } = profile;
  try {
    await page.goto('https://www.linkedin.com/in/me/edit/position/new/', {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(page);
    const titleFilled = await fillIfVisible(
      page,
      page
        .locator(
          'input[id*="title-typeahead" i], input[aria-label*="Title" i], input[id*="title" i]',
        )
        .first(),
      title,
    );
    await pageSettled(page);
    const companyFilled = await fillIfVisible(
      page,
      page
        .locator(
          'input[id*="company-typeahead" i], input[aria-label*="Company" i], input[name="companyName"]',
        )
        .first(),
      company,
    );
    await pageSettled(page);
    await clickIfVisible(
      page,
      page.locator('div[role="listbox"] li, ul[role="listbox"] li').first(),
    );
    await pageSettled(page);
    const saved = await clickOffered(
      page,
      'the button that saves the position to the profile',
    );
    if (titleFilled && companyFilled && saved) {
      roleAdded = true;
      console.log(`[onboarding] role added: ${title} @ ${company}`);
    } else {
      console.log(
        `[onboarding] role fill incomplete title=${titleFilled} company=${companyFilled} saved=${saved}`,
      );
    }
  } catch (e) {
    console.log(`[onboarding] role err: ${e.message}`);
  }

  await pageSettled(page);

  let schoolAdded = false;
  try {
    await page.goto('https://www.linkedin.com/in/me/edit/education/new/', {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(page);
    const schoolFilled = await fillIfVisible(
      page,
      page
        .locator(
          'input[id*="school-typeahead" i], input[id*="school" i], input[aria-label*="School" i]',
        )
        .first(),
      profile.school,
    );
    await pageSettled(page);
    await clickIfVisible(
      page,
      page.locator('div[role="listbox"] li, ul[role="listbox"] li').first(),
    );
    await pageSettled(page);
    await fillIfVisible(
      page,
      page
        .locator('input[id*="degree" i], input[aria-label*="Degree" i]')
        .first(),
      profile.degree,
    );
    await pageSettled(page);
    await fillIfVisible(
      page,
      page
        .locator(
          'input[id*="fieldOfStudy" i], input[aria-label*="Field of study" i], input[id*="field" i]',
        )
        .first(),
      profile.fieldOfStudy,
    );
    await pageSettled(page);
    const saved = await clickOffered(
      page,
      'the button that saves the education to the profile',
    );
    if (schoolFilled && saved) {
      schoolAdded = true;
      console.log(`[onboarding] school added: ${profile.school}`);
    } else {
      console.log(
        `[onboarding] school fill incomplete school=${schoolFilled} saved=${saved}`,
      );
    }
  } catch (e) {
    console.log(`[onboarding] school err: ${e.message}`);
  }

  let viewable = false;
  try {
    await page.goto('https://www.linkedin.com/in/williamhgates/', {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(page);
    // LinkedIn gates a profile behind "add a job or school" until onboarding
    // is done; the vision model reads whether the profile itself is shown.
    const gated = await pageShows(
      page,
      'Does the page ask to add a job or school (or complete a step) before the profile can be viewed?',
    );
    viewable =
      !gated &&
      (await pageShows(
        page,
        "Does the page show a person's LinkedIn profile?",
      ));
    console.log(
      `[onboarding] post-build profile view: gated=${gated} viewable=${viewable}`,
    );
  } catch (e) {
    console.log(`[onboarding] view-verify err: ${e.message}`);
  }

  return { roleAdded, schoolAdded, viewable };
}
