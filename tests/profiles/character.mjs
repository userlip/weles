import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { WSession } from '../../dist/session/wsession.js';
import { getSocialAccount, resolveAccountSession } from '../../dist/utils/credentials.js';
import { humanClickLocator } from '../../dist/human/mouse.js';
import { loadFreshCookieJarOrFail } from '../../src/trajectories/_shared/auth/cookie-freshness.mjs';
import { pageSettled } from '../../src/trajectories/_shared/page/settled.mjs';
import { updateAccountMetadata } from '../../src/trajectories/_shared/skarbiec/accounts.mjs';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('linkedin-profile');
const { report, request } = evidence;
const { values } = parseArgs({ options: { 'account-id': { type: 'string' } } });
const accountId = values['account-id'];
let failure;
let originalCharacter;
let isolatedAccount;
let connected = false;

async function run(account) {
  const admission = await request('/run', {
    action: 'linkedin_edit_profile',
    account_id: account,
    params: {},
    detached: true,
  });
  assert.ok(admission.value.detached_run, JSON.stringify(admission.value));
  const id = admission.value.detached_run;
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

async function providerProfile(account) {
  const { proxyUrl, persona } = await resolveAccountSession(account);
  const session = await WSession.start({
    label: 'linkedin_profile_real_test_readback',
    proxy: proxyUrl,
    persona,
  });
  try {
    const cookies = loadFreshCookieJarOrFail(account, {
      platform: 'linkedin',
      label: 'linkedin_profile_real_test_readback',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    }).filter((cookie) => /linkedin\.com/.test(cookie.domain));
    assert.ok(
      cookies.length,
      'the fixture has no authenticated LinkedIn cookies',
    );
    assert.ok(
      cookies.every((cookie) => cookie.path),
      'the fixture cookie jar omits a required cookie path',
    );
    await session.ctx.addCookies(cookies);
    await session.page.goto('https://www.linkedin.com/in/me/', {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(session.page);
    const profileUrl = session.page.url();
    const vanity = profileUrl.match(/\/in\/([^/?]+)/)?.pop();
    assert.ok(
      vanity,
      `the provider did not open the fixture profile: ${profileUrl}`,
    );
    const avatar = session.page
      .locator('img[alt*="photo" i]')
      .filter({ visible: true })
      .first();
    const avatarSource = await avatar.getAttribute('src');
    assert.ok(avatarSource, `no visible profile photo at ${profileUrl}`);
    const edit = session.page
      .locator(
        'a[aria-label="Edit profile" i], button[aria-label="Edit profile" i], a[aria-label*="Edit intro" i]',
      )
      .filter({ visible: true })
      .first();
    await humanClickLocator(session.page, edit);
    await pageSettled(session.page);
    const firstName = await session.page
      .locator(
        'input[id*="first-name" i], input[id*="firstName" i], input[name*="firstName" i]',
      )
      .filter({ visible: true })
      .first()
      .inputValue();
    const lastName = await session.page
      .locator(
        'input[id*="last-name" i], input[id*="lastName" i], input[name*="lastName" i]',
      )
      .filter({ visible: true })
      .first()
      .inputValue();
    await session.page.goto(
      `https://www.linkedin.com/in/${vanity}/edit/about/`,
      { waitUntil: 'domcontentloaded' },
    );
    await pageSettled(session.page);
    const about = await session.page
      .locator('textarea')
      .filter({ visible: true })
      .first()
      .inputValue();
    return {
      profileUrl,
      name: `${firstName} ${lastName}`,
      about,
      avatarSource,
    };
  } finally {
    await session.close();
  }
}

try {
  assert.equal(
    hostname(),
    process.env.WELES_TEST_DEDICATED_HOST,
    'run this journey on the Stado-selected dedicated Weles host',
  );
  assert.ok(
    accountId?.trim(),
    '--account-id must name a disposable Skarbiec account',
  );
  process.env.ACCOUNT_ID = accountId;
  isolatedAccount = await getSocialAccount('linkedin');
  assert.equal(
    isolatedAccount?.id,
    accountId,
    'the requested account must exist as a LinkedIn account',
  );
  assert.equal(
    isolatedAccount.metadata.weles_real_test_fixture,
    true,
    'the named account must be a disposable real-test fixture',
  );
  originalCharacter = isolatedAccount.metadata.character;
  assert.ok(
    originalCharacter?.name &&
      originalCharacter?.bio &&
      originalCharacter?.avatar_url,
    'the fixture character needs a full name, About and distinct requested avatar',
  );
  report.fixture = { account_id: accountId, profile: isolatedAccount.username };
  await evidence.connect();
  connected = true;
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);

  const absent = await run(randomUUID());
  assert.equal(absent.ok, false);
  assert.match(
    [absent.error, absent.stdout_tail, absent.stderr_tail].join('\n'),
    /no active linkedin account/,
  );
  report.absent_account = absent;

  const before = await providerProfile(isolatedAccount);
  const written = await run(accountId);
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.match(written.stdout_tail, /avatar uploaded/);
  const after = await providerProfile(isolatedAccount);
  assert.equal(after.name, originalCharacter.name);
  assert.equal(after.about, originalCharacter.bio);
  assert.notEqual(
    after.avatarSource,
    before.avatarSource,
    'the provider profile photo did not change on the disposable account',
  );
  report.provider_before = before;
  report.provider_after = after;
  report.written = written;

  updateAccountMetadata(accountId, {
    character: {
      ...originalCharacter,
      name: undefined,
      avatar_url: undefined,
      training_images: undefined,
    },
  });
  const withoutName = await run(accountId);
  assert.equal(withoutName.ok, true, JSON.stringify(withoutName));
  const keptAccount = await getSocialAccount('linkedin');
  assert.equal(keptAccount.metadata.display_name, originalCharacter.name);
  const stillNamed = await providerProfile(keptAccount);
  assert.equal(stillNamed.name, originalCharacter.name);
  report.missing_name = { run: withoutName, provider: stillNamed };

  updateAccountMetadata(accountId, {
    character: {
      ...originalCharacter,
      name: 'Only',
      avatar_url: undefined,
      training_images: undefined,
    },
  });
  const refused = await run(accountId);
  assert.equal(refused.ok, false);
  assert.match(
    [refused.error, refused.stdout_tail, refused.stderr_tail].join('\n'),
    /LinkedIn needs a first and last name/,
  );
  report.single_name = refused;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  if (isolatedAccount && originalCharacter) {
    try {
      updateAccountMetadata(accountId, { character: originalCharacter });
    } catch (error) {
      report.restore_error = error.message;
      report.status = 'failed';
      failure = error;
    }
  }
  await evidence.finish();
}
if (failure) throw failure;
