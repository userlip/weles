// Which account a run signs in as, which task it was given, and whether the
// submission is admitted at all.
//
// This is the front of the translation: the blocks that decide the *target* of
// a run — the vault login item for a subscription sign-in, the URL/objective of
// a generic or keeper task, the credential constraints of a run that stores
// what it acquires, the Gmail search, the declared engagement or observation,
// the capture plan, the Semantic Scholar follow-up and the Overleaf project. It
// is separate because it changes whenever the fleet gains a new way to *name*
// what a run should act on, while the action families in the sibling modules
// change when a platform's own verbs change. The Google login readers live in
// ../params/google-login.ts.
//
// Every refusal here is deliberate: a payload naming the wrong account or a
// malformed capture plan throws before anything is spawned, so the caller gets
// the exact sentence instead of a browser launched to discover the problem.

import { basename, dirname } from 'node:path';
import {
  listsSubscriptionsFor,
  selectLoginAccount,
} from '../../utils/login-accounts.js';
import {
  parseAccessibilityAuditParams,
  parseCaptureParams,
} from '../params/capture-params.js';
import {
  googleLogin,
  validateAccountSecurityParams,
  validateAppPasswordParams,
} from '../params/google-login.js';
import { applyDeclaredEnv } from '../declared/declarations.js';

/**
 * The trajectories that store what they acquire in Skarbiec under the run's
 * own credential constraints.
 */
const CREDENTIAL_STORING_RUNS = [
  '/microsoft/recover/reset_password.mjs',
  '/microsoft/recover/verify_password.mjs',
  '/microsoft/recover/adopt_password.mjs',
  '/microsoft/entra/adopt_password.mjs',
  '/microsoft/entra/reset_password.mjs',
  '/microsoft/entra/verify_password.mjs',
  '/slack/provision_user_token.mjs',
];

