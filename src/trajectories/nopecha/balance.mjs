// NopeCHA balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
// The manage page shows credits, not dollars ("remaining / total"); the
// remaining credits are the balance kept. A manage page saying the account
// has no active keys is refused by name.
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { pageShows, shownText } from '../_shared/page/judged/seen.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { nopechaSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'nopecha_balance',
  signIn: await nopechaSignIn(),
  balanceUrl: 'https://nopecha.com/manage',
  readBalance: async (s) => {
    if (await pageShows(s.page, 'Does the page say no active keys were found?'))
      throw new Error(
        `NOPECHA_NO_ACTIVE_KEYS: NopeCHA lists no active key at ${s.page.url()}`,
      );
    const credits = await shownText(
      s.page,
      'number of remaining available credits (the first number of "remaining / total")',
    );
    const number = credits?.replace(/,/g, '').match(/\d+/)?.shift();
    return number === undefined ? null : Number(number);
  },
  persist: (balance) => patchServiceBalance('NopeCHA', balance),
});
