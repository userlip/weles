// Creates the App Store Connect app record for a bundle id, registering the
// bundle id first when App Store Connect does not hold it. The bundle id, the
// app's name, SKU, platform and primary locale are the caller's; an app is
// never registered under one written here.
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { ascAll, ascRequest } from './api/client.mjs';

const BUNDLE = statedText(['ASC_BUNDLE'], 'the bundle id the app is registered for');
const NAME = statedText(['ASC_APP_NAME'], 'the App Store name of the app');
const SKU = statedText(['ASC_SKU'], 'the SKU App Store Connect records for the app');
const PLATFORM = statedText(['ASC_PLATFORM'], "the bundle id's platform as App Store Connect names it (IOS, MAC_OS, UNIVERSAL)");
const LOCALE = statedText(['ASC_PRIMARY_LOCALE'], "the app's primary locale (e.g. en-US)");

try {
  const [existing] = await ascAll(`/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}`);
  if (existing) console.log(`APP_EXISTS ${existing.id} ${existing.attributes.name}`);
  else {
    let bundle = (await ascAll(`/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE)}`)).find(
      (candidate) => candidate.attributes.identifier === BUNDLE,
    );
    if (bundle) console.log(`bundleId exists: ${bundle.id}`);
    else {
      ({ data: bundle } = await ascRequest('/bundleIds', {
        method: 'POST',
        body: { data: { type: 'bundleIds', attributes: { identifier: BUNDLE, name: NAME, platform: PLATFORM } } },
      }));
      console.log(`bundleId registered: ${bundle.id}`);
    }
    const { data: app } = await ascRequest('/apps', {
      method: 'POST',
      body: {
        data: {
          type: 'apps',
          attributes: { name: NAME, primaryLocale: LOCALE, sku: SKU, bundleId: BUNDLE },
          relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
        },
      },
    });
    console.log(`APP_CREATED ${app.id} ${NAME}`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
