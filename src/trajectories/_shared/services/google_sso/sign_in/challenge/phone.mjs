// A Google device prompt is a live challenge, not a missing authenticator.
// Select an offered phone method once, ask the account owner for approval,
// and observe Google's response without sending page contents to alert channels.
// Where Google's page stands is read by `./device_prompt.mjs`; what the page
// offers (other ways to verify, the phone prompt, sending it again) is judged
// by the vision model.
import { pageSettled } from '../../../../page/settled.mjs';
import { clickDescribed, pageShows } from '../../../../page/judged/seen.mjs';
import {
  closeOperatorRequest,
  noteOperatorRequest,
  openOperatorRequest,
  repageOperatorRequest,
} from '#operator-request';
import { nextApprovalEvent } from './wait.mjs';
import {
  announcedNow,
  failure,
  onChallenge,
  onDevicePrompt,
  untilReady,
  watchDevicePrompt,
} from './device_prompt.mjs';

/**
 * Google's phone method on the current challenge, without sending anything:
 * `{ shown: true }` when Google already shows its device prompt (it sent it on
 * its own), `{ option: true }` when choosing the method would send it, or null
 * when Google offers no phone prompt. The other-ways control only lists the
 * methods, and the vision model reads which are offered.
 */
async function offeredPhonePrompt(page) {
  if (!onChallenge(page)) return null;
  if (onDevicePrompt(page)) return { shown: true };
  if (
    await pageShows(
      page,
      'Does the page offer a control that shows other ways to verify?',
    )
  ) {
    await clickDescribed(page, 'the control that shows other ways to verify');
  }
  const offered = await pageShows(
    page,
    'Does the page offer approving the sign-in with a prompt on the phone or tablet?',
  );
  return offered ? { option: true } : null;
}

/** Whether Google offers a phone prompt here; nothing is sent to the phone. */
export async function googlePhonePromptOffered(page) {
  return Boolean(await offeredPhonePrompt(page));
}

/**
 * The sentence naming the number Google asks the phone to match, or null
 * when the prompt shows none. The device prompt shows it as the page's one
 * standalone number.
 */
async function numberToMatch(page) {
  const text = await page.locator('body').innerText();
  const found = text.match(/(?:^|\s)(?<number>\d+)(?:\s|$)/m);
  return found
    ? `Choose ${found.groups.number} if the phone asks you to match the number.`
    : null;
}

/** `sentences` joined, the absent ones left out. */
function said(...sentences) {
  return sentences.filter(Boolean).join(' ');
}

/** The answers the operator request already holds; a new request holds none. */
function answersOf(request) {
  return Array.isArray(request.answers) ? request.answers : [];
}

