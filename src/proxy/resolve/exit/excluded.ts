// Exit address ranges the operator has excluded, with the reason each is
// excluded, kept in Skarbiec's Weles settings as `excluded_exit_ranges`
// ({ ranges: [{ range: "<address>/<prefix>", reason }] }). Read on every
// question, so a range added a moment ago applies now; a setting nobody
// wrote excludes nothing, and a range that is not one is refused by name.
import { BlockList, isIP } from 'node:net';
import { readSetting } from '../../../state/skarbiec-records.js';

type ExcludedRange = { range: string; reason: string };
type ExcludedRanges = { ranges: ExcludedRange[] };

const SETTING = 'excluded_exit_ranges';

function family(address: string): 'ipv4' | 'ipv6' {
  const version = isIP(address);
  if (!version)
    throw new Error(`${SETTING} names ${address}, which is not an address`);
  return version === isIP('::') ? 'ipv6' : 'ipv4';
}

/** The reason `address` is excluded as an exit, or nothing when no declared range holds it. */
export function excludedExitReason(address: string): string | undefined {
  const declared = readSetting<ExcludedRanges>(SETTING, { ranges: [] });
  for (const { range, reason } of declared.ranges) {
    const [network, prefix] = range.split('/');
    if (!/^\d+$/.test(prefix))
      throw new Error(`${SETTING} range ${range} names no prefix length`);
    const blocked = new BlockList();
    blocked.addSubnet(network, Number(prefix), family(network));
    if (blocked.check(address, family(address))) return `${range}: ${reason}`;
  }
  return undefined;
}
