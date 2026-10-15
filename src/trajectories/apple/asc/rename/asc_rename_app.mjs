// App Store Connect: rename an existing app through the API, no browser. The
// app's name lives in appInfoLocalizations.name, per locale; every localization
// of every app info is read, and each whose name differs is patched. DRY=1
// only reads. A rename Apple refuses fails the run, naming each refusal.
//
// Env: BUNDLE (required), NEW_NAME (required unless DRY=1).
import { exitStatusFor } from '../../../../../dist/cli/usage.js';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { ascAll, ascRequest } from '../api/client.mjs';

const BUNDLE = statedText(['BUNDLE'], 'the bundle id of the app to rename');
const DRY = process.env.DRY === '1';
const NEW_NAME = DRY ? process.env.NEW_NAME : statedText(['NEW_NAME'], 'the name the app gets (or DRY=1 to only read)');

try {
  const [app] = await ascAll(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
  if (!app) throw new Error(`ASC_APP_NOT_FOUND: App Store Connect holds no app for bundle ${BUNDLE}`);
  console.log(`APP ${app.id} | name: ${app.attributes.name} | bundle: ${app.attributes.bundleId}`);
  const refused = [];
  for (const info of await ascAll(`/apps/${app.id}/appInfos`)) {
    for (const loc of await ascAll(`/appInfos/${info.id}/appInfoLocalizations`)) {
      console.log(`  appInfo ${info.id} [${info.attributes.state}] loc ${loc.id} ${loc.attributes.locale}: name="${loc.attributes.name}"`);
      if (DRY || !NEW_NAME || loc.attributes.name === NEW_NAME) continue;
      await ascRequest(`/appInfoLocalizations/${loc.id}`, {
        method: 'PATCH',
        body: { data: { type: 'appInfoLocalizations', id: loc.id, attributes: { name: NEW_NAME } } },
      }).then(
        () => console.log(`    -> renamed loc ${loc.attributes.locale} to "${NEW_NAME}"`),
        (error) => refused.push(error),
      );
    }
  }
  if (refused.length) throw new AggregateError(refused, refused.map((error) => error.message).join('; '));
  console.log('DONE');
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
