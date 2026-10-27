// Apple's two-factor step: the code Stado relays from the account holder's
// session is typed into Apple's code field (one field, or one box per digit),
// and the browser is trusted when Apple offers it. The code is used once,
// inside its capability, and never logged.
import { humanFill, humanType } from '../../../../dist/human/keyboard.js';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

/** Apple's code field: labelled by digit, or one single-character telephone box per digit. */
export const TWO_FACTOR_FIELD =
  'input[aria-label*="digit"], input[aria-label*="Digit"], input[id*="char"], input[type="tel"][maxlength="1"]';

/** Types the code into the field Apple shows; refused when the field cannot take it. */
async function typeCode(scope, page, code) {
  if (!/^\d+$/.test(code))
    throw new Error('APPLE_2FA_CODE_INVALID: the relayed code is not digits');
  const boxes = await scope
    .locator(TWO_FACTOR_FIELD)
    .filter({ visible: true })
    .all();
  const [only, ...rest] = boxes;
  if (!only)
    throw new Error('APPLE_2FA_FIELD_MISSING: Apple shows no code field');
  if (!rest.length) {
    await humanFill(page, only, code);
    return 'one field';
  }
  if (boxes.length !== code.length)
    throw new Error(
      `APPLE_2FA_FIELD_MISMATCH: Apple shows ${boxes.length} code boxes for a ${code.length}-digit code`,
    );
  for (const [index, box] of boxes.entries())
    await humanFill(page, box, code.charAt(index));
  return 'one box per digit';
}

/**
 * Completes the challenge with the code `withCode` hands over inside its
 * capability. Answers how the code was entered and whether Apple's offer to
 * trust the browser was taken.
 */
export async function completeAppleTwoFactorChallenge(
  page,
  frame,
  withCode,
  logPrefix,
) {
  const entered = await withCode((code) => typeCode(frame, page, code));
  await pageSettled(page);
  const trusted = await clickOffered(
    page,
    'the button that trusts this browser after the verification code',
  );
  if (trusted) console.log(`${logPrefix} trusted the browser`);
  return { source: 'capability', entered, trusted };
}