// Returns false only when Google offers no phone prompt. A rejected or
// interrupted approval is an explicit failure.
//
// No prompt is sent before the operator is ready: a prompt sent while he is
// away expires unseen. The run asks him first (`weles runs answer <run>
// --ready`, Weles Desktop's Running screen, every channel he chose) and
// chooses Google's phone method only on that answer, then asks him to
// approve, with the number to match. Only when Google already shows its
// device prompt on its own is there nothing to hold back.
//
// The approval wait ends on whichever comes first: Google's page leaving the
// device prompt, or the operator answering. `not_received` presses Google's
// "Resend it", or ends the run saying Google offers no second send;
// `approved` while Google still shows the prompt is recorded with what the
// page shows. A new alert on the prompt is the prompt expiring when Google
// then offers to send it again (the operator is asked again), and a refusal
// otherwise. Ending the wait is `weles runs cancel`, which ends the run.
export async function completeGooglePhoneApproval(page, account, run) {
  const offered = await offeredPhonePrompt(page);
  if (!offered) return false;
  const request = openOperatorRequest({
    kind: 'google-push-approval',
    account,
    run,
    instruction: offered.shown
      ? said(
          `Approve the Google sign-in for ${account} on your phone.`,
          await numberToMatch(page),
        )
      : `Weles will send a Google sign-in prompt for ${account} to your phone when you answer ready; nothing is sent before. Then approve it on the phone.`,
  });
  console.log(
    `[google_sso] operator request ${request.id}; notification delivered=${request.pages.some((attempt) => attempt.ok)}`,
  );
  let seen = answersOf(request).length;
  const [firstRun] = Array.isArray(request.run_ids) ? request.run_ids : [];
  const notReceived = `weles runs answer ${firstRun ? firstRun : '<this run>'} --not-received`;
  try {
    if (offered.option) {
      seen = await untilReady(page, request, seen);
      await clickDescribed(
        page,
        'the option to approve the sign-in with a prompt on the phone or tablet',
      );
      await pageSettled(page);
      if (!onDevicePrompt(page)) {
        throw failure(
          `the operator was ready, and choosing Google's phone method showed ${page.url()} instead of the device prompt`,
          'google_phone_prompt_not_shown',
        );
      }
      repageOperatorRequest(
        request.id,
        said(
          `Google's prompt was sent at ${new Date().toISOString()}: approve it on your phone now.`,
          await numberToMatch(page),
        ),
      );
    }
    let pageAnswer = watchDevicePrompt(page, await announcedNow(page));
    let answer = null;
    while (!answer) {
      const outcome = await nextApprovalEvent(pageAnswer, request.id, seen);
      if (outcome.page?.alert) {
        if (
          !(await pageShows(
            page,
            'Does the page offer sending the sign-in prompt to the phone again?',
          ))
        ) {
          answer = { refused: true, detail: outcome.page.detail };
          break;
        }
        // The prompt expired: the operator was not there in time, and nothing
        // about the account changed. He is asked again through the channels
        // he chose, and the run keeps waiting for his answer.
        const at = new Date().toISOString();
        repageOperatorRequest(
          request.id,
          `Google's prompt expired at ${at} before it was approved (${outcome.page.detail}); answer not-received for a new one: ${notReceived}, or Weles Desktop > Running.`,
        );
        console.log(
          `[google_sso] operator request ${request.id}: Google's prompt expired at ${at}; the operator is asked again`,
        );
        pageAnswer = watchDevicePrompt(page, await announcedNow(page));
        continue;
      }
      if (outcome.page) {
        answer = outcome.page;
        break;
      }
      seen++;
      if (outcome.operator.answer === 'ready') {
        noteOperatorRequest(
          request.id,
          'The operator answered ready while Google already shows its prompt; approve it on the phone, or answer not-received for a new one',
        );
        continue;
      }
      if (outcome.operator.answer === 'not_received') {
        if (
          !(await pageShows(
            page,
            'Does the page offer sending the sign-in prompt to the phone again?',
          ))
        ) {
          throw failure(
            `the operator received no Google prompt, and Google offers no way to send it again on ${page.url()}`,
            'google_prompt_not_received',
          );
        }
        await clickDescribed(
          page,
          'the control that sends the sign-in prompt to the phone again',
        );
        noteOperatorRequest(
          request.id,
          'The operator asked for a new prompt; the run pressed Google\'s "Resend it" and waits again',
        );
        console.log(
          `[google_sso] operator request ${request.id}: Google asked to resend the prompt`,
        );
        pageAnswer = watchDevicePrompt(page, await announcedNow(page));
        continue;
      }
      const shown = (await page.locator('body').innerText())
        .replace(/\s+/g, ' ')
        .trim();
      noteOperatorRequest(
        request.id,
        `The operator approved on the phone, and Google still shows ${page.url()}: ${shown}`,
      );
      console.log(
        `[google_sso] operator request ${request.id}: operator approved, Google still on the device prompt`,
      );
    }
    await pageSettled(page);
    if (answer.ended) {
      throw failure(
        `Google ended the sign-in on ${answer.detail} while it waited for the phone approval asked at ${request.opened_at}; nothing about the account changed, and a new run of the same action starts the sign-in again`,
        'google_sign_in_ended_during_approval',
      );
    }
    if (answer.refused) {
      throw failure(
        `Google did not complete the device prompt: ${answer.detail}`,
        'google_push_not_approved',
      );
    }
    closeOperatorRequest(
      request.id,
      true,
      'Google completed the device prompt; the sign-in flow continues',
    );
    return true;
  } catch (error) {
    error.second_factor = { required: true, method: 'phone' };
    closeOperatorRequest(
      request.id,
      false,
      `Google phone approval did not complete: ${error.message}`,
    );
    throw error;
  }
}
