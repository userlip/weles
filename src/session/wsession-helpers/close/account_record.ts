// What a session records about the account it made: the verification mail
// it waited for, and the account row it puts to Skarbiec with the profile
// URL the platform will show. Split out of finalize.ts.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markSignupSuccess } from '../../../utils/email/domain.js';
import {
  messagesTo,
  type InboxMessage,
} from '../../../utils/email/skrzynka-inbox.js';
import type { WSession } from '../../wsession.js';
import { putAccount } from '../../../state/skarbiec-records.js';
import { recordingsDir } from './fingerprint_capture.js';

function profileUrl(platform: string, username: string, name?: string): string {
  const urls: Record<string, string> = {
    reddit: `https://reddit.com/u/${username}`,
    tiktok: `https://tiktok.com/@${username}`,
    github: `https://github.com/${username}`,
    discord: `https://discord.com/users/${username}`,
    linkedin: `https://linkedin.com/in/${(name ?? username).toLowerCase().replace(/\s+/g, '-')}`,
    instagram: `https://instagram.com/${username}`,
    twitter: `https://x.com/${username}`,
  };
  return urls[platform] ?? '';
}

export async function wsCheckEmail(
  s: WSession,
  email: string,
  sender: string,
): Promise<string> {
  const addr = s.resolveEnv(email).toLowerCase();
  const senderHint = sender.toLowerCase();
  // Skrzynka answers the newest first; every branch below returns with the
  // first message, so the code read is the one most recently mailed.
  let messages: InboxMessage[];
  try {
    messages = await messagesTo(addr, senderHint);
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  for (const em of messages) {
    const content = `${em.subject}\n${em.body_text}`;
    const verificationMatch = content.match(
      /https:\/\/api-dashboard\.search\.brave\.com\/verification[^\s"'<>\]]+/,
    );
    if (verificationMatch) {
      const verificationURL = verificationMatch[0]
        .replace(/&amp;/g, '&')
        .replace(/[),.;]+$/, '');
      const target = new URL(verificationURL);
      if (
        target.hostname === 'api-dashboard.search.brave.com' &&
        target.pathname === '/verification'
      ) {
        await s.page.goto(target.href, { waitUntil: 'domcontentloaded' });
        return `verification email opened on ${target.origin}${target.pathname}`;
      }
    }
    const codes = content.match(/\b\d{5,6}\b/g);
    if (codes) return codes[0];
    return `email received without numeric code: ${content.replace(/\s+/g, ' ').trim()}`;
  }
  return `no email${senderHint ? ` from a sender containing "${senderHint}"` : ''} has arrived at ${addr} yet; call check_email again once the platform has sent it`;
}

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
  let session: Record<string, unknown>;
  let sessionError: string | null = null;
  try {
    const storageState = await s.ctx.storageState();
    session = {
      cookies: storageState.cookies,
      storage_state: storageState,
      cookies_updated_at: new Date().toISOString(),
      cookies_minted_at: new Date().toISOString(),
      cookies_minted_proxy: (s as any)._proxySignature(),
      cookies_minted_persona: (s as any)._personaSignature(),
    };
  } catch (error) {
    sessionError = error instanceof Error ? error.message : String(error);
    session = { session_unreadable: sessionError };
  }
  const metadata = {
    email,
    status: data.status ?? 'created',
    created_via: 'weles',
    ...session,
    proxy: s.proxyConfig ?? null,
    persona: (s as any).personaConfig ?? null,
    profile_url: profileUrl(platform, username, name),
  };
  const item = putAccount({
    platform,
    username,
    password,
    metadata,
    displayName: name,
  });
  writeFileSync(
    join(recordingsDir(s.label || undefined), 'account.json'),
    JSON.stringify({ item, platform, username }, null, 2),
  );
  // The account is saved either way; a session that was not captured and a
  // signup-success mark that failed are said in the step's answer.
  const unsession = sessionError
    ? `; session not captured: ${sessionError}`
    : '';
  try {
    await markSignupSuccess(email, platform);
  } catch (error) {
    return `account saved: ${item}${unsession}; signup success not marked for ${email}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return `account saved: ${item}${unsession}`;
}
