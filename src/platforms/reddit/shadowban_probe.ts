/**
 * Multi-vantage Reddit shadowban probe.
 *
 * Background: Reddit's edge tier has documented false positives where
 * /user/<u>/about.json returns 404 for a healthy account when the request
 * routes through certain residential proxy IPs (see src/trajectories/
 * reddit/health.mjs and DETECTION_ANTIPATTERNS.md). A single about.json
 * 404 is therefore unreliable as a shadowban verdict.
 *
 * This probe spreads the caller's number of independent fetches across as
 * many fresh proxy sticky sessions (no cookies), each via a freshly-launched
 * WSession. The verdict:
 *   - any vantage returns 200 with a valid body -> 'healthy'
 *   - every vantage returns 404                 -> 'shadowbanned'
 *   - anything else (403/429/errors, a mix)     -> 'indeterminate'
 *
 * A vantage that observed nothing names why in `err` (logged_out_read.ts):
 * no residential proxy, a request that did not complete, a body that could
 * not be read, or a 200 whose body is not JSON.
 *
 * Used by:
 *   - src/trajectories/reddit/shadowban_check.mjs (standalone trajectory)
 *   - src/trajectories/reddit/actions/comment/steps/deferred_verify.mjs (deferred verify)
 */

import { statusCode } from '../_shared/http-status.js';
import {
  causeOf,
  field,
  loggedOutRead,
  parsedAnswer,
  Unobserved,
} from './logged_out_read.js';

const HTTP_OK = statusCode('OK');
const HTTP_NOT_FOUND = statusCode('Not Found');

export type ShadowbanVerdict = 'shadowbanned' | 'healthy' | 'indeterminate';

export interface VantageResult {
  /** How many vantages were read before this one. */
  vantage: number;
  /** The about.json HTTP status; absent when no answer arrived. */
  status?: number;
  has_body: boolean;
  exit_ip?: string;
  err?: string;
}

export interface MultiVantageProbeResult {
  verdict: ShadowbanVerdict;
  username: string;
  vantages: VantageResult[];
  ts: string;
}

/** What `reason` left unobserved: its status and exit address when Reddit answered, and why. */
function unobserved(reason: unknown) {
  const read = reason instanceof Unobserved ? reason : undefined;
  return { status: read?.status, exit_ip: read?.exitIp, err: causeOf(reason) };
}

/** The `vantage`-th logged-out read of the profile `url`; an unread vantage throws why. */
async function observeVantage(
  vantage: number,
  url: string,
): Promise<VantageResult> {
  const answer = await loggedOutRead(
    'www.reddit.com',
    url,
    `reddit_shadowban_probe_v${vantage}`,
  );
  const read = { vantage, status: answer.status, exit_ip: answer.exitIp };
  if (answer.status !== HTTP_OK) return { ...read, has_body: false };
  const name = field(field(parsedAnswer(url, answer), 'data'), 'name');
  return { ...read, has_body: typeof name === 'string' && !!name };
}

/** The `vantage`-th read, or what it could not observe and why. */
async function readVantage(
  vantage: number,
  url: string,
): Promise<VantageResult> {
  const [outcome] = await Promise.allSettled([observeVantage(vantage, url)]);
  if (outcome.status === 'fulfilled') return outcome.value;
  return { vantage, has_body: false, ...unobserved(outcome.reason) };
}

/**
 * Probe https://old.reddit.com/user/<username>/about.json from N independent
 * fresh sessions, each with no cookies and a freshly-rolled sticky proxy
 * session. Returns the per-vantage results plus an aggregate verdict.
 *
 * @param username  the reddit username to probe (case-sensitive — pass the
 *                  real handle from /api/me.json, not our stored email-prefix
 *                  username, which Reddit auto-replaces during signup).
 * @param vantages  number of independent vantages to use, the caller's
 *                  choice: each vantage spins up a separate Chromium.
 */
export async function probeShadowban(
  username: string,
  vantages: number,
): Promise<MultiVantageProbeResult> {
  const url = `https://old.reddit.com/user/${encodeURIComponent(username)}/about.json`;
  const results: VantageResult[] = [];
  for (const _vantage of Array.from({ length: vantages }))
    results.push(await readVantage(results.length, url));

  // Tally: one logged-out vantage that sees the profile proves it public;
  // shadowbanned needs every vantage to answer 404, so no count is chosen.
  const notFound = results.filter((r) => r.status === HTTP_NOT_FOUND).length;
  const seen = results.some((r) => r.status === HTTP_OK && r.has_body);

  let verdict: ShadowbanVerdict;
  if (seen) verdict = 'healthy';
  else if (results.length && notFound === results.length)
    verdict = 'shadowbanned';
  else verdict = 'indeterminate';

  return { verdict, username, vantages: results, ts: new Date().toISOString() };
}

/** A comment visibility observation; `err` says why nothing was observed. */
export interface CommentVisibility {
  visible: boolean;
  /** The permalink's HTTP status; absent when no answer arrived. */
  status?: number;
  exit_ip?: string;
  err?: string;
}

/** Whether the comment is in its permalink JSON; a read that observed nothing throws why. */
async function observeComment(
  url: string,
  commentId: string,
  expectedAuthor: string | undefined,
): Promise<CommentVisibility> {
  const answer = await loggedOutRead(
    'old.reddit.com',
    url,
    'reddit_visibility_probe',
  );
  if (!answer.ok)
    throw new Unobserved(
      `the permalink JSON answered HTTP ${answer.status}`,
      answer.status,
      answer.exitIp,
    );
  const node = permalinkComment(parsedAnswer(url, answer));
  const nodeData = field(node, 'data');
  const visible =
    field(node, 'kind') === 't1' &&
    field(nodeData, 'id') === commentId &&
    (!expectedAuthor || field(nodeData, 'author') === expectedAuthor);
  return { visible, status: answer.status, exit_ip: answer.exitIp };
}

/**
 * Single-vantage permalink-JSON visibility check. Used by the deferred
 * post-submit verify path: after the comment was submitted, wait T seconds,
 * then re-fetch the comment's permalink JSON via a fresh proxy with no
 * cookies, and confirm the comment node is present.
 *
 * `visible` is an observation only when `err` is absent: true if the
 * comment node is in the permalink JSON, false if the JSON was read and the
 * node is missing (auto-removed or shadowbanned). A proxy that cannot be
 * resolved, a non-2xx answer (rate limit, block page), a body that cannot
 * be read or is not JSON all set `err`: they say nothing about the comment.
 */
export async function probeCommentVisibility(opts: {
  postPermalinkBase: string; // e.g. 'https://old.reddit.com/r/sub/comments/abc/post-slug'
  commentId: string; // base36 id, e.g. 'oj0vwon'
  expectedAuthor?: string; // optional sanity check
}): Promise<CommentVisibility> {
  const { postPermalinkBase, commentId, expectedAuthor } = opts;
  const url = `${postPermalinkBase.replace(/\/$/, '')}/${commentId}/.json`;
  const [outcome] = await Promise.allSettled([
    observeComment(url, commentId, expectedAuthor),
  ]);
  if (outcome.status === 'fulfilled') return outcome.value;
  return { visible: false, ...unobserved(outcome.reason) };
}

/**
 * The comment node of a permalink JSON document: the first child of the
 * second listing (the first listing is the post).
 */
function permalinkComment(document: unknown): unknown {
  if (!Array.isArray(document)) return undefined;
  const [, comments] = document;
  const children = field(field(comments, 'data'), 'children');
  if (!Array.isArray(children)) return undefined;
  const [node] = children;
  return node;
}
