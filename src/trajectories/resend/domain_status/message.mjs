// The Slack-ready summary of one domain health check: how many receive,
// which were re-verified, which were probed for the first time, and each
// broken one with the cause DNS shows for it.

const names = (records) => records.map((r) => r.domain).sort().join(', ');

export function domainHealthMessage(out) {
  const lines = [`*Resend email-domain health* — ${out.healthy.length}/${out.checked} healthy`];
  if (out.healthy.length) lines.push(`:white_check_mark: healthy: ${names(out.healthy)}`);
  if (out.repaired.length) lines.push(`:wrench: auto-repaired (re-verified): ${names(out.repaired)}`);
  if (out.unprobed.length) lines.push(`:hourglass: first probe sent, judged on the next run: ${names(out.unprobed)}`);
  if (out.broken.length) {
    lines.push(':rotating_light: NEEDS A HUMAN:');
    for (const r of out.broken) lines.push(`   • ${r.domain} — ${r.diagnosis.label}`);
  } else if (!out.healthy.length) lines.push(':grey_question: no receiving domains configured');
  return lines.join('\n');
}
