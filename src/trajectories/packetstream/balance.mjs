// PacketStream balance check via its own login form (no Google SSO), on the
// shared balance run (../_shared/services/balance/run.mjs). The balance is
// read on the dashboard, which must be the signed-in one, not the login page,
// and is written as the proxy record's effective balance.
import { getServiceLogin } from '../../../dist/utils/credentials.js';
import { patchEffectiveBalance } from '../_shared/services/proxy_probe.mjs';
import {
  formSignIn,
  runBalanceCheck,
} from '../_shared/services/balance/run.mjs';

const LOGIN_URL = 'https://app.packetstream.io/login';
const DASH_URL = 'https://app.packetstream.io';
const DISPLAY_NAME = 'PacketStream';

const login = await getServiceLogin(DISPLAY_NAME);
if (!login)
  throw new Error('PACKETSTREAM_LOGIN_ABSENT: no PacketStream login is stored');

await runBalanceCheck({
  label: 'packetstream_balance',
  signIn: formSignIn({
    login,
    loginUrl: LOGIN_URL,
    userField:
      'input[name="username"], input[name="email"], input[autocomplete="username"]',
  }),
  balanceUrl: DASH_URL,
  onBalancePage: (url) =>
    url.origin === new URL(DASH_URL).origin &&
    url.pathname !== new URL(LOGIN_URL).pathname,
  persist: (balance) => patchEffectiveBalance(DISPLAY_NAME, balance),
});
