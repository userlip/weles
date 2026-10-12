import type { Page } from 'playwright';
import {
  detectDeclared,
  type BanSignal,
  type ObservedResponse,
} from '../_shared/ban_signals_base.js';

/** GitHub's account state, from its structure in signals.json and the judged page. */
export async function detectGitHubBanSignals(
  page: Page,
  responses?: ObservedResponse[],
): Promise<BanSignal> {
  return detectDeclared('github', page, responses);
}
