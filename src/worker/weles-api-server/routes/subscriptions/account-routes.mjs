// The two runs Brama orders for one subscription account besides a sign-in.
//
// POST /subscriptions/acquire buys a new provider account: a fresh identity on
// an inbound domain Weles reads, the provider's sign-up, the plan Brama names
// paid with the card Skarbiec holds, the login row and the subscription item
// written to the vault, and the account signed in for Brama. POST
// /reauth/authorize completes one OAuth authorization a coding-agent harness
// started for an account the pool already holds, and answers the provider's
// redirect so the harness mints its own grant.
//
// Both are admitted by Brama's own token, never the general API token, for the
// reason /reauth is: each spends a real browser run on exactly one account and
// the broker decides which. Both answer as /reauth does
// (../trajectory/progress.mjs), ending with `result`.

import { constants as http } from 'node:http2';

import { json, readBody } from '../../http-exchange.mjs';
import { runAdmissionKey } from '../../run/run-outcome.mjs';
import { providersWith, trajectoryPath } from '../../run/process/placement.mjs';
import { runReauth } from '../../run/process/reauth-process.mjs';
import { RUN_RELEASE_IDENTITY } from '../../release-identity.mjs';
import { requireReauthToken } from '../trajectory/reauth-account.mjs';
import { RouteRefusal, answerRefusal } from '../trajectory/refusal.mjs';
import { streamRun } from '../trajectory/progress.mjs';
import { AUTHORIZE_PAGES } from '../../../../trajectories/_shared/subscription-auth/oauth.mjs';

/** The trajectory under src/trajectories/<provider>/ that buys an account:
 * a provider is bought for exactly when it has one. */
const ACQUIRE_TRAJECTORY = 'account/acquire';

/** The host a harness's own callback listener answers on. */
const HARNESS_CALLBACK_HOST = 'localhost';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** The message of a failure, whatever was thrown. */
function failure(error) {
  return error instanceof Error ? error.message : String(error);
}

function invalid(error, message) {
  return new RouteRefusal(http.HTTP_STATUS_BAD_REQUEST, {
    ok: false,
    error,
    message,
  });
}

/** The body of a request Brama's token admits; a RouteRefusal otherwise. */
async function admittedBody(req) {
  requireReauthToken(req);
  try {
    return await readBody(req);
  } catch (error) {
    throw invalid('body_unreadable', failure(error));
  }
}

/**
 * What the run said in its last JSON line, or the failure that it said
 * nothing. A process that failed reports its own failure; otherwise the
 * failure is the one the run stated.
 */
function verdict(out, answer) {
  const said = out.answer;
  if (!said) {
    if (out.failure) return { ok: false, failure: out.failure };
    return {
      ok: false,
      failure: {
        code: 'run_result_missing',
        message: 'the run ended without printing its result line',
      },
    };
  }
  const stated = out.failure ? out.failure : said.failure;
  return {
    ok: out.ok === true && said.ok === true,
    ...(stated ? { failure: stated } : {}),
    ...answer(said),
  };
}

/** Stream one admitted run whose result is its verdict through `answer`. */
function streamVerdict(res, key, identity, start, answer) {
  return streamRun(res, {
    key,
    identity,
    start,
    failed: (error) => ({
      ok: false,
      failure: { code: 'run_failed', message: failure(error) },
    }),
    result: (out) => ({
      run_id: out.run_id,
      stages: out.stages,
      ...verdict(out, answer),
    }),
  });
}

/** The acquisition the request names, refused naming what it lacks. */
function requestedAcquisition(body) {
  const provider = text(body.provider).toLowerCase();
  if (!trajectoryPath(provider, ACQUIRE_TRAJECTORY))
    throw invalid(
      'provider_unsupported',
      `Weles has no src/trajectories/${provider}/${ACQUIRE_TRAJECTORY}.mjs, so it cannot buy a "${provider}" account; it buys accounts of ${providersWith(ACQUIRE_TRAJECTORY).join(', ')}`,
    );
  const stated = {
    subscription_id: text(body.subscription_id),
    plan_tier: text(body.plan_tier),
    reason: text(body.reason),
  };
  const missing = Object.entries(stated)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length)
    throw invalid(
      'acquisition_incomplete',
      `an acquisition names ${missing.join(', ')}; the request did not`,
    );
  return { provider, ...stated };
}

export async function respondToAcquire(req, res) {
  let acquisition;
  try {
    acquisition = requestedAcquisition(await admittedBody(req));
  } catch (error) {
    answerRefusal(res, error);
    return;
  }
  const { provider, subscription_id: subscriptionId } = acquisition;
  // The request names Brama's correlation id, not a member: the member is
  // `<provider>-<account>`, known only once the run has created the account,
  // and travels in the run's own answer as `subscription_id`. The correlation
  // id goes back as `request_id`, so it can never take the member's place.
  const identity = {
    provider,
    request_id: subscriptionId,
    plan_tier: acquisition.plan_tier,
    source_revision: RUN_RELEASE_IDENTITY.source_revision,
  };
  await streamVerdict(
    res,
    runAdmissionKey('acquire', { provider, subscription_id: subscriptionId }),
    identity,
    (publish) =>
      runReauth(provider, null, publish, ACQUIRE_TRAJECTORY, {
        BRAMA_SUBSCRIPTION_ID: subscriptionId,
        WELES_PLAN_TIER: acquisition.plan_tier,
        WELES_ACQUISITION_REASON: acquisition.reason,
      }),
    (said) => ({
      account: said.account,
      subscription_id: said.subscription_id,
      subscription_item: said.subscription_item,
      login_item: said.login_item,
      paid: said.paid,
    }),
  );
}

