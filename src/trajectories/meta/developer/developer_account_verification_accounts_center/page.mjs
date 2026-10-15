// What the developer verification page asks for - the terms alone, a phone
// number, Accounts Center, the SMS code - judged by the vision model
// (`_shared/page/judged/seen.mjs`) instead of English phrases.
import { pageShows } from '../../../_shared/page/judged/seen.mjs';

/** What the developer verification page asks for, as the model reads it. */
export async function verificationState(page) {
  return {
    termsOnly: await pageShows(
      page,
      "Does the page only ask to accept Meta's Platform Terms and Developer Policies, without a field for a phone number?",
    ),
    phoneStep: await pageShows(
      page,
      'Does the page ask for a mobile number to send a verification SMS to?',
    ),
    accountsCenterRequired: await pageShows(
      page,
      'Does the page say this action can only be completed in Accounts Center?',
    ),
    smsCode: await pageShows(
      page,
      'Does the page ask for a verification code that was sent by SMS?',
    ),
  };
}
