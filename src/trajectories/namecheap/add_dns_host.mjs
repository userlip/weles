// Add or remove ONE exact host record on a Namecheap-managed domain.
// Namecheap's only DNS write API (setHosts) replaces the whole zone, so this
// reads every record, changes one exact record, re-sends all records exactly
// as Namecheap answered them, and verifies the zone then holds what was sent.
// A record Namecheap answers without a value the rewrite needs (a TTL, an MX
// preference) or a zone without its email type is refused: the zone is
// production DNS and nothing in it is guessed.
//
// Env (all required): the API access the worker hands the run from Skarbiec
// (NAMECHEAP_API_KEY, NAMECHEAP_API_USER, NAMECHEAP_USERNAME,
// NAMECHEAP_CLIENT_IP), and DNS_ACTION (add or remove), SLD, TLD, NEW_HOST,
// NEW_TYPE, NEW_ADDRESS, NEW_TTL, plus NEW_MXPREF for an MX record.
import { statedChoice, statedText } from '../_shared/inputs/stated.mjs';

const ACCESS = {
  ApiKey: statedText(['NAMECHEAP_API_KEY'], 'the Namecheap API key'),
  ApiUser: statedText(['NAMECHEAP_API_USER'], 'the Namecheap API user'),
  UserName: statedText(['NAMECHEAP_USERNAME'], 'the Namecheap account the domain is in'),
  ClientIp: statedText(['NAMECHEAP_CLIENT_IP'], 'the address Namecheap allows API calls from'),
};
const SLD = statedText(['SLD'], 'the domain name, without its TLD, whose zone changes');
const TLD = statedText(['TLD'], 'the TLD of the domain whose zone changes');
const ACTION = statedChoice(['DNS_ACTION'], { add: true, remove: true }, 'whether the record is added or removed');
const NEW = {
  Name: statedText(['NEW_HOST'], 'the host name of the record'),
  Type: statedText(['NEW_TYPE'], 'the record type, e.g. A or CNAME'),
  Address: statedText(['NEW_ADDRESS'], 'the address the record points to'),
  TTL: statedText(['NEW_TTL'], 'the record TTL in seconds'),
};
if (NEW.Type === 'MX') NEW.MXPref = statedText(['NEW_MXPREF'], 'the preference of the MX record');
const BASE = 'https://api.namecheap.com/xml.response';
const errorOf = (xml) => xml.match(/<Error[^>]*>(?<text>[^<]*)/)?.groups.text;

/** One Namecheap API call; an answer that is not OK throws with its error. */
async function namecheap(command, fields) {
  const body = new URLSearchParams({ ...ACCESS, Command: command, SLD, TLD, ...fields });
  const answer = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const xml = await answer.text();
  if (!answer.ok || !/Status="OK"/.test(xml))
    throw new Error(`${command} refused (HTTP ${answer.status}): ${errorOf(xml) ? errorOf(xml) : xml}`);
  return xml;
}

/** Every host record of the zone, and its email type, as Namecheap answers them. */
async function getHosts() {
  const xml = await namecheap('namecheap.domains.dns.getHosts', {});
  const emailType = xml.match(/EmailType="(?<type>[^"]*)"/)?.groups.type;
  if (!emailType) throw new Error(`getHosts answered no EmailType for ${SLD}.${TLD}; the zone is not rewritten`);
  const hosts = Array.from(xml.matchAll(/<host\b(?<attributes>[^>]*?)\/?>/gi), ({ groups }) => {
    const record = Object.fromEntries(
      Array.from(groups.attributes.matchAll(/(?<key>\w+)="(?<value>[^"]*)"/g), (attribute) => [
        attribute.groups.key,
        attribute.groups.value.replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      ]),
    );
    if (!record.TTL || (record.Type === 'MX' && !record.MXPref))
      throw new Error(
        `getHosts answered ${record.Name} ${record.Type} without the TTL or MX preference a rewrite has to send; the zone is not rewritten`,
      );
    return { Name: record.Name, Type: record.Type, Address: record.Address, TTL: record.TTL, MXPref: record.MXPref };
  });
  return { hosts, emailType };
}

const sameRecord = (h) =>
  h.Name === NEW.Name &&
  h.Type === NEW.Type &&
  h.Address.replace(/\.$/, '') === NEW.Address.replace(/\.$/, '');

const before = await getHosts();
console.log(`getHosts: ${before.hosts.length} records, EmailType=${before.emailType}`);
const exists = before.hosts.some(sameRecord);
if (exists === (ACTION === 'add')) {
  console.log(`NOOP: ${NEW.Name} ${NEW.Type} ${NEW.Address} already ${exists ? 'present' : 'absent'}`);
} else {
  const all = ACTION === 'add' ? [...before.hosts, NEW] : before.hosts.filter((h) => !sameRecord(h));
  const fields = { EmailType: before.emailType };
  // Namecheap numbers the host fields from one.
  for (const [n, h] of [undefined, ...all].entries()) {
    if (!h) continue;
    fields[`HostName${n}`] = h.Name;
    fields[`RecordType${n}`] = h.Type;
    fields[`Address${n}`] = h.Address;
    fields[`TTL${n}`] = h.TTL;
    if (h.Type === 'MX') fields[`MXPref${n}`] = h.MXPref;
  }
  console.log(`setHosts: sending ${all.length} records (${ACTION} ${NEW.Name} ${NEW.Type} ${NEW.Address})`);
  await namecheap('namecheap.domains.dns.setHosts', fields);
  const after = await getHosts();
  const present = after.hosts.some(sameRecord);
  console.log(`verify: ${after.hosts.length} records (was ${before.hosts.length}); exact record present=${present}`);
  if (after.hosts.length !== all.length || present !== (ACTION === 'add'))
    throw new Error(
      `NAMECHEAP_ZONE_UNEXPECTED: ${SLD}.${TLD} holds ${after.hosts.length} records (sent ${all.length}) and the record is ${present ? 'present' : 'absent'}; check the zone`,
    );
  console.log('PASS');
}
