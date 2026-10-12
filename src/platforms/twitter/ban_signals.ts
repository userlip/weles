import type { Page } from 'playwright';
import {
  detectDeclared,
  type BanSignal,
  type ObservedResponse,
} from '../_shared/ban_signals_base.js';

/** X's account state, from its structure in signals.json and the judged page. */
export async function detectTwitterBanSignals(
  page: Page,
  responses?: ObservedResponse[],
): Promise<BanSignal> {
  return detectDeclared('twitter', page, responses);
}