// The authorize URL is the harness's own: only the provider's authorize page
// is driven, and only a redirect back to the harness's own callback listener
// is answered, so this route cannot be pointed at another site or used to
// send a code anywhere but to the caller that started the authorization.
function authorizeUrlRefusal(provider, value) {
  if (!URL.canParse(value)) return 'authorize_url is not a URL';
  const url = new URL(value);
  const page = AUTHORIZE_PAGES[provider];
  if (`${url.origin}${url.pathname}` !== page)
    return `authorize_url must be ${page}; it is ${url.origin}${url.pathname}`;
  const declared = url.searchParams.get('redirect_uri');
  if (!declared) return 'authorize_url names no redirect_uri';
  if (!URL.canParse(declared))
    return `authorize_url's redirect_uri ${declared} is not a URL`;
  const redirect = new URL(declared);
  if (redirect.hostname !== HARNESS_CALLBACK_HOST)
    return `the authorization must redirect to the harness's own ${HARNESS_CALLBACK_HOST} listener; it redirects to ${redirect.host}`;
  return null;
}

/** The authorization the request names, refused naming what it lacks. */
function requestedAuthorization(body) {
  const provider = text(body.provider).toLowerCase();
  const subscriptionId = text(body.subscription_id);
  const authorizeUrl = text(body.authorize_url);
  if (
    !Object.hasOwn(AUTHORIZE_PAGES, provider) ||
    !subscriptionId ||
    !authorizeUrl
  )
    throw invalid(
      'authorization_incomplete',
      `an authorization names a provider (${Object.keys(AUTHORIZE_PAGES).join(', ')}), a subscription_id and an authorize_url`,
    );
  const refusal = authorizeUrlRefusal(provider, authorizeUrl);
  if (refusal) throw invalid('authorize_url_refused', refusal);
  return { provider, subscriptionId, authorizeUrl };
}

/** The pool account of the subscription, refused with Skarbiec's own refusal. */
function subscriptionAccount(selectLoginAccount, provider, subscriptionId) {
  try {
    return selectLoginAccount(provider, undefined, subscriptionId);
  } catch (error) {
    throw new RouteRefusal(
      http.HTTP_STATUS_CONFLICT,
      {
        ok: false,
        error: error.code,
        stage: 'identity',
        message: error.message,
        ...error.detail,
      },
      { cause: error },
    );
  }
}

export async function respondToAuthorize(req, res, selectLoginAccount) {
  let authorization;
  let account;
  try {
    authorization = requestedAuthorization(await admittedBody(req));
    account = subscriptionAccount(
      selectLoginAccount,
      authorization.provider,
      authorization.subscriptionId,
    );
  } catch (error) {
    answerRefusal(res, error);
    return;
  }
  const { provider, authorizeUrl } = authorization;
  const identity = {
    provider,
    subscription_id: account.subscriptionId,
    login_item: account.loginItem,
    account_ref: account.accountRef,
    source_revision: RUN_RELEASE_IDENTITY.source_revision,
  };
  await streamVerdict(
    res,
    runAdmissionKey('authorize', { provider, authorize_url: authorizeUrl }),
    identity,
    (publish) =>
      runReauth(provider, account, publish, 'account/authorize', {
        WELES_AUTHORIZE_URL: authorizeUrl,
      }),
    (said) => ({ redirect_url: said.redirect_url }),
  );
}

// POST /reauth/accounts: the accounts of one provider the vault's
// subscriptions resolve to, with no secret: subscription id, account and
// login row. A machine that holds no vault of its own (the operator's laptop)
// reads them here to know which accounts its harness lacks, because Weles
// resolves them from the same vault it completes their authorization from.
// Subscriptions that do not resolve are in `errors` with their own refusal.
export async function respondToAccounts(req, res, listLoginAccounts) {
  let provider;
  try {
    provider = text((await admittedBody(req)).provider).toLowerCase();
    if (!Object.hasOwn(AUTHORIZE_PAGES, provider))
      throw invalid(
        'provider_unsupported',
        `Weles lists accounts of ${Object.keys(AUTHORIZE_PAGES).join(', ')}; "${provider}" is not one of them`,
      );
  } catch (error) {
    answerRefusal(res, error);
    return;
  }
  // `errors` holds every subscription of every provider that did not
  // resolve: an unresolved one names no provider account to filter it by.
  const listed = listLoginAccounts();
  json(res, http.HTTP_STATUS_OK, {
    ok: true,
    provider,
    accounts: listed.accounts
      .filter((account) => account.provider === provider)
      .map((account) => ({
        subscription_id: account.subscriptionId,
        account: account.accountRef,
        login_item: account.loginItem,
      })),
    errors: listed.errors,
  });
}
