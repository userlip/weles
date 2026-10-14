import { confirmedFill } from '../../../_shared/page/confirmed-fill.mjs';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../dist/human/mouse.js';
import { pageSettled, responseAfterAction } from '../../../_shared/page/settled.mjs';
import { fitsField } from '../../../_shared/page/fits.mjs';

function introButton(page) {
  return page
    .locator(
      'a[aria-label="Edit profile" i], button[aria-label="Edit profile" i], a[aria-label*="Edit intro" i]',
    )
    .filter({ visible: true })
    .first();
}

export async function editIntro(s, character, targetName, targetHeadline) {
  // Open the profile editor from the authenticated profile.
  await s.page.goto('https://www.linkedin.com/in/me/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('deliberate');
  const editIntroBtn = introButton(s.page);
  if (await editIntroBtn.count()) {
    await humanClickLocator(s.page, editIntroBtn);
    // The first-name input marks the intro form's readiness.
    await s.page
      .locator(
        'input[id*="first-name" i], input[id*="firstName" i], input[name*="firstName" i]',
      )
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible' });
  } else {
    console.log(
      '[li-profile] edit-intro button not found on /in/me/ — falling through to field probe',
    );
  }

  // A character without a name leaves both native name fields unchanged.
  const [firstName, ...rest] = targetName.split(/\s+/);
  const lastName = rest.join(' ');
  if (targetName && !lastName)
    throw new Error(
      'LinkedIn needs a first and last name; the stated name cannot be written as a complete profile name',
    );
  const fnIn = s.page
    .locator(
      'input[id*="first-name" i], input[id*="firstName" i], input[name*="firstName" i]',
    )
    .filter({ visible: true })
    .first();
  const lnIn = s.page
    .locator(
      'input[id*="last-name" i], input[id*="lastName" i], input[name*="lastName" i]',
    )
    .filter({ visible: true })
    .first();
  // The headline uses a textarea.
  const hlIn = s.page.locator('textarea').first();
  const indIn = s.page.getByLabel('Industry', { exact: false }).first();
  // The industry comes from the character; one it does not name is left as
  // the profile has it rather than replaced with an industry nobody chose.
  const tgtInd = character.occupation || character.niche;

  const writes = [];
  for (const [el, target, label] of [
    [fnIn, firstName, 'first_name'],
    [lnIn, lastName, 'last_name'],
    [hlIn, targetHeadline, 'headline'],
    [indIn, tgtInd, 'industry'],
  ]) {
    // A value the character does not state leaves the field as it is; a
    // stated one whose field the form does not show fails the run, instead
    // of a PASS for a profile that was not updated.
    if (!target) continue;
    if (!(await el.count()))
      throw new Error(
        `the LinkedIn intro form shows no ${label} field; the stated ${label} was not written`,
      );
    await el.scrollIntoViewIfNeeded();
    const cur = await el.inputValue();
    if (cur === target) continue;
    await fitsField(el, target, `the LinkedIn ${label}`);
    // Read back before Save: a clear that did not take would save the old
    // value with the new one appended.
    await confirmedFill(s.page, el, target, `the LinkedIn ${label} field`);
    if (label === 'industry') {
      await humanIdlePause('short');
      const sugg = s.page
        .locator('[role="option"], [role="listbox"] li, .typeahead-result')
        .filter({ visible: true })
        .first();
      if (await sugg.count()) {
        await humanClickLocator(s.page, sugg);
        console.log('[li-profile] picked industry typeahead');
      }
    }
    writes.push(`${label} "${cur}" -> "${target}"`);
  }

  if (writes.length) {
    console.log(`[li-profile] writes: ${writes.join('; ')}`);
    // Blur the last edited field so the form observes its change.
    await s.page.keyboard.press('Tab');
    const saveBtn = s.page
      .locator(
        'button:has-text("Save"):not([disabled]):not([aria-disabled="true"])',
      )
      .filter({ visible: true })
      .last();
    const saveCount = await saveBtn.count();
    console.log(`[li-profile] save button enabled count=${saveCount}`);
    if (saveCount) {
      // Watch for the save mutation POST. The form is a React Server
      // Component; saving fires a POST to /flagship-web/rsc-action/.
      const apiRes = await responseAfterAction(
        s.page,
        (request) =>
          request.method() === 'POST' &&
          /rsc-action.*ProfileEditIntroForm|rsc-action.*editProfile|rsc-action.*action=update/.test(
            request.url(),
          ),
        () => humanClickLocator(s.page, saveBtn),
      );
      console.log('[li-profile] save dispatch: humanClickLocator');
      const requestUrl = apiRes.url();
      const status = apiRes.status();
      if (!apiRes.ok())
        throw Object.assign(
          new Error(
            `Profile save returned HTTP ${status} ${apiRes.statusText()} at ${requestUrl}`,
          ),
          {
            code: 'LI_PROFILE_SAVE_HTTP_ERROR',
            requestMethod: 'POST',
            requestUrl,
            status,
          },
        );
      try {
        const failure = await apiRes.finished();
        if (failure) throw failure;
      } catch (cause) {
        throw Object.assign(
          new Error(`Profile save response did not finish at ${requestUrl}`, {
            cause,
          }),
          {
            code: 'LI_PROFILE_SAVE_RESPONSE_FAILED',
            requestMethod: 'POST',
            requestUrl,
            status,
          },
        );
      }
      console.log(`[li-profile] save: mutation POST=${status} ${requestUrl}`);
      await s.page.goto('https://www.linkedin.com/in/me/', {
        waitUntil: 'domcontentloaded',
      });
      await pageSettled(s.page);
      const verifyBtn = introButton(s.page);
      if (!(await verifyBtn.count()))
        throw new Error(
          `the LinkedIn profile at ${s.page.url()} has no Edit profile control for persisted readback`,
        );
      await humanClickLocator(s.page, verifyBtn);
      await pageSettled(s.page);
      for (const [el, target, label] of [
        [fnIn, firstName, 'first_name'],
        [lnIn, lastName, 'last_name'],
        [hlIn, targetHeadline, 'headline'],
        [indIn, tgtInd, 'industry'],
      ]) {
        if (!target) continue;
        if (!(await el.count()))
          throw new Error(`the LinkedIn ${label} field vanished on readback`);
        const kept = await el.inputValue();
        if (kept !== target)
          throw new Error(
            `LinkedIn kept a ${label} of ${kept.length} characters, not the ${target.length} requested; the profile is unconfirmed`,
          );
      }
    } else {
      throw Object.assign(
        new Error(
          'No visible enabled Save button after profile field input and blur',
        ),
        { code: 'LI_PROFILE_SAVE_NOT_ENABLED', pageUrl: s.page.url() },
      );
    }
  } else {
    console.log('[li-profile] intro fields already match — skipping save');
  }
  return writes;
}
