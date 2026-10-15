/**
 * Instagram original-post trajectory. Unlike text-only platforms, IG requires
 * a media attachment — Brama's image-model generates one, then the
 * trajectory drives the Create-post flow on instagram.com to upload +
 * caption + share.
 *
 * Organic vs promote is controlled by env POST_PROMOTE (same as other posts).
 * The image is drawn from IMAGE_PROMPT, or from the character's niche so the
 * media matches the persona visually; a character without a niche and no
 * IMAGE_PROMPT is refused rather than given a theme nobody chose.
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
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf, HEALTH_UNREAD } from '../../_shared/auth/ban-signal.mjs';
import { keepVerdict } from '../../_shared/action/verdict.mjs';
import {
  accountCharacter,
  findAccount,
  findProduct,
} from '../../_shared/skarbiec/accounts.mjs';

const INSTAGRAM_ORIGIN = 'https://www.instagram.com/';
const ACTION = process.env.POST_PROMOTE === '1' ? 'post_promote' : 'post';

/**
 * What the post's image shows: IMAGE_PROMPT as stated, else a candid photo
 * of the character's niche. With neither, nothing says what to draw.
 */
function imagePromptFor(character) {
  if (process.env.IMAGE_PROMPT) return process.env.IMAGE_PROMPT;
  if (!character.niche)
    throw new Error(
      `IMAGE_PROMPT is not set and character ${character.name} states no niche: nothing says what the post's image shows`,
    );
  return `${character.niche} photo, authentic amateur aesthetic, natural lighting, mobile phone camera, candid composition, no text or logos`;
}

const acct = await getSocialAccount('instagram');
if (!acct) throw new Error('no active instagram account to post with');

const vaultAccount = findAccount('instagram', acct.username);
const character = accountCharacter(vaultAccount);
if (!character)
  throw new Error(
    `instagram account ${acct.username} has no linked character to post as`,
  );

let product = null;
if (ACTION === 'post_promote') {
  const productId = process.env.PRODUCT_ID || character.promoted_product_id;
  if (!productId)
    throw new Error(
      'post_promote names no product: set PRODUCT_ID or the character promoted_product_id',
    );
  product = findProduct(productId);
  if (!product) throw new Error(`product ${productId} was not found`);
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

const imagePath = await generateImageFile({
  prompt: imagePromptFor(character),
});
console.log(`[instagram:${ACTION}] image file: ${imagePath}`);

/** Keep the run's verdict through the shared writer; a failed write throws. */
function persistBanSignal(signal) {
  return keepVerdict(`instagram_${ACTION}`, acct, signal, {
    character: character.name,
    product: product?.name,
  });
}

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: `instagram_${ACTION}`,
  proxy: proxyUrl,
  persona,
});
// banSignalOf answers HEALTH_UNREAD, with its cause, when detection failed.
try {
  // The account's stored jar, limited to the cookies Instagram's host would
  // be sent; an account with no stored jar has none to inject.
  const instagramHost = new URL(INSTAGRAM_ORIGIN).hostname;
  const storedJar = Array.isArray(acct.metadata?.cookies)
    ? acct.metadata.cookies
    : [];
  const cookies = storedJar.filter((c) => {
    if (typeof c.domain !== 'string') return false;
    const domain = c.domain.replace(/^\./, '');
    return instagramHost === domain || instagramHost.endsWith(`.${domain}`);
  });
  if (cookies.length) await s.ctx.addCookies(cookies);
  await s.goto(INSTAGRAM_ORIGIN);
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
  // and we feed it the generated image path directly. A refused file is
  // kept, so the preview that never shows is reported with its cause.
  let fileChooserError = null;
  s.page.on('filechooser', async (chooser) => {
    try {
      await chooser.setFiles(imagePath);
      console.log(`[instagram] filechooser accepted ${imagePath}`);
    } catch (e) {
      fileChooserError = e;
      console.log(`[instagram] filechooser err: ${e.message}`);
    }
  });

  // Click "Create" in the left sidebar (svg aria-label="New post").
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
  // The create dialog's file selection triggers the filechooser, which the
  // hook above answers with the image path.
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
    .waitFor({ state: 'visible' })
    .catch((error) => {
      if (fileChooserError)
        throw new Error(
          `the create dialog showed no preview because the file chooser refused ${imagePath}: ${fileChooserError.message}`,
          { cause: fileChooserError },
        );
      throw error;
    });
  await pageSettled(s.page);
  // Next through Instagram's own steps (crop, filter) until the caption box
  // shows: Instagram decides how many there are.
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
  // Fill the caption.
  await humanClickLocator(s.page, captionBox);
  await humanType(s.page, caption);
  await pageSettled(s.page);
  // Share, then confirm Instagram reports the post as shared.
  await clickDescribed(s.page, 'the button that shares the new post');
  if (!(await pageShows(s.page, 'Does the page say the post has been shared?')))
    throw new Error(
      `Instagram did not report the post as shared on ${s.page.url()}`,
    );
  await pageSettled(s.page);
  const banSignal = await banSignalOf(
    detectInstagramBanSignals,
    s,
    'after posting',
  );
  if (banSignal.signal === HEALTH_UNREAD)
    throw Object.assign(
      new Error(
        `BAN_SIGNAL_UNREAD: the post was shared, but the account health after it could not be read: ${banSignal.details.error}`,
      ),
      { banSignal },
    );
  await persistBanSignal(banSignal);
  console.log(`[ban-signal] ${banSignal.signal}  PASS: posted`);
} catch (e) {
  const banSignal = e.banSignal
    ? e.banSignal
    : await banSignalOf(detectInstagramBanSignals, s, 'after the failure');
  console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${e.message}`);
  try {
    await persistBanSignal(banSignal);
  } catch (writeError) {
    throw new AggregateError(
      [e, writeError],
      `${e.message}; and its ban signal was not written: ${writeError.message}`,
    );
  }
  throw e;
} finally {
  // The generated image stays in the run's recordings as the post's evidence.
  await s.close();
}
