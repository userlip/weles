// Switching the signed-in Vast session into a team's context. Which team is
// the caller's (VAST_TEAM_NAME); a session left in the personal context would
// host, list or read machines under the wrong owner, so a team that is not
// found, or a switch Vast does not accept, refuses the run.
import { statedText } from '../_shared/inputs/stated.mjs';

export function vastTeamName() {
  return statedText(
    ['VAST_TEAM_NAME'],
    'the Vast team whose context the session works in',
  );
}

export async function switchToTeam(page, teamName) {
  const outcome = await page.evaluate(async (wanted) => {
    const r = await fetch('/api/v0/auth/apikeys/', { credentials: 'include' });
    if (!r.ok) return `the API key list answered HTTP ${r.status}`;
    const keys = (await r.json()).apikeys;
    const team = keys.find(
      (k) => k.key_type === 'team' && k.team_name === wanted,
    );
    if (!team)
      return `no team key named ${wanted} among ${keys.length} API keys`;
    const saved = await fetch('/api/v0/users/save-context/', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context_key_id: team.id }),
    });
    return saved.ok ? null : `save-context answered HTTP ${saved.status}`;
  }, teamName);
  if (outcome)
    throw new Error(
      `the Vast session could not switch to team ${teamName}: ${outcome}`,
    );
}