export function applyAccountAndTaskAdmission(
  params: Record<string, unknown>,
  trajPath: string,
  env: Record<string, string>,
): void {
  // A run in the directory of a provider whose Brama subscriptions Weles
  // lists signs one of those subscriptions in, so it names the exact one.
  const provider = basename(dirname(trajPath));
  if (listsSubscriptionsFor(provider)) {
    const requested = params.login_item;
    const subscriptionId = params.subscription_id;
    if (typeof subscriptionId !== 'string' || !subscriptionId.trim()) {
      throw new Error(
        'subscription_id must name an exact Skarbiec subscription',
      );
    }
    if (requested !== undefined && typeof requested !== 'string') {
      throw new Error('login_item must name an exact Skarbiec login item');
    }
    const account = selectLoginAccount(
      provider,
      requested as string | undefined,
      subscriptionId,
    );
    env.WELES_LOGIN_ITEM = account.loginItem;
    env.BRAMA_SUBSCRIPTION_ID = account.subscriptionId;
    env.WELES_ACCOUNT_REVISION = account.accountRevision;
    env[`${account.provider.toUpperCase()}_DISPLAY_NAME`] = account.displayName;
  }
  if (trajPath.endsWith('/google/authenticator/enrol.mjs')) {
    // The enrolment acts on the Skarbiec login itself: it is what gains the
    // seed, whether or not a subscription or a mailbox rides on it yet.
    env.WELES_LOGIN_ITEM = googleLogin(params);
    if (params.expected_account !== undefined) {
      if (
        typeof params.expected_account !== 'string' ||
        !params.expected_account.trim()
      ) {
        throw new Error(
          'expected_account must name the Google account to enroll',
        );
      }
      env.WELES_EXPECTED_ACCOUNT = params.expected_account.trim();
    }
  }
  if (trajPath.endsWith('/google/app_password/create.mjs')) {
    const { loginItem, organization, expectedAccount } =
      validateAppPasswordParams(params);
    env.WELES_LOGIN_ITEM = loginItem;
    env.SKRZYNKA_ORGANIZATION = organization;
    env.WELES_EXPECTED_ACCOUNT = expectedAccount;
  }
  if (trajPath.endsWith('/google/authenticator/status.mjs')) {
    env.WELES_LOGIN_ITEM = validateAccountSecurityParams(params);
  }
  if (
    trajPath.endsWith('/generic/browser_task.mjs') ||
    trajPath.endsWith('/generic/keeper_task.mjs')
  ) {
    const passthrough: Array<[string, string]> = [
      ['url', 'GENERIC_TASK_URL'],
      ['objective', 'GENERIC_TASK_OBJECTIVE'],
      ['flow_name', 'GENERIC_TASK_FLOW_NAME'],
      ['proxy', 'GENERIC_TASK_PROXY'],
      ['browser', 'GENERIC_TASK_BROWSER'],
      ['os', 'GENERIC_TASK_OS'],
      ['locale', 'GENERIC_TASK_LOCALE'],
      ['session_label', 'GENERIC_TASK_LABEL'],
      ['admin_credential_id', 'GENERIC_TASK_ADMIN_CREDENTIAL_ID'],
    ];
    for (const [key, envKey] of passthrough) {
      const value = params[key];
      if (typeof value === 'string') env[envKey] = value;
    }
    if (params.headless === true || params.headless === '1')
      env.GENERIC_TASK_HEADLESS = '1';
    // People-lifecycle runs reuse one seeded admin session per platform. Derive
    // the canonical WSession label + admin credential id from the platform_key
    // the payload already carries, unless the payload set them explicitly.
    const lifecycleEnv =
      params.env && typeof params.env === 'object'
        ? (params.env as Record<string, unknown>)
        : {};
    const lifecyclePlatform =
      typeof lifecycleEnv.platform_key === 'string'
        ? lifecycleEnv.platform_key
        : '';
    const lifecycleFlow =
      typeof params.flow_name === 'string' ? params.flow_name : '';
    if (lifecyclePlatform && lifecycleFlow.startsWith('people_')) {
      if (!env.GENERIC_TASK_LABEL)
        env.GENERIC_TASK_LABEL = `people-admin-${lifecyclePlatform}`;
      if (!env.GENERIC_TASK_ADMIN_CREDENTIAL_ID)
        env.GENERIC_TASK_ADMIN_CREDENTIAL_ID = `platform-admin-${lifecyclePlatform}`;
    }
    const constraints = params.constraints;
    if (constraints && typeof constraints === 'object')
      env.GENERIC_TASK_CONSTRAINTS = JSON.stringify(constraints);
    const taskEnv = params.env;
    if (taskEnv && typeof taskEnv === 'object')
      env.GENERIC_TASK_ENV = JSON.stringify(taskEnv);
  }
  if (CREDENTIAL_STORING_RUNS.some((run) => trajPath.endsWith(run))) {
    const constraints = params.constraints;
    if (constraints && typeof constraints === 'object') {
      env.WELES_CREDENTIAL_CONSTRAINTS = JSON.stringify(constraints);
    }
  }
  if (trajPath.endsWith('/gmail/gmail_login_search.mjs')) {
    const query = params.query ?? params.q;
    if (typeof query !== 'string' || !query.trim()) {
      throw new Error(
        'GMAIL_QUERY_REQUIRED: query or q must be a nonempty Gmail search query',
      );
    }
    env.GM_QUERY = query;
    // The scoped-secret catalog decides which services exist: the trajectory's
    // read of an undeclared one is refused by name there.
    const credentialService = params.credential_service;
    if (typeof credentialService === 'string' && credentialService.trim())
      env.GM_CREDENTIAL_SERVICE = credentialService;
    const max = countText(params.max);
    if (max !== undefined) env.GM_MAX = max;
    if (params.open === false || String(params.open) === '0')
      env.GM_OPEN = '0';
    else env.GM_OPEN = '1';
  }
  applyDeclaredEnv(params, trajPath, env);
  // The capture actions carry their whole instruction in params, so the
  // contract is parsed HERE: a malformed row fails at dispatch with the exact
  // refusal sentence instead of launching a browser to discover the problem.
  // The trajectory parses the same JSON again from this env var.
  if (trajPath.endsWith('/generic/capture.mjs')) {
    env.GENERIC_CAPTURE_PLAN = JSON.stringify(parseCaptureParams(params));
  }
  if (trajPath.endsWith('/generic/accessibility_audit.mjs')) {
    env.GENERIC_ACCESSIBILITY_AUDIT_PLAN = JSON.stringify(
      parseAccessibilityAuditParams(params),
    );
  }
  if (trajPath.endsWith('/semanticscholar/key_followup.mjs')) {
    const sourceActionLogId = params.source_action_log_id;
    if (typeof sourceActionLogId === 'string')
      env.SOURCE_ACTION_LOG_ID = sourceActionLogId;
    const attempt = countText(params.attempt);
    if (attempt !== undefined) env.ATTEMPT = attempt;
    env.SEMANTIC_SCHOLAR_TENANT_ID =
      typeof params.tenant_id === 'string' ? params.tenant_id : '';
  }
  if (trajPath.endsWith('/overleaf/version_history_ui_phrase.mjs')) {
    const project =
      params.project ?? params.overleaf_project ?? params.project_id;
    if (typeof project === 'string') env.OVERLEAF_PROJECT = project;
    const queryText =
      params.query_text ??
      params.overleaf_query_text ??
      params.phrase ??
      params.overleaf_phrase;
    if (typeof queryText === 'string') {
      env.OVERLEAF_QUERY_TEXT = queryText;
      env.OVERLEAF_PHRASE = queryText;
    }
    const output = params.output_path ?? params.overleaf_output;
    if (typeof output === 'string') env.OVERLEAF_OUTPUT = output;
    const mainTex = params.main_tex ?? params.overleaf_main_tex;
    if (typeof mainTex === 'string') env.OVERLEAF_MAIN_TEX = mainTex;
    const authLabel = params.auth_label ?? params.overleaf_auth_label;
    if (typeof authLabel === 'string') env.OVERLEAF_AUTH_LABEL = authLabel;
    const maxClicks = countText(
      params.max_history_clicks ?? params.overleaf_history_max_clicks,
    );
    if (maxClicks !== undefined) env.OVERLEAF_HISTORY_MAX_CLICKS = maxClicks;
    env.HEADLESS =
      params.headless === false || params.headless === '0' ? '0' : '1';
  }
  if (
    trajPath.endsWith('/overleaf/push_github.mjs') ||
    trajPath.endsWith('/overleaf/pull_github.mjs')
  ) {
    const project =
      params.project ?? params.overleaf_project ?? params.project_id;
    if (typeof project === 'string') env.OVERLEAF_PROJECT = project;
    const repo =
      params.repo_slug ?? params.github_repo ?? params.overleaf_github_repo;
    if (typeof repo === 'string') env.OVERLEAF_GITHUB_REPO = repo;
    const message = params.commit_message ?? params.overleaf_commit_message;
    if (typeof message === 'string') env.OVERLEAF_COMMIT_MESSAGE = message;
    const authLabel = params.auth_label ?? params.overleaf_auth_label;
    if (typeof authLabel === 'string') env.OVERLEAF_AUTH_LABEL = authLabel;
    env.HEADLESS =
      params.headless === false || params.headless === '0' ? '0' : '1';
  }
}

/**
 * A count a caller gave as an integer or as its decimal text, as the text the
 * trajectory's environment carries; anything that is not an integer is no
 * count and leaves the variable unset.
 */
function countText(value: unknown): string | undefined {
  const count =
    typeof value === 'string' && value.trim() ? Number(value) : value;
  return Number.isInteger(count) ? String(count) : undefined;
}
