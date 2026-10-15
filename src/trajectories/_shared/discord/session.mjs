// Seating a Discord account in a browser session: its stored discord.com
// cookies, and its web token, which Discord's web client reads from
// localStorage on discord.com. A cookie or init script the browser refuses
// throws, so a run never goes on signed out without saying why.

/** Whether a browser would send a cookie of `domain` to discord.com. */
function sentToDiscord(domain) {
  return /(^|\.)discord\.com$/.test(domain);
}

export async function seatDiscordAccount(s, acct) {
  const stored = Array.isArray(acct.metadata?.cookies)
    ? acct.metadata.cookies.filter(
        (c) => typeof c.domain === 'string' && sentToDiscord(c.domain),
      )
    : [];
  if (stored.length)
    await s.ctx.addCookies(
      stored.map((c) => ({ ...c, path: c.path ? c.path : '/' })),
    );
  if (acct.metadata?.discord_token)
    await s.ctx.addInitScript((token) => {
      if (location.hostname === 'discord.com')
        localStorage.setItem('token', JSON.stringify(token));
    }, acct.metadata.discord_token);
}
