// What a provider mails to an address Weles reads (Skrzynka, through
// src/_shared/mail/skrzynka-inbox.mjs), for every sign-up and sign-in that
// asks for it: a one-time code or a confirmation link.
//
// The code is the run of `length` digits the mail carries, where `length` is
// what the page's own code field takes: one field's maxlength
// (fieldCodeLength), or the number of one-character boxes a split field is
// drawn as (the caller counts them). No length is assumed here. The link is
// the first one in the mail whose host is the provider's own site or one
// under it.
//
// mailedCode and mailedLink read the newest mail from the provider, for an
// address made for this signup. An address that already holds the
// provider's mail (an account's own address) uses expectMail before the
// step that makes the provider send: the mail read is then one that was not
// there yet.
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
  if (
    !stated ||
    !Number.isInteger(length) ||
    !length ||
    Math.abs(length) !== length
  )
    throw new Error(
      `CODE_FIELD_LENGTH_UNSTATED: the code field states no maxlength (it reads ${JSON.stringify(stated)})`,
    );
  return length;
}

/** The first mail from `sender` to `email` that `wanted` accepts, once it arrives. */
async function arrivedMail(email, sender, wanted) {
  for (;;) {
    const mail = (await messagesTo(email.toLowerCase(), sender)).find(wanted);
    if (mail) return mail;
  }
}

function codeIn(mail, email, sender, length) {
  const found = new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`).exec(
    `${mail.subject}\n${mail.body_text}`,
  );
  if (!found)
    throw new Error(
      `MAILED_CODE_ABSENT: the mail from ${sender} to ${email} ("${mail.subject}") carries no ${length}-digit code`,
    );
  const [digits] = found;
  return digits;
}

function linkIn(mail, email, sender, host) {
  for (const [written] of mail.body_text.matchAll(/https:\/\/[^\s"'<>\]]+/g)) {
    const link = new URL(written.replaceAll('&amp;', '&'));
    if (link.hostname === host || link.hostname.endsWith(`.${host}`))
      return link.href;
  }
  throw new Error(
    `MAILED_LINK_ABSENT: the mail from ${sender} to ${email} ("${mail.subject}") carries no link to ${host}`,
  );
}

/** The code of `length` digits the newest mail from `sender` to `email` carries, once that mail arrives. */
export async function mailedCode(email, sender, length) {
  return codeIn(
    await arrivedMail(email, sender, Boolean),
    email,
    sender,
    length,
  );
}

/** The first link to `host` (or a host under it) in the newest mail from `sender` to `email`, once that mail arrives. */
export async function mailedLink(email, sender, host) {
  return linkIn(await arrivedMail(email, sender, Boolean), email, sender, host);
}

/**
 * The mail `sender` sends to `email` after this call: the messages already
 * there are remembered, and code(length) or link(host) read the first one
 * that is not among them, once it arrives.
 */
export async function expectMail(email, sender) {
  const before = new Set(
    (await messagesTo(email.toLowerCase(), sender)).map((mail) => mail.id),
  );
  const fresh = () =>
    arrivedMail(email, sender, (mail) => !before.has(mail.id));
  return {
    code: async (length) => codeIn(await fresh(), email, sender, length),
    link: async (host) => linkIn(await fresh(), email, sender, host),
  };
}
