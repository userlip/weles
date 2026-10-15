// The Semantic Scholar API-key follow-up: the inbox of the identity a key
// request was submitted for is read for Semantic Scholar's key mail, and a key
// it holds is validated and stored in Skarbiec (src/secrets/semantic-scholar-followup.ts).
// The result is kept as the run's service action result.
//
// Env (all optional): SOURCE_ACTION_LOG_ID (the submission to follow; the
// latest completed one when unset), ATTEMPT (which read of the inbox this is),
// SEMANTIC_SCHOLAR_TENANT_ID (the tenant whose Skarbiec holds the key).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { runSemanticScholarKeyFollowup } from '../../../dist/secrets/semantic-scholar-followup.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';

const INDENT = '  ';
const attempt = process.env.ATTEMPT ? Number(process.env.ATTEMPT) : undefined;
if (attempt !== undefined && !Number.isSafeInteger(attempt))
  throw new Error(`ATTEMPT is "${process.env.ATTEMPT}", not a whole number: which read of the inbox this is`);

const result = await runSemanticScholarKeyFollowup(
  process.env.SOURCE_ACTION_LOG_ID ? process.env.SOURCE_ACTION_LOG_ID : undefined,
  attempt,
  process.env.SEMANTIC_SCHOLAR_TENANT_ID ? process.env.SEMANTIC_SCHOLAR_TENANT_ID : null,
);
// The dispatched action's own recordings, where the API server reads results.
const dir = runRecordingsDir();
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'service_action_result.json'), JSON.stringify({ semantic_scholar_key_followup: result }, null, INDENT));

// The follow-up's own outcomes that are not a failure: the key request still
// waits for Semantic Scholar, or the key it sent was validated.
const STANDING = { pending: true, validated: true };
if (!Object.hasOwn(STANDING, result.status)) {
  console.error(`FAIL: ${result.status}: ${result.reason}`);
  process.exitCode = exitStatusFor(new Error(result.reason));
} else {
  console.log(
    JSON.stringify({
      status: result.status,
      validated: result.validated,
      validation_status: result.validation_status,
      vault_item_id: result.vault_item_id,
      vault_field: result.vault_field,
      next_scheduled_at: result.next_scheduled_at,
    }),
  );
}
