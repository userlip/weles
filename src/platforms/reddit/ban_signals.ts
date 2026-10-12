/**
 * Reddit ban/rate-limit signal detector.
 *
 * Called at the end of every reddit trajectory to classify the session's
 * final state into a named signal. Writes structured JSON that the worker
 * pool PATCHes into account_action_logs.result.ban_signal so a banned
 * account surfaces as a typed event, not a free-text failure string.
 *
 * Reddit's routes, API answer codes and action endpoints are declared in
 * src/platforms/_shared/signals.json; what the page says — a suspension, the
 * "doing that too much" wait, an email to verify, the logged-out home page,
 * the edge's "blocked by network security" page for the exit IP — is judged
 * by the vision model through the shared detector, in any wording.
 */
import type { Page } from 'playwright';
import {
  detectDeclared,
  type BanSignal,
  type ObservedResponse,
} from '../_shared/ban_signals_base.js';

export type { BanSignal };

export async function detectRedditBanSignals(
  page: Page,
  responses: ObservedResponse[] = [],
): Promise<BanSignal> {
  return detectDeclared('reddit', page, responses);
}
