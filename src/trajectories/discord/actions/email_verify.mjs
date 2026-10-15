// Verify the Discord account's email, through the shared Discord action
// runner (../../_shared/discord/run.mjs): the account, its seat, the ban
// signal and the kept verdict are the runner's.
//
// The inbox has no push or blocking read, so the run never waits for mail.
// It reads the inbox once (../../../_shared/mail/skrzynka-inbox.mjs): a mail
// from discord.com that arrived after the account's last recorded resend and
// links through click.discord.com to discord.com/verify#token=... is opened,
// and the email counts as verified once Discord's own account record
// (/users/@me) says so. Without such a mail the settings' resend control
// (found by the vision model) asks Discord for one; its acknowledgement is
// recorded (metadata.email_verify_requested_at) and the run stops with
// DISCORD_EMAIL_VERIFICATION_PENDING; the next run finds the mail.
import { runDiscordAction } from '../../_shared/discord/run.mjs';
import { readDiscordApi, readDiscordNoContent, readDiscordText } from '../../_shared/discord/response.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled, responseAfterAction } from '../../_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';
import { inboxConfigured, messagesTo } from '../../../_shared/mail/skrzynka-inbox.mjs';

if (!inboxConfigured()) throw new Error('DISCORD_EMAIL_INBOX_UNCONFIGURED: no Skrzynka organization is named, so the verification mail cannot be read');
const posted = (pattern) => (request) => request.method() === 'POST' && pattern.test(new URL(request.url()).pathname);

/** Where a click.discord.com link redirects, when that is discord.com's verify page with a token. */
async function verifyTarget(link) {
  const source = new URL(link);
  if (source.origin !== 'https://click.discord.com' || source.username || source.password)
    throw new Error(`DISCORD_EMAIL_LINK_INVALID: ${link} is not a click.discord.com link`);
  const answer = await fetch(source, { redirect: 'manual' });
  const location = answer.headers.get('location');
  if (!location) {
    if (!answer.ok) throw new Error(`DISCORD_EMAIL_REDIRECT_REFUSED: ${source.href} answered ${answer.status}: ${await answer.text()}`);
    return null;
  }
  const destination = new URL(location, source);
  const trusted =
    destination.origin === 'https://discord.com' &&
    destination.pathname === '/verify' &&
    !destination.username &&
    new URLSearchParams(destination.hash.replace(/^#/, '')).get('token');
  return trusted ? destination.href : null;
}

const CLICK_LINK = /https:\/\/click\.discord\.com[^\s"<>]+/g;
/** The verify address from a discord.com mail that arrived after `requestedAt`, or null. */
async function verifyUrlFromInbox(email, requestedAt) {
  for (const mail of (await messagesTo(email, 'discord.com')).filter((m) => Date.parse(m.received_at) >= requestedAt))
    for (const [link] of mail.body_text.matchAll(CLICK_LINK)) {
      const target = await verifyTarget(link);
      if (target) return target;
    }
  return null;
}

await runDiscordAction({
  action: 'email_verify',
  url: 'https://discord.com/channels/@me',
  act: async (s, acct) => {
    const email = acct.metadata.email;
    if (!email) throw new Error(`DISCORD_EMAIL_MISSING: discord account ${acct.username} records no email`);
    const requestedAt = Date.parse(acct.metadata.email_verify_requested_at);
    const verifyUrl = Number.isFinite(requestedAt) ? await verifyUrlFromInbox(email, requestedAt) : null;
    if (!verifyUrl) {
      await clickDescribed(s.page, 'the user settings button');
      const asked = new Date().toISOString();
      const answer = await responseAfterAction(s.page, posted(/^\/api\/v\d+\/auth\/verify\/resend$/), () =>
        clickDescribed(s.page, 'the button that resends the verification email'),
      );
      await readDiscordNoContent(answer, 'resend_verification_email', 'DISCORD_EMAIL_RESEND');
      updateAccountMetadata(acct.id, { email_verify_requested_at: asked });
      throw new Error(`DISCORD_EMAIL_VERIFICATION_PENDING: Discord acknowledged a new verification mail to ${email}; run again once it is in the inbox`);
    }
    const answer = await responseAfterAction(s.page, posted(/^\/api\/v\d+\/auth\/verify$/), () => s.goto(verifyUrl));
    await readDiscordText(answer, 'verify_email', 'DISCORD_EMAIL_VERIFY');
    await s.goto('https://discord.com/channels/@me');
    await pageSettled(s.page);
    const { verified } = await readDiscordApi(s.page, '/users/@me', 'DISCORD_ACCOUNT');
    if (verified !== true) throw new Error(`DISCORD_EMAIL_VERIFICATION_UNCONFIRMED: Discord's account record still holds ${email} unverified`);
    updateAccountMetadata(acct.id, { email_verified_at: new Date().toISOString() });
    return `${acct.username} verified ${email}`;
  },
});
