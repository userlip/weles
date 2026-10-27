// The public address this machine's traffic leaves from, as the echo service
// every Weles exit check reads answers it. An answer that is not an address
// throws with what the service said.

import echo from './egress-echo.json' with { type: 'json' };

export const EGRESS_IP_ECHO = echo.url;

export async function egressIp() {
  const answer = await fetch(EGRESS_IP_ECHO);
  const text = (await answer.text()).trim();
  if (!answer.ok || !text)
    throw new Error(
      `EGRESS_IP_UNREAD: ${EGRESS_IP_ECHO} answered HTTP ${answer.status}: ${JSON.stringify(text)}`,
    );
  return text;
}
