/**
 * Instagram original-post trajectory. Unlike text-only platforms, IG requires
 * a media attachment — Brama's image-model generates one, then the
 * trajectory drives the Create-post flow on instagram.com to upload +
 * caption + share.
 *
 * Organic vs promote is controlled by env POST_PROMOTE (same as other posts).
 * The generated image prompt pulls from the character's niche so the media
 * matches the persona visually.
 */
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickDescribed,
  clickOffered,
  pageShows,
} from '../../_shared/page/judged/seen.mjs';
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { generatePost } from '../../_shared/content/llm.mjs';
import { generateImageFile } from '../../_shared/content/media.mjs';
import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import {
  accountCharacter,
  findAccount,
  findProduct,
} from '../../_shared/skarbiec/accounts.mjs';

const ACTION = process.env.POST_PROMOTE === '1' ? 'post_promote' : 'post';

const acct = await getSocialAccount('instagram');
if (!acct) {
  console.log('FAIL: no active instagram account');
  process.exit(1);
}

const vaultAccount = findAccount('instagram', acct.username);
const character = accountCharacter(vaultAccount);
if (!character) {
  console.log('FAIL: no character linked');
  process.exit(1);
}

let product = null;
if (ACTION === 'post_promote') {
  const productId = process.env.PRODUCT_ID || character.promoted_product_id;
  if (!productId) {
    console.log('FAIL: no product configured for post_promote');
    process.exit(1);
  }
  product = findProduct(productId);
  if (!product) {
    console.log('FAIL: product not found');
    process.exit(1);
  }
}

const personaCtx = {
  name: character.name,
  bio: character.bio,
  personality: character.personality,
  niche: character.niche,
};
const caption =
  process.env.SVC_TEXT ||
  (await generatePost({ persona: personaCtx, surface: 'instagram', product }));
console.log(`[instagram:${ACTION}] caption: ${caption}...`);

const imagePrompt =
  process.env.IMAGE_PROMPT ||
  `${character.niche ?? 'casual lifestyle'} photo, authentic amateur aesthetic, natural lighting, mobile phone camera, candid composition, no text or logos`;
const imagePath = await generateImageFile({ prompt: imagePrompt });
console.log(`[instagram:${ACTION}] image file: ${imagePath}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: `instagram_${ACTION}`,
  proxy: proxyUrl,
  persona,
});
let banSignal = null;
try {
  const cookies = (acct.metadata?.cookies ?? []).filter((c) =>
    (c.domain ?? '').includes('instagram.com'),
  );
  if (cookies.length) await s.ctx.addCookies(cookies);
  await s.goto('https://www.instagram.com/');
  checkReachable(s, 'instagram');
  await pageSettled(s.page);
  const loggedOut = await s.page.evaluate(() =>
    /\/accounts\/login/.test(location.pathname),
  );
  if (loggedOut)
    throw new Error(
      'not_logged_in: cookies stale — needs instagram_login refresh',
    );

  // Hook filechooser: the Create modal calls input[type=file].click() once
  // we click "Select from computer" — Playwright catches the dialog event
  // and we feed it the generated image path directly.
  s.page.on('filechooser', async (chooser) => {
    try {
      await chooser.setFiles(imagePath);
      console.log(`[instagram] filechooser accepted ${imagePath}`);
    } catch (e) {
      console.log(`[instagram] filechooser err: ${e.message}`);
    }
  });

  // 1. Click "Create" in left sidebar (svg aria-label="New post").
  const createBtn = s.page
    .locator(
      'a[href="#"]:has(svg[aria-label="New post"]), div[role="button"]:has(svg[aria-label="New post"])',
    )
    .filter({ visible: true })
    .first();
  await createBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, createBtn);
  await pageSettled(s.page);
  // Some IG variants split creation into a Post / Reel / Story submenu.
  await clickOffered(s.page, 'the Post option of the create menu');
  // 2. The create dialog's file selection triggers the filechooser, which
  //    the hook above answers with the image path.
  await clickDescribed(
    s.page,
    'the button in the create dialog that selects a file from the computer',
  );
  // Wait for crop/preview step — image rendered in modal.
  await s.page
    .locator(
      'div[role="dialog"] img[alt*="image" i], div[role="dialog"] canvas, div[role="dialog"] [style*="background-image"]',
    )
    .first()
    .waitFor({ state: 'visible' });
  await pageSettled(s.page);
  // 3. Next through Instagram's own steps (crop, filter) until the caption
  //    box shows: Instagram decides how many there are.
  const captionBox = s.page
    .locator(
      'div[role="dialog"] textarea[aria-label*="caption" i], div[role="dialog"] div[contenteditable="true"][aria-label*="caption" i], div[role="dialog"] textarea',
    )
    .filter({ visible: true })
    .first();
  while (!(await captionBox.isVisible())) {
    await clickDescribed(
      s.page,
      'the button that goes to the next step of the create dialog',
    );
    await pageSettled(s.page);
  }
  // 5. Fill caption textarea.
  await humanClickLocator(s.page, captionBox);
  await humanType(s.page, caption);
  await pageSettled(s.page);
  // 6. Share, then confirm Instagram reports the post as shared.
  await clickDescribed(s.page, 'the button that shares the new post');
  if (!(await pageShows(s.page, 'Does the page say the post has been shared?')))
    throw new Error(
      `Instagram did not report the post as shared on ${s.page.url()}`,
    );
  await pageSettled(s.page);
  banSignal = await detectInstagramBanSignals(
    s.page,
    s.capturedResponses,
  ).catch(() => null);
  console.log(`[ban-signal] ${banSignal?.signal}  PASS: posted`);
} catch (e) {
  banSignal =
    e.banSignal ??
    (await detectInstagramBanSignals(s.page, s.capturedResponses).catch(
      () => null,
    ));
  console.log(`[ban-signal] ${banSignal?.signal}  FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (banSignal) {
    try {
      const dir = runRecordingsDir(`instagram_${ACTION}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: `instagram_${ACTION}`,
            character: character.name,
            product: product?.name,
            ...banSignal,
            ts: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.log('[ban-signal] persist err:', e.message);
    }
  }
  try {
    unlinkSync(imagePath);
  } catch (e) {
    // The generated image stays on disk; the log names it so it can be found.
    console.log(
      `[instagram:${ACTION}] image removal err: ${imagePath}: ${e.message}`,
    );
  }
  await s.close();
}
