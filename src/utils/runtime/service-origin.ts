// The origin a Weles process is told to reach a service at: HTTPS, or plain
// HTTP to this machine's own loopback, with no credentials, path, query or
// fragment. One check for every setting that names such an origin.
import { networkInterfaces } from 'node:os';

/** The name reserved for the loopback interface (RFC 6761, section 6.3): https://www.rfc-editor.org/rfc/rfc6761#section-6.3 */
const LOOPBACK_NAME = 'localhost';

/**
 * Whether `hostname` is this machine's own loopback: the reserved name, or an
 * address of an interface the system marks internal. The one judge every
 * Weles setting asks, so no module keeps its own list of loopback spellings.
 */
export function loopbackHost(hostname: string): boolean {
  if (hostname === LOOPBACK_NAME) return true;
  const address = hostname.replace(/^\[(?<inner>.*)\]$/, '$<inner>');
  return Object.values(networkInterfaces()).some((entries) =>
    entries?.some((entry) => entry.internal && entry.address === address),
  );
}

/**
 * The origin `raw` names, read for the setting `name`, or the refusal naming
 * the setting and what is wrong with its value.
 */
export function serviceOrigin(name: string, raw: string | undefined): string {
  const text = raw?.trim();
  if (!text) throw new Error(`missing required ${name}`);
  if (!URL.canParse(text))
    throw new Error(`${name} is not a URL: ${JSON.stringify(text)}`);
  const url = new URL(text);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  )
    throw new Error(
      `${name} must be an origin without credentials, path, query, or fragment`,
    );
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && loopbackHost(url.hostname))
  )
    throw new Error(
      `${name} must use HTTPS, or HTTP to this machine's loopback (localhost or an address of one of its internal network interfaces)`,
    );
  return url.origin;
}
