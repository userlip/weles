// Safely add or remove ONE exact host record on a Namecheap-managed domain.
// Namecheap's only DNS write API (setHosts) replaces the whole zone, so this
// reads every record, changes one exact record, re-sends all records, and
// verifies the count changed by exactly one. Credentials come from injected
// environment variables, with weles/.env retained only as a local fallback.
//
// Env/args (all required; the zone is production DNS, so no domain, host,
//   address or TTL is ever assumed): DNS_ACTION (add or remove), SLD, TLD,
//   NEW_HOST, NEW_TYPE, NEW_ADDRESS, NEW_TTL.
import { existsSync, readFileSync } from 'node:fs';
import { statedText } from '../_shared/inputs/stated.mjs';

const envUrl = new URL('../../../.env', import.meta.url);
const env = existsSync(envUrl) ? readFileSync(envUrl, 'utf8') : '';
const cfg = (k) =>
  (process.env[k] || env.match(new RegExp('^' + k + '=(.*)$', 'm'))?.[1] || '')
    .trim()
    .replace(/^"|"$/g, '');
const AK = cfg('NAMECHEAP_API_KEY'),
  AU = cfg('NAMECHEAP_API_USER'),
  UN = cfg('NAMECHEAP_USERNAME'),
  IP = cfg('NAMECHEAP_CLIENT_IP');
if (!AK || !AU || !UN || !IP) {
  console.log('FAIL: missing Namecheap creds');
  process.exit(1);
}

const SLD = statedText(
  ['SLD'],
  'the domain name, without its TLD, whose zone changes',
);
const TLD = statedText(['TLD'], 'the TLD of the domain whose zone changes');
const NEW = {
  Name: statedText(['NEW_HOST'], 'the host name of the record'),
  Type: statedText(['NEW_TYPE'], 'the record type, e.g. A or CNAME'),
  Address: statedText(['NEW_ADDRESS'], 'the address the record points to'),
  TTL: statedText(['NEW_TTL'], 'the record TTL in seconds'),
  MXPref: '10',
};
// The changes this trajectory makes to a zone.
const ACTIONS = { add: {}, remove: {} };
const ACTION = statedText(
  ['DNS_ACTION'],
  'whether the record is added or removed',
);
if (!Object.hasOwn(ACTIONS, ACTION))
  throw new Error(
    `DNS_ACTION is "${ACTION}", not one of ${Object.keys(ACTIONS).join(', ')}; the zone was not touched`,
  );
const BASE = 'https://api.namecheap.com/xml.response';

async function getHosts() {
  const u = `${BASE}?ApiUser=${AU}&ApiKey=${AK}&UserName=${UN}&Command=namecheap.domains.dns.getHosts&ClientIp=${IP}&SLD=${SLD}&TLD=${TLD}`;
  const xml = await (await fetch(u)).text();
  if (!/Status="OK"/.test(xml))
    throw new Error(
      'getHosts not OK: ' + (xml.match(/<Error[^>]*>([^<]*)/)?.[1] || xml),
    );
  const emailType = xml.match(/EmailType="([^"]*)"/)?.[1] || 'MX';
  const hosts = [];
  for (const m of xml.matchAll(/<host\b([^>]*?)\/?>/gi)) {
    const a = Object.fromEntries(
      [...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [
        x[1],
        x[2].replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      ]),
    );
    hosts.push({
      Name: a.Name,
      Type: a.Type,
      Address: a.Address,
      TTL: a.TTL || '1800',
      MXPref: a.MXPref || '10',
    });
  }
  return { hosts, emailType };
}

const before = await getHosts();
console.log(
  `getHosts: ${before.hosts.length} records, EmailType=${before.emailType}`,
);
const matches = (h) =>
  h.Name === NEW.Name &&
  h.Type === NEW.Type &&
  h.Address.replace(/\.$/, '') === NEW.Address.replace(/\.$/, '');
const exists = before.hosts.some(matches);
if (ACTION === 'add' && exists) {
  console.log(`NOOP: ${NEW.Name} ${NEW.Type} ${NEW.Address} already present`);
  process.exit(0);
}
if (ACTION === 'remove' && !exists) {
  console.log(`NOOP: ${NEW.Name} ${NEW.Type} ${NEW.Address} already absent`);
  process.exit(0);
}

const all =
  ACTION === 'add'
    ? [...before.hosts, NEW]
    : before.hosts.filter((host) => !matches(host));
const body = new URLSearchParams({
  ApiUser: AU,
  ApiKey: AK,
  UserName: UN,
  Command: 'namecheap.domains.dns.setHosts',
  ClientIp: IP,
  SLD,
  TLD,
  EmailType: before.emailType,
});
all.forEach((h, i) => {
  const n = i + 1;
  body.set(`HostName${n}`, h.Name);
  body.set(`RecordType${n}`, h.Type);
  body.set(`Address${n}`, h.Address);
  body.set(`TTL${n}`, h.TTL);
  if (h.Type === 'MX') body.set(`MXPref${n}`, h.MXPref);
});
console.log(
  `setHosts: sending ${all.length} records (${ACTION === 'add' ? 'adding' : 'removing'} ${NEW.Name} ${NEW.Type} ${NEW.Address})`,
);
const resXml = await (
  await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
).text();
const ok =
  /<DomainDNSSetHostsResult[^>]*IsSuccess="true"/.test(resXml) ||
  /Status="OK"/.test(resXml);
if (!ok) {
  console.log(
    'FAIL setHosts: ' + (resXml.match(/<Error[^>]*>([^<]*)/)?.[1] || resXml),
  );
  process.exit(1);
}

const after = await getHosts();
const present = after.hosts.some(matches);
const expectedCount = before.hosts.length + (ACTION === 'add' ? 1 : -1);
const expectedPresence = ACTION === 'add';
console.log(
  `verify: ${after.hosts.length} records (was ${before.hosts.length}); exact record present=${present}`,
);
if (after.hosts.length === expectedCount && present === expectedPresence)
  console.log('PASS');
else {
  console.log('WARN: unexpected record count/state — check zone');
  process.exit(1);
}
