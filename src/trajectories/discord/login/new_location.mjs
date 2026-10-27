// Discord's new-location check: a login from an address Discord has not
// seen is answered with ACCOUNT_LOGIN_VERIFICATION_EMAIL, and a mail to the
// login carries a click.discord.com link that redirects to the authorize-ip
// page. Opening that page posts the authorization.
import { responseAfterAction } from '../../_shared/page/settled.mjs';
import { messagesTo } from '../../../_shared/mail/skrzynka-inbox.mjs';

/** Whether the login API answer asks for the new-location check. */
export function asksNewLocation(answer) {
  const errors = answer.data?.errors?.login?._errors;
  return (
    Array.isArray(errors) &&
    errors.some((e) => e.code === 'ACCOUNT_LOGIN_VERIFICATION_EMAIL')
  );
}

/** The authorize-ip address a click.discord.com link redirects to, if any. */
async function authorizeTarget(link) {
  const answer = await fetch(link, { redirect: 'manual' });
  const target = answer.headers.get('location');
  return target?.includes('authorize-ip') ? target : undefined;
}

/**
 * Authorize this login's address from the mail Discord sent for it: the
 * first mail to `login` that was not in the inbox before the attempt
 * (`seenBefore`, by id) and links an authorize-ip page. Refused when no such
 * mail has arrived, and when Discord refuses the authorization.
 */
export async function authorizeNewLocation(s, login, seenBefore) {
  const arrived = (await messagesTo(login, 'discord.com')).filter(
    (mail) => !seenBefore.has(mail.id),
  );
  let target;
  for (const mail of arrived) {
    for (const [link] of mail.body_text.matchAll(
      /https:\/\/click\.discord\.com[^\s"]+/g,
    )) {
      target = await authorizeTarget(link);
      if (target) break;
    }
    if (target) break;
  }
  if (!target)
    throw new Error(
      `DISCORD_NEW_LOCATION_MAIL_MISSING: none of the ${arrived.length} mails to ${login} that arrived since the attempt links an authorize-ip page; run the login again once it is in the inbox`,
    );
  const authorizePage = await s.ctx.newPage();
  try {
    const answer = await responseAfterAction(
      authorizePage,
      (request) =>
        request.url().includes('authorize-ip') && request.method() === 'POST',
      () => authorizePage.goto(target, { waitUntil: 'domcontentloaded' }),
    );
    if (!answer.ok())
      throw Object.assign(
        new Error(
          `Discord IP authorization refused with HTTP ${answer.status()}: ${await answer.text()}`,
        ),
        {
          code: 'DISCORD_IP_AUTHORIZATION_REFUSED',
          requestMethod: 'POST',
          requestUrl: answer.url(),
          status: answer.status(),
        },
      );
  } finally {
    await authorizePage.close();
  }
}
