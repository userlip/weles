/**
 * Shared action runner. Drives browse / organic_comment / promote / post
 * across every platform from a per-platform config.
 *
 * Config shape:
 *   platform:       string ('twitter' | 'instagram' | ...)
 *   action:         'browse' | 'organic_comment' | 'promote' | 'post' | 'post_promote'
 *   feedUrl:        string | (username) => string — landing URL for this action
 *   scrolls:        number — how many idle scrolls for browse
 *   banDetector:    async (page, responses) => BanSignal
 *   submitComment:  async (s, text) => void — deterministic Playwright path for comment/promote
 *   submitPost:     async (s, text) => void — deterministic Playwright path for post/post_promote
 *   inlineRelogin:  optional async (s, acct) => { ok, reason } — mints fresh cookies on this session
 *
 * Reads character + product context from Skarbiec as needed. Writes
 * recordings/<platform>_<action>/ban_signal.json. A run that fails is
 * thrown with its cause after its verdict is written and its session closed.
 */
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { pageSettled } from './page/settled.mjs';
import {
  accountCharacter,
  findAccount,
  findProduct,
} from './skarbiec/accounts.mjs';
import { admitAccountJar } from './action/jar.mjs';
import {
  keepVerdict,
  verdictAfterAction,
  verdictAfterFailure,
} from './action/verdict.mjs';

export { checkReachable } from './action/reachable.mjs';

const HEADLESS =
  process.env.HEADLESS === '1' || process.env.WELES_HEADLESS === '1';

/** The character and product the action speaks with, refused when missing. */
function actionContext(cfg, acct) {
  const vaultAccount = findAccount(cfg.platform, acct.username);
  const character =
    cfg.action === 'browse' ? null : accountCharacter(vaultAccount);
  // A character-less post or comment is accepted when its text is supplied.
  if (cfg.action !== 'browse' && !character && !process.env.SVC_TEXT)
    throw new Error(
      `ACTION_CHARACTER_REQUIRED: ${cfg.platform} account ${acct.username} has no character linked and the run supplies no text (SVC_TEXT)`,
    );
  if (cfg.action !== 'promote' && cfg.action !== 'post_promote')
    return { character, product: null };
  const productId = process.env.PRODUCT_ID || character?.promoted_product_id;
  if (!productId)
    throw new Error(
      `ACTION_PRODUCT_REQUIRED: ${cfg.action} names no product (PRODUCT_ID) and the character promotes none`,
    );
  const product = findProduct(productId);
  if (!product)
    throw new Error(`ACTION_PRODUCT_UNKNOWN: no product ${productId} in Skarbiec`);
  return { character, product };
}

/**
 * Where the action goes: TARGET_URL (full URL) > TARGET_USER (resolved
 * per-platform) > SEARCH_QUERY (resolved to the platform's search) > the
 * config's feed.
 */
function actionFeed(cfg, acct) {
  const { TARGET_URL, TARGET_USER, SEARCH_QUERY } = process.env;
  if (TARGET_URL) return { feed: TARGET_URL, targetedMode: true };
  if (TARGET_USER && cfg.resolveUserUrl)
    return { feed: cfg.resolveUserUrl(TARGET_USER), targetedMode: true };
  if (SEARCH_QUERY && cfg.resolveSearchUrl)
    return { feed: cfg.resolveSearchUrl(SEARCH_QUERY), targetedMode: true };
  return {
    feed:
      typeof cfg.feedUrl === 'function'
        ? cfg.feedUrl(acct.username)
        : cfg.feedUrl,
    targetedMode: false,
  };
}

export async function runAction(cfg) {
  const acct = await getSocialAccount(cfg.platform);
  if (!acct)
    throw new Error(
      `ACTION_ACCOUNT_REQUIRED: no active ${cfg.platform} account in the accounts store`,
    );
  const { character, product } = actionContext(cfg, acct);
  console.log(
    `[${cfg.platform}:${cfg.action}] acct=${acct.username}${character ? ` character=${character.name}` : ''}${product ? ` product=${product.name}` : ''}`,
  );
  const { feed, targetedMode } = actionFeed(cfg, acct);

  const { proxyUrl, persona } = await resolveAccountSession(acct);
  const label = `${cfg.platform}_${cfg.action}`;
  const s = await WSession.start({
    label,
    proxy: proxyUrl,
    persona,
    headless: HEADLESS,
  });
  let banSignal = null;
  let failure = null;
  try {
    const stale = await admitAccountJar({
      s,
      cfg,
      acct,
      label,
      proxyUrl,
      persona,
      siteHost: new URL(feed).hostname,
    });
    if (stale) {
      banSignal = stale.banSignal;
      throw stale.failure;
    }
    // Navigation, Chromium's error page, the SPA settle and assertAuthed
    // live in the shared auth gate, which retries through cfg.inlineRelogin
    // when the first attempt finds the session signed out; a failed gate is
    // thrown with its banSignal.
    const { runAuthGate } = await import('./linkedin/auth-gate.mjs');
    await runAuthGate({ s, cfg, acct, feed, label });

    const { handleBrowse, handlePost, handleComment } = await import(
      './runner/handlers.mjs'
    );
    const ctx = {
      acct,
      character,
      product,
      preapprovedText: process.env.SVC_TEXT,
      label,
      feed,
      targetedMode,
    };
    let resultValue;
    if (cfg.action === 'browse') resultValue = await handleBrowse(s, cfg);
    else if (cfg.action === 'post' || cfg.action === 'post_promote')
      resultValue = await handlePost(s, cfg, ctx);
    else resultValue = await handleComment(s, cfg, ctx);
    // Write-API responses are captured asynchronously: once the page has
    // settled, the bodies still being read are awaited, so the ban detector and
    // write verification read every response the action produced.
    if (cfg.action !== 'browse') {
      await pageSettled(s.page);
      await Promise.all([...s.pendingResponseBodies]);
    }
    banSignal = await verdictAfterAction(s, cfg, resultValue);
    // A verdict that is not healthy after the action is the run's outcome:
    // the action's own answer does not turn it into a PASS.
    if (banSignal && !banSignal.healthy)
      throw new Error(
        `the page reads ${banSignal.signal} after the action (${resultValue})`,
      );
    console.log(`[ban-signal] ${banSignal ? banSignal.signal : 'not read'}`);
    console.log(`PASS: ${resultValue}`);
  } catch (error) {
    failure = error;
    banSignal = await verdictAfterFailure(s, cfg, error, banSignal);
    console.log(`[ban-signal] ${banSignal.signal}`);
    console.error('FAIL:', error.message);
  } finally {
    try {
      if (banSignal) await keepVerdict(label, acct, banSignal);
    } catch (keepError) {
      // A run that already failed keeps its own cause; a passed run whose
      // verdict cannot be kept fails with this one.
      if (!failure) failure = keepError;
      console.error(
        `[ban-signal] the verdict could not be kept: ${keepError.message}`,
      );
    }
    await s.close();
  }
  if (failure) throw failure;
}
