// The one-time code a provider mails to an address Weles reads (Skrzynka,
// through src/_shared/mail/skrzynka-inbox.mjs), for every sign-up and sign-in
// that asks for one. The code is the run of `length` digits the newest mail
// from the provider carries, where `length` is what the page's own code field
// takes: one field's maxlength (fieldCodeLength), or the number of
// one-character boxes a split field is drawn as (the caller counts them). No
// length is assumed here. A mail has no clock that ends its delivery: the
// mailbox is read again as soon as each reading answers, until the mail
// arrives or the run is cancelled. A mailbox that fails, or a mail from the
// provider that carries no code of that length, is refused with what it said.
import { messagesTo } from '../../../_shared/mail/skrzynka-inbox.mjs';

/** How many characters the code `field` (a locator) takes, by its maxlength; refused when it states none. */
export async function fieldCodeLength(field) {
  const stated = await field.getAttribute('maxlength');
  const length = Number(stated);
  if (!stated || !Number.isInteger(length) || !length || Math.abs(length) !== length)
    throw new Error(`CODE_FIELD_LENGTH_UNSTATED: the code field states no maxlength (it reads ${JSON.stringify(stated)})`);
  return length;
}

/** The code of `length` digits the newest mail from `sender` to `email` carries, once that mail arrives. */
export async function mailedCode(email, sender, length) {
  const code = new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`);
  for (;;) {
    const [newest] = await messagesTo(email.toLowerCase(), sender);
    if (newest) {
      const found = code.exec(`${newest.subject}\n${newest.body_text}`);
      if (!found)
        throw new Error(
          `MAILED_CODE_ABSENT: the newest mail from ${sender} to ${email} ("${newest.subject}") carries no ${length}-digit code`,
        );
      const [digits] = found;
      return digits;
    }
  }
}
