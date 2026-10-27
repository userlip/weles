// GET /healthz: what this build is and what it is doing, answered before any
// route can refuse, and without a token, so it names nothing but the build,
// its routes and the runs a restart would end.
import { constants as http } from 'node:http2';
import { ALLOW_RAW_CREDS, ALLOW_UNAUTH, TOKEN } from '../../configuration.mjs';
import { json } from '../../http-exchange.mjs';
import { RUN_RELEASE_IDENTITY } from '../../release-identity.mjs';
import { listRunningRuns } from '../../run/running-runs.mjs';

/** Every route this worker answers, as a caller names it. */
const ROUTES = Object.freeze([
  'GET /healthz',
  'GET /api/v1/version',
  'POST /api/v1/credential-operations',
  'POST /api/v1/tasks',
  'GET /api/v1/tasks/:task_id',
  'GET /api/v1/tasks/:task_id?wait=terminal',
  'POST /api/v1/tasks/:task_id/cancel',
  'GET /worker/version',
  'GET /worker/status',
  'POST /worker/start',
  'POST /worker/stop',
  'POST /worker/restart',
  'POST /run',
  'GET /runs',
  'GET /runs/:run_id',
  'POST /runs/:run_id/answer',
  'POST /runs/:run_id/cancel',
  'GET /diagnostics/:run_id',
  'GET /diagnostics/:run_id/file?path=',
  'POST /weles-builder',
  'POST /reauth/resolve',
  'POST /reauth',
  'POST /reauth/enrol-authenticator',
  'POST /reauth/authorize',
  'POST /subscriptions/acquire',
  'POST /reauth/accounts',
  'POST /google-ads/keyword-volume',
  'POST /google-ads/keyword-report',
  'POST /pages/snapshot',
  'POST /pages/form-export',
  'POST /records/accounts/list',
  'POST /records/accounts/get',
  'POST /records/accounts/upsert',
  'POST /records/accounts/update',
  'POST /records/settings/get',
  'POST /records/settings/set',
  'POST /records/services/list',
]);

export function isHealthRoute(req, url) {
  return req.method === 'GET' && url.pathname === '/healthz';
}

export function respondToHealth(res, publicTaskHealth) {
  const version = process.env.WELES_WORKER_RELEASE_VERSION;
  const sha256 = process.env.WELES_WORKER_RELEASE_SHA256;
  json(res, http.HTTP_STATUS_OK, {
    ok: true,
    source: 'weles_api',
    authConfigured: Boolean(TOKEN || ALLOW_UNAUTH),
    rawCredsAllowed: ALLOW_RAW_CREDS,
    // The release the launcher installed, when it states one.
    ...(version ? { releaseVersion: version } : {}),
    ...(sha256 ? { releaseSha256: sha256 } : {}),
    // Which sources answer here. A deployer that moved this host to a
    // revision has no other way to prove the process serving the port is the
    // one it built.
    sourceRevision: RUN_RELEASE_IDENTITY.source_revision,
    // The runs a restart of this process would end, read by Stado's replace
    // delivery before it restarts the worker, so a release does not land on
    // a sign-in waiting for the operator. Only what names a run is said here,
    // because this route takes no token.
    in_flight: listRunningRuns().map(
      ({ run_id, action, kind, started_at }) => ({
        run_id,
        action,
        kind,
        started_at,
      }),
    ),
    routes: ROUTES,
    publicTask: publicTaskHealth,
    features: ['subscription_identity', 'fresh_profile'],
    account_source: 'skarbiec',
  });
}
