// Rename a Slack app (display name + bot display name) through
// wisent-integrations' `slack/app.rename`, as the app configuration identity
// whose xoxe token is the integrations provider item
// `slack-app-configuration`. Weles holds no Slack token; the bot token could
// not do this anyway (not_allowed_token_type).
//
// Env: APP_ID and NEW_NAME, both required: which app is renamed, and to
// what, are the caller's. A run without the integrations route is a usage
// refusal; a rename the integration refuses fails the run with its cause.
import { exitStatusFor, UsageError } from '../../../dist/cli/usage.js';
import {
  integrationAction,
  integrationsConfigured,
} from '../../_shared/integrations.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';

try {
  const appId = statedText(['APP_ID'], 'the Slack app to rename');
  const newName = statedText(['NEW_NAME'], 'the name the Slack app takes');
  if (!integrationsConfigured())
    throw new UsageError('STADO_INTEGRATION_API_URL and WELES_STADO_INTEGRATION_TOKEN are required');
  const renamed = await integrationAction('slack', 'app.rename', {
    identity: 'app-configuration',
    app_id: appId,
    name: newName,
  });
  console.log(`renamed ${renamed.app_id}: "${renamed.before}" -> "${renamed.after}"`);
  console.log('DONE');
} catch (error) {
  console.log(`FAIL app.rename: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
