// Apple Developer ID Application certificate creation: one guarded run
// (guarded/run.mjs) signs the Apple ID into the developer portal once
// (guarded/sign_in.mjs), chooses the certificate type, uploads the request
// and downloads the issued certificate. Stado owns execution and placement.
import { readFileSync } from 'node:fs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { placeRequestFiles } from './create_developer_id/request_files.mjs';
import { runGuarded } from './guarded/run.mjs';
import { signInGuarded } from './guarded/sign_in.mjs';

const PREFIX = '[apple-create-developer-id]';
const ADD_URL = new URL(
  'https://developer.apple.com/account/resources/certificates/add',
);
const ACCOUNT_ROUTE = '/account';

/** On the developer portal's account pages. */
const onDeveloperPortal = (url) =>
  url.hostname === ADD_URL.hostname && url.pathname.startsWith(ACCOUNT_ROUTE);

/** Choose the certificate type, upload the request and save the issued certificate. */
async function createCertificate(page, { csrPath, certificatePath }) {
  await page.goto(ADD_URL.href, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  if (new URL(page.url()).pathname !== ADD_URL.pathname)
    throw new Error(
      `APPLE_CERTIFICATE_ADD_UNAVAILABLE: the portal sent the certificate request to ${page.url()}`,
    );
  await clickDescribed(
    page,
    'the Developer ID Application certificate type option',
  );
  await clickDescribed(
    page,
    'the button that continues past the certificate type choice',
  );
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.waitFor({ state: 'attached' });
  await fileInput.setInputFiles(csrPath);
  console.log(`${PREFIX} CSR_UPLOADED`);
  await pageSettled(page);
  await clickDescribed(
    page,
    'the button that continues after the certificate request upload',
  );
  const download = page.waitForEvent('download');
  await clickDescribed(
    page,
    'the button that downloads the issued certificate',
  );
  await (await download).saveAs(certificatePath);
  console.log(`${PREFIX} CERTIFICATE_SAVED=${certificatePath}`);
}

await runGuarded({
  label: 'apple_create_developer_id',
  prefix: PREFIX,
  act: async (s, guard) => {
    const files = placeRequestFiles(guard.guardId);
    try {
      await s.page.goto(ADD_URL.href, { waitUntil: 'domcontentloaded' });
      await pageSettled(s.page);
      const receipt = await signInGuarded(s, guard, onDeveloperPortal, PREFIX);
      await createCertificate(s.page, files);
      // The certificate is public; it leaves in the run's own result so a
      // caller on another machine receives it without a second channel.
      console.log(
        `CERTIFICATE_BASE64=${readFileSync(files.certificatePath).toString('base64')}`,
      );
      // Certificate issuance, not filling the code, proves Apple accepted it.
      if (receipt)
        console.log(
          `APPLE_TWO_FACTOR_RECEIPT=${JSON.stringify({ ...receipt, provider_accepted: true })}`,
        );
      return `Developer ID Application certificate issued to ${files.certificatePath}`;
    } finally {
      files.cleanup();
    }
  },
});
