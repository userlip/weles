// Why a domain does not receive mail, read from live DNS so the alert names
// the cause. The one no API can clear: a registrar's WHOIS or
// registrant-contact verification hold repoints the nameservers to
// failed-whois-verification.* / verify-contact-details.* and suspends DNS
// until a person verifies the registrant contact at the registrar.
import dns, { promises as dnsp } from 'node:dns';

// The resolver's answers that a name has no records, as opposed to a lookup
// that failed, which is rethrown with its own code. The codes are the ones
// node:dns declares for those two answers; a server failure is a failed lookup.
const NO_RECORDS = new Set([dns.NOTFOUND, dns.NODATA]);

async function records(lookup) {
  try {
    return await lookup();
  } catch (error) {
    if (NO_RECORDS.has(error.code)) return null;
    throw error;
  }
}

/** The nameserver labels a registrar repoints a domain to while a verification holds it. */
const HOLD_NAMESERVERS = {
  'failed-whois-verification': true,
  'verify-contact-details': true,
};

function onHoldNameserver(host) {
  const [label] = host.toLowerCase().split('.');
  return Object.hasOwn(HOLD_NAMESERVERS, label);
}

/** The cause a domain that does not receive shows in DNS: `{ code, label }`. */
export async function diagnoseBroken(domain) {
  const ns = await records(() => dnsp.resolveNs(domain));
  if (ns === null)
    return {
      code: 'dns_unresolved',
      label: 'the domain does not resolve (NXDOMAIN or no nameservers)',
    };
  if (ns.some(onHoldNameserver))
    return {
      code: 'whois_hold',
      label: `a WHOIS/registrant-contact verification hold: the registrar suspended DNS (ns: ${ns.join(', ')}); a person must verify the registrant contact at the registrar`,
    };
  const mx = await records(() => dnsp.resolveMx(domain));
  if (mx === null || !mx.length)
    return {
      code: 'no_mx',
      label:
        'no inbound MX record: the domain names no server to receive its mail',
    };
  return {
    code: 'mx_present_no_receive',
    label: `MX present (${mx.map((m) => m.exchange).join(', ')}) but the probe mail is not landing: the receiving route or its propagation`,
  };
}
