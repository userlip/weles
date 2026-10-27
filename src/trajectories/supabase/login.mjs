// Supabase dashboard login through the Weles Supabase dashboard login in
// Skarbiec (./sign_in.mjs). Run: node src/trajectories/supabase/login.mjs
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { signInToSupabase } from './sign_in.mjs';

const s = await WSession.start({
  label: 'supabase_login',
  browser: 'chromium',
});
try {
  console.log(`PASS: landed on ${await signInToSupabase(s)}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
