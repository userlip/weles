// Keeper commands answered by a session this run started itself, so a step
// written against keeper commands (Google's sign-in, `./google_sign_in.mjs`)
// drives an in-process browser exactly as it drives a keeper over its socket:
// the same humanized atoms, the same vision-model clicks, the same refusals.

import { answerKeeperCommand } from '../../../../dist/cli/keeper.js';

/**
 * `act(command)` for `session`: resolves the keeper's answer, and throws the
 * refusal with the command and the page it was refused on.
 */
export function sessionAct(session, label) {
  return async (command) => {
    const answer = await answerKeeperCommand(session, label, command);
    if (!answer.ok)
      throw new Error(
        `KEEPER_COMMAND_REFUSED: ${command.action} on ${session.page.url()}: ${answer.error}`,
      );
    return answer;
  };
}
