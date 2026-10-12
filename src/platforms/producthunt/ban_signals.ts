import type { Page } from 'playwright';
import {
  detectDeclared,
  type BanSignal,
  type ObservedResponse,
} from '../_shared/ban_signals_base.js';

/** Product Hunt's account state, from its structure in signals.json and the judged page. */
export async function detectProductHuntBanSignals(
  page: Page,
  responses?: ObservedResponse[],
): Promise<BanSignal> {
  return detectDeclared('producthunt', page, responses);
}
