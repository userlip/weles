// One Discord action as one Discord account: ACCOUNT_USERNAME names it, else
// the active one. The account is seated (its cookies and web token, ./session.mjs),
// the action's page opened, the action run, and the page's ban signal read
// after it (or after the failure) and kept through the shared verdict writer.
// The run fails with the action's cause, and with the verdict write's too
// when that fails; its exit status follows the failure.
import { getSocialAccount, resolveAccountSession } from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { detectDiscordBanSignals } from '../../../../dist/platforms/discord/ban_signals.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { checkReachable } from '../action-runner.mjs';
import { banSignalOf } from '../auth/ban-signal.mjs';
import { keepVerdict } from '../action/verdict.mjs';
import { pageSettled } from '../page/settled.mjs';
import { seatDiscordAccount } from './session.mjs';

/** The Discord account the run acts as, refused when it has no id or no web token. */
async function discordAccount() {
  const named = process.env.ACCOUNT_USERNAME;
  const acct = named ? await getSocialAccount('discord', { username: named }) : await getSocialAccount('discord');
  if (!acct) throw new Error(`DISCORD_ACCOUNT_MISSING: no ${named ? `discord account ${named}` : 'active discord account'} in Skarbiec`);
  if (!acct.id) throw new Error(`DISCORD_ACCOUNT_ID_MISSING: discord account ${acct.username} has no Skarbiec id`);
  if (!acct.metadata || !acct.metadata.discord_token)
    throw new Error(`DISCORD_TOKEN_MISSING: discord account ${acct.username} holds no web token (metadata.discord_token)`);
  return acct;
}

/**
 * Runs `act(s, acct)` on `url` as `discord_<action>`; `act` answers what it
 * did. `run` is kept with the verdict as the run's own parameters.
 */
export async function runDiscordAction({ action, url, run, act }) {
  const label = `discord_${action}`;
  const acct = await discordAccount();
  const { proxyUrl, persona } = await resolveAccountSession(acct);
  const s = await WSession.start({ label, proxy: proxyUrl, persona, targetHost: 'discord.com' });
  let failure;
  try {
    await seatDiscordAccount(s, acct);
    await s.goto(url);
    await pageSettled(s.page);
    checkReachable(s, 'discord');
    const done = await act(s, acct);
    const banSignal = await banSignalOf(detectDiscordBanSignals, s, `after ${action}`);
    if (!banSignal.healthy) throw Object.assign(new Error(`the page reads ${banSignal.signal} after ${action}`), { banSignal });
    await keepVerdict(label, acct, banSignal, run);
    console.log(`[ban-signal] ${banSignal.signal}  PASS: ${done}`);
  } catch (error) {
    failure = error;
    const banSignal = error.banSignal ? error.banSignal : await banSignalOf(detectDiscordBanSignals, s, 'after the failure');
    console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${error.message}`);
    await keepVerdict(label, acct, banSignal, run).catch((writeError) => {
      failure = new AggregateError([error, writeError], `${error.message}; and its ban signal was not kept: ${writeError.message}`);
    });
  } finally {
    await s.close();
  }
  if (failure) process.exitCode = exitStatusFor(failure);
}
