// A platform login run: the active account of the platform, signed in by
// the platform's own `signIn` step, its session kept, its verdict kept.
//
// The account must hold a password; it signs in with its email, or its
// username when it has none. The proxy is the account's pinned one, or
// PROXY_URL ('direct' for none); nothing else is assumed. `session` adds
// WSession options of the platform's own (a target host). Once `signIn`
// returns, the page is read by the platform's ban detector, and only on a
// healthy verdict are the session's cookies kept in the account's record,
// stamped with the proxy and persona they were minted under; cookies that
// are not kept fail the login.
// A `signIn` that knows why the account cannot sign in (a gate, a ban)
// throws with that verdict as `banSignal`. Every outcome is kept through the
// shared verdict writer; a failure is thrown, with the verdict writer's own
// failure beside it when that failed too.
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { persistFreshCookieJar } from '../auth/cookie-freshness.mjs';
import { banSignalOf } from '../auth/ban-signal.mjs';
import { statedProxy } from '../inputs/stated.mjs';
import { keepVerdict, verdictAfterFailure } from './verdict.mjs';

export async function runLogin({ platform, banDetector, session, signIn }) {
  const label = `${platform}_login`;
  const code = platform.toUpperCase();
  const acct = await getSocialAccount(platform);
  if (!acct)
    throw Object.assign(
      new Error(`no active ${platform} account in Skarbiec`),
      {
        code: `${code}_ACCOUNT_UNAVAILABLE`,
      },
    );
  const password = acct.metadata?.password;
  if (!password)
    throw Object.assign(
      new Error(`${platform} account ${acct.username} has no password`),
      {
        code: `${code}_PASSWORD_UNAVAILABLE`,
      },
    );
  const login = acct.metadata.email ? acct.metadata.email : acct.username;
  const { proxyUrl: pin, persona } = await resolveAccountSession(acct);
  const pinned = pin && !process.env.PROXY_URL?.trim();
  const proxyUrl = pinned
    ? pin
    : statedProxy(`the ${platform} login, whose account has no proxy pin,`);
  console.log(
    `[${label}] account ${acct.username} (${login}), ${pinned ? 'its pinned proxy' : `PROXY_URL "${proxyUrl}"`}`,
  );
  const s = await WSession.start({
    label,
    proxy: proxyUrl,
    persona,
    ...session,
  });
  let banSignal;
  let failure;
  try {
    await signIn(s, { acct, login, password, proxyUrl });
    banSignal = await banSignalOf(banDetector, s, 'after logging in');
    if (!banSignal.healthy)
      throw new Error(`the page reads ${banSignal.signal} after logging in`);
    const kept = await persistFreshCookieJar(acct, await s.ctx.cookies(), {
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    if (!kept.ok)
      throw new Error(
        `${code}_SESSION_NOT_KEPT: the signed-in cookies were not stored in ${acct.username}'s record: ${kept.reason}${kept.body ? ` (${kept.body})` : ''}`,
      );
    console.log(
      `[ban-signal] ${banSignal.signal}  PASS: logged in as ${acct.username} at ${s.page.url()}`,
    );
  } catch (error) {
    failure = error;
    banSignal = await verdictAfterFailure(s, { banDetector }, error, banSignal);
    console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${error.message}`);
  } finally {
    try {
      await keepVerdict(label, acct, banSignal);
    } catch (keepError) {
      failure = failure
        ? new AggregateError(
            [failure, keepError],
            `${failure.message}; and its verdict was not kept: ${keepError.message}`,
          )
        : keepError;
    }
    await s.close();
  }
  if (failure) throw failure;
}
