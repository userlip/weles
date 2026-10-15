// App Store Connect certificates through the API, no browser. xcodebuild
// -allowProvisioningUpdates fails with "your account has reached the maximum
// number of certificates" when the team's cap is hit; this lists every
// certificate so a stale or expired one can be freed.
//
// Env (one of, else the list): REVOKE=<certificateId> deletes that
// certificate; EXPIRE_BUILD=<buildId> expires that build; ASC_PATH=<path>
// prints what that API path answers.
import { exitStatusFor } from '../../../../../dist/cli/usage.js';
import { ascAll, ascRequest } from '../api/client.mjs';

const INDENT = '  ';

try {
  if (process.env.EXPIRE_BUILD) {
    const id = process.env.EXPIRE_BUILD;
    await ascRequest(`/builds/${id}`, {
      method: 'PATCH',
      body: { data: { type: 'builds', id, attributes: { expired: true } } },
    });
    console.log(`EXPIRED build ${id}`);
  } else if (process.env.ASC_PATH) {
    console.log(JSON.stringify(await ascRequest(process.env.ASC_PATH), null, INDENT));
  } else if (process.env.REVOKE) {
    await ascRequest(`/certificates/${process.env.REVOKE}`, { method: 'DELETE' });
    console.log(`REVOKED ${process.env.REVOKE}`);
  } else {
    const rows = (await ascAll('/certificates')).map((c) => ({
      id: c.id,
      type: c.attributes.certificateType,
      name: c.attributes.displayName,
      expiry: c.attributes.expirationDate,
    }));
    rows.sort((a, b) => a.type.localeCompare(b.type));
    console.log(`TOTAL ${rows.length} certificates`);
    for (const row of rows) console.log(`${row.id}\t${row.type}\t${row.expiry}\t${row.name}`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
