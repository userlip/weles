// What a session records about the account it made: the mail the platform
// sends it, and the account row it puts to Skarbiec with the profile URL the
// platform will show and the signatures its cookie jar is bound to.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markSignupSuccess } from '../../../utils/email/domain.js';
import { messagesTo } from '../../../utils/email/skrzynka-inbox.js';
import type { WSession } from '../../wsession.js';
import { putAccount } from '../../../state/skarbiec-records.js';
import { personaSignature, proxySignature } from '../../cookie-jar/binding.js';
import { recordingsDir } from './fingerprint_capture.js';

/** The status a saved account carries when its trajectory states none. */
const CREATED_STATUS = 'created';

/** The profile address each platform shows an account at, for the platforms whose address the username alone gives. */
function profileUrl(
  platform: string,
  username: string,
  name: string | undefined,
): Record<string, string> {
  const handle = name === undefined ? username : name;
  const urls: Record<string, string> = {
    reddit: `https://reddit.com/u/${username}`,
    tiktok: `https://tiktok.com/@${username}`,
    github: `https://github.com/${username}`,
    discord: `https://discord.com/users/${username}`,
    linkedin: `https://linkedin.com/in/${handle.toLowerCase().replace(/\s+/g, '-')}`,
    instagram: `https://instagram.com/${username}`,
    twitter: `https://x.com/${username}`,
  };
  return Object.hasOwn(urls, platform) ? { profile_url: urls[platform] } : {};
}

/**
 * The newest mail Skrzynka holds for `email` from a sender containing
 * `sender` (any sender when empty), once it arrives, as its sender, subject
 * and text: the code, link or instructions in it are the caller's to use. A
 * mail has no clock that ends its delivery, so the mailbox is read again as
 * soon as each reading answers, until the mail arrives or the run is
 * cancelled; a mailbox that fails is refused with what it said.
 */
export async function wsNewestMail(
  s: WSession,
  email: string,
  sender: string,
): Promise<string> {
  const address = s.resolveEnv(email).toLowerCase();
  for (;;) {
    const [newest] = await messagesTo(address, sender.toLowerCase());
    if (newest)
      return `From: ${newest.sender}\nSubject: ${newest.subject}\n\n${newest.body_text}`;
  }
}

/** The session's cookie jar and the signatures it is bound to. */
async function jarRecord(s: WSession): Promise<Record<string, unknown>> {
  const storageState = await s.ctx.storageState();
  const mintedAt = new Date().toISOString();
  return {
    cookies: storageState.cookies,
    storage_state: storageState,
    cookies_updated_at: mintedAt,
    cookies_minted_at: mintedAt,
    cookies_minted_proxy: proxySignature(s.proxyConfig),
    cookies_minted_persona: s.personaConfig
      ? personaSignature(s.personaConfig)
      : null,
  };
}

type Captured = { record: Record<string, unknown>; failure: string | null };

export async function wsSaveAccount(
  s: WSession,
  platform: string,
  data: {
    username: string;
    email: string;
    password: string;
    name?: string;
    status?: string;
  },
): Promise<string> {
  // The account item is the durable result of this trajectory. A platform
  // account that was created but not saved is lost, so an item that could not
  // be written throws instead of answering a string the caller may not read.
  // A session that could not be read does not stop the save: the account is
  // recorded with its credentials and no session (the next login mints one),
  // the cause is kept in the record and said in the answer.
  const username = s.resolveEnv(data.username);
  const email = s.resolveEnv(data.email);
  const password = s.resolveEnv(data.password);
  const name = data.name ? s.resolveEnv(data.name) : undefined;
  const session: Captured = await jarRecord(s).then(
    (record) => ({ record, failure: null }),
    (error: Error) => ({
      record: { session_unreadable: error.message },
      failure: error.message,
    }),
  );
  const metadata = {
    email,
    status: data.status === undefined ? CREATED_STATUS : data.status,
    created_via: 'weles',
    ...session.record,
    proxy: s.proxyConfig,
    persona: s.personaConfig,
    ...profileUrl(platform, username, name),
  };
  const item = putAccount({
    platform,
    username,
    password,
    metadata,
    displayName: name,
  });
  writeFileSync(
    join(recordingsDir(s.label ? s.label : undefined), 'account.json'),
    JSON.stringify({ item, platform, username }, null, ' '),
  );
  // The account is saved either way; a session that was not captured and a
  // signup-success mark that failed are said in the step's answer.
  const saved = session.failure
    ? `account saved: ${item}; session not captured: ${session.failure}`
    : `account saved: ${item}`;
  return markSignupSuccess(email, platform).then(
    () => saved,
    (error: Error) =>
      `${saved}; signup success not marked for ${email}: ${error.message}`,
  );
}
