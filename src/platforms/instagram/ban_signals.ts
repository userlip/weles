import type { Page } from 'playwright';
import {
  detectDeclared,
  type BanSignal,
  type ObservedResponse,
} from '../_shared/ban_signals_base.js';

/** Instagram's account state, from its structure in signals.json and the judged page. */
export async function detectInstagramBanSignals(
  page: Page,
  responses?: ObservedResponse[],
): Promise<BanSignal> {
  return detectDeclared('instagram', page, responses);
}
