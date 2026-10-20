// The Chromium flags of the spis-browser-evidence.1 policy: the browser
// resolves only the one target host, to the one address the caller bound, and
// every background, sync, extension and prefetch channel is off.

/** The policy name WELES_BROWSER_EVIDENCE_POLICY selects. */
export const BROWSER_EVIDENCE_POLICY = 'spis-browser-evidence.1';

/**
 * The flags the policy adds: WELES_BROWSER_EVIDENCE_TARGET_HOST mapped to the
 * first address of WELES_BROWSER_EVIDENCE_TARGET_ADDRESSES_JSON and every
 * other host to nothing. A binding that is missing or malformed is refused
 * naming what it received.
 */
export function evidencePolicyArgs(): string[] {
  const targetHost = process.env.WELES_BROWSER_EVIDENCE_TARGET_HOST;
  const addressesJson =
    process.env.WELES_BROWSER_EVIDENCE_TARGET_ADDRESSES_JSON;
  if (!addressesJson)
    throw new Error(
      'browser-evidence target resolver binding is invalid: WELES_BROWSER_EVIDENCE_TARGET_ADDRESSES_JSON is not set',
    );
  let targetAddresses: unknown;
  try {
    targetAddresses = JSON.parse(addressesJson);
  } catch (error) {
    throw new Error(
      `browser-evidence target resolver binding is invalid: WELES_BROWSER_EVIDENCE_TARGET_ADDRESSES_JSON is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const [address] = Array.isArray(targetAddresses) ? targetAddresses : [];
  if (
    typeof targetHost !== 'string' ||
    !/^[A-Za-z\d.-]+$/.test(targetHost) ||
    typeof address !== 'string' ||
    !/^[\dA-Fa-f:.]+$/.test(address)
  ) {
    // The refusal names what it received, so the caller sees which part of
    // the binding to correct.
    throw new Error(
      `browser-evidence target resolver binding is invalid: host ${JSON.stringify(targetHost)}, addresses ${JSON.stringify(targetAddresses)}`,
    );
  }
  const pinned = address.includes(':') ? `[${address}]` : address;
  return [
    `--host-resolver-rules=MAP ${targetHost} ${pinned},MAP * ~NOTFOUND`,
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-notifications',
    '--disable-sync',
    '--no-pings',
    '--safebrowsing-disable-auto-update',
    '--block-new-web-contents',
    '--disable-external-intent-requests',
    '--disable-features=AutoLaunchProtocolsFromOrigins,EncryptedClientHello,PreconnectOnNavigation,Prerender2,SpeculationRulesPrefetch,ServiceWorkerStaticRouter,BackgroundFetch,PushMessaging,NotificationTriggers,DownloadBubble',
  ];
}
