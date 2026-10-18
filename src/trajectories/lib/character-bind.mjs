// Binds a freshly registered account to an unbound character stored in Skarbiec.
import {
  characterRecord,
  findAccount,
  findWelesRecordId,
  listAccounts,
  updateAccountMetadata,
} from '../_shared/skarbiec/accounts.mjs';
import { objectMember } from '../_shared/skarbiec/records.mjs';

export async function autoBindCharacter(username, platform) {
  const account = findAccount(platform, username);
  if (!account)
    throw new Error(
      `cannot bind character: no saved ${platform} account for ${username}`,
    );
  const used = new Set(
    listAccounts(platform)
      .map((candidate) => candidate.metadata?.character?.id)
      .filter(Boolean),
  );
  const characterId = findWelesRecordId((document, id) => {
    const context = objectMember(id, document, 'context');
    return (
      context.record_kind === 'character' &&
      context.active !== false &&
      Array.isArray(context.platforms) &&
      context.platforms.includes(platform) &&
      !used.has(id)
    );
  });
  if (!characterId) return { status: 'no_unbound_character', platform };
  const character = characterRecord(characterId);
  updateAccountMetadata(account.id, { character });
  return {
    status: 'bound',
    character_id: character.id,
    character_name: character.name,
  };
}
