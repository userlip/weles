// List the Supabase projects the dashboard login can see: signed in through
// ./sign_in.mjs, the projects page's links to /project/<ref> name each
// project's ref, and the link's heading (else its own first line) its name.
// The answer is one PROJECTS_JSON line ([{ ref, name }]); a dashboard that
// links no project fails with what its page shows.
// Run: node src/trajectories/supabase/list_projects.mjs
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { signInToSupabase } from './sign_in.mjs';

const PROJECTS_URL = 'https://supabase.com/dashboard/projects';

const s = await WSession.start({ label: 'supabase_list_projects', browser: 'chromium' });
try {
  await signInToSupabase(s);
  await s.goto(PROJECTS_URL);
  await pageSettled(s.page);
  const projects = await s.page.evaluate(() => {
    const found = new Map();
    for (const link of document.querySelectorAll('a[href*="/project/"]')) {
      const ref = new URL(link.href).pathname.match(/\/project\/(?<ref>[^/?#]+)/)?.groups.ref;
      if (!ref || found.has(ref)) continue;
      const heading = link.querySelector('h1, h2, h3, h4, [role="heading"]');
      const [firstLine] = link.innerText.trim().split('\n');
      found.set(ref, { ref, name: heading ? heading.textContent.trim() : firstLine });
    }
    return Array.from(found.values());
  });
  if (!projects.length)
    throw new Error(`SUPABASE_NO_PROJECTS: ${s.page.url()} links no project; it shows: ${await s.page.locator('body').innerText()}`);
  console.log(`PROJECTS_JSON ${JSON.stringify(projects)}`);
  console.log(`PASS: listed ${projects.length} Supabase project(s)`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
