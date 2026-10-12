// Rename a Slack app (display name + bot display name) through
// wisent-integrations' `slack/app.rename`, as the app configuration identity
// whose xoxe token is the integrations provider item
// `slack-app-configuration`. Weles holds no Slack token; the bot token could
// not do this anyway (not_allowed_token_type).
//
// Env: APP_ID and NEW_NAME, both required: which app is renamed, and to
// what, are the caller's.
import {
  integrationAction,
  integrationsConfigured,
} from '../../_shared/integrations.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';

const APP_ID = statedText(['APP_ID'], 'the Slack app to rename');
const NEW_NAME = statedText(['NEW_NAME'], 'the name the Slack app takes');
if (!integrationsConfigured()) {
  console.log(
    'FAIL: STADO_INTEGRATION_API_URL and WELES_STADO_INTEGRATION_TOKEN are required',
  );
  process.exit(2);
}

try {
  const renamed = await integrationAction('slack', 'app.rename', {
    identity: 'app-configuration',
    app_id: APP_ID,
    name: NEW_NAME,
  });
  console.log(
    `renamed ${renamed.app_id}: "${renamed.before}" -> "${renamed.after}"`,
  );
  console.log('DONE');
} catch (error) {
  console.log(`FAIL app.rename: ${error.message}`);
  process.exit(1);
}
