import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';

// If we're on a grid (explore, profile, hashtag), open first post first.
async function ensureSinglePost(s) {
  if (!/\/p\/|\/reel\//.test(s.page.url())) {
    const thumb = s.page
      .locator('a[href*="/p/"], a[href*="/reel/"]')
      .filter({ visible: true })
      .first();
    await thumb.waitFor({ state: 'visible' });
    const href = await thumb.getAttribute('href');
    if (href) {
      const postUrl = href.startsWith('http')
        ? href
        : `https://www.instagram.com${href}`;
      await s.goto(postUrl);
      await humanIdlePause('deliberate');
    } else {
      await humanClickLocator(s.page, thumb);
      await humanIdlePause('deliberate');
    }
  }
}

export async function instagramSubmitComment(s, text) {
  await ensureSinglePost(s);
  // Comment textarea — placeholder "Add a comment..." or aria-label "Add a comment...".
  const ta = s.page
    .locator(
      'textarea[aria-label*="comment" i], textarea[placeholder*="comment" i], form textarea',
    )
    .filter({ visible: true })
    .first();
  await ta.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, ta);
  // Older IG hides the textarea inside an "Add a comment" placeholder div
  // that becomes a textarea on focus — humanClick already focused, so type.
  await humanType(s.page, text);
  // The focused comment box posts its text on Enter.
  await s.page.keyboard.press('Enter');
  // Verify state flip — textarea cleared after successful post.
  await s.page.waitForFunction(() => {
    const t = document.querySelector(
      'textarea[aria-label*="comment" i], textarea[placeholder*="comment" i]',
    );
    return !t || (t.value ?? '').length === 0;
  });
}
