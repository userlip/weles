// What a provider mails to an address Weles reads (Skrzynka, through
// src/_shared/mail/skrzynka-inbox.mjs), for every sign-up and sign-in that
// asks for it: a one-time code or a confirmation link.
//
// The code is the run of `length` digits the newest mail from the provider
// carries, where `length` is what the page's own code field takes: one
// field's maxlength (fieldCodeLength), or the number of one-character boxes
// a split field is drawn as (the caller counts them). No length is assumed
// here. The link is the first one in the newest mail whose host is the
// provider's own site or one under it.
//
// A mail has no clock that ends its delivery: the mailbox is read again as
// soon as each reading answers, until the mail arrives or the run is
// cancelled. A mailbox that fails, or a mail from the provider that carries
// no such code or link, is refused with what it said.
import { messagesTo } from '../../../_shared/mail/skrzynka-inbox.mjs';

/** How many characters the code `field` (a locator) takes, by its maxlength; refused when it states none. */
export async function fieldCodeLength(field) {
  const stated = await field.getAttribute('maxlength');
  const length = Number(stated);
  if (!stated || !Number.isInteger(length) || !length || Math.abs(length) !== length)
    throw new Error(`CODE_FIELD_LENGTH_UNSTATED: the code field states no maxlength (it reads ${JSON.stringify(stated)})`);
  return length;
}

/** The newest mail from `sender` to `email`, once it arrives. */
async function newestMail(email, sender) {
  for (;;) {
    const [newest] = await messagesTo(email.toLowerCase(), sender);
    if (newest) return newest;
  }
}

/** The code of `length` digits the newest mail from `sender` to `email` carries, once that mail arrives. */
export async function mailedCode(email, sender, length) {
  const code = new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`);
  const newest = await newestMail(email, sender);
  const found = code.exec(`${newest.subject}\n${newest.body_text}`);
  if (!found)
    throw new Error(
      `MAILED_CODE_ABSENT: the newest mail from ${sender} to ${email} ("${newest.subject}") carries no ${length}-digit code`,
    );
  const [digits] = found;
  return digits;
}

/** The first link to `host` (or a host under it) in the newest mail from `sender` to `email`, once that mail arrives. */
export async function mailedLink(email, sender, host) {
  const newest = await newestMail(email, sender);
  for (const [written] of newest.body_text.matchAll(/https:\/\/[^\s"'<>\]]+/g)) {
    const link = new URL(written.replaceAll('&amp;', '&'));
    if (link.hostname === host || link.hostname.endsWith(`.${host}`)) return link.href;
  }
  throw new Error(`MAILED_LINK_ABSENT: the newest mail from ${sender} to ${email} ("${newest.subject}") carries no link to ${host}`);
}
