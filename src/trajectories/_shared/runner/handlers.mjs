// Per-action dispatchers receive the prepared session and context and return
// resultValue. Mutations stay on the session; no other state is shared across
// actions.
//
// A promotion (promote, post_promote) is held for review, written to the
// run's pending_review.json and not published, unless the caller supplies
// reviewed text (SVC_TEXT) or states that no review is required
// (REQUIRE_APPROVAL=0).

import {
  generateOrganicComment,
  generatePromoteComment,
  generatePost,
} from '../content/llm.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  humanIdlePause,
  humanScrollPage,
} from '../../../../dist/human/mouse.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

const REVIEW_REQUIRED = process.env.REQUIRE_APPROVAL !== '0';

/**
 * How a promotion names its product: the run's VARIANT, else the
 * character's promotion config; refused when neither states it.
 */
function promotionVariant(character) {
  const stated = process.env.VARIANT?.trim()
    ? process.env.VARIANT
    : character?.promotion_config?.variant;
  if (!stated)
    throw new Error(
      'PROMOTION_VARIANT_REQUIRED: neither VARIANT nor the character promotion config states how the product is named (link or mention)',
    );
  return stated.trim().toLowerCase();
}

function personaOf(character) {
  return {
    name: character.name,
    bio: character.bio,
    personality: character.personality,
    niche: character.niche,
  };
}

/** Write the generated text for review instead of publishing it. */
function holdForReview(label, acct, record) {
  const dir = runRecordingsDir(label);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'pending_review.json'),
    JSON.stringify(
      {
        account_id: acct.id,
        username: acct.username,
        action: label,
        ...record,
        ts: new Date().toISOString(),
      },
      null,
      '  ',
    ),
  );
  console.log(`pending_review: written to ${dir}; review required, not published`);
  return 'pending_review';
}

function surfaceOf(cfg, acct, feed) {
  if (typeof cfg.surfaceLabel === 'function') return cfg.surfaceLabel(acct, feed);
  return cfg.surfaceLabel ? cfg.surfaceLabel : feed;
}

// cfg.scrolls and cfg.dwellMs are the declared observation's: how many
// viewports are read and the idle read time after each, in milliseconds.
// Every browse trajectory passes its declaration's values; a caller without
// them is refused rather than given a count or a pause nobody declared.
export async function handleBrowse(s, cfg) {
  const scrolls = cfg.scrolls;
  if (
    !Number.isSafeInteger(scrolls) ||
    Math.sign(scrolls) === -Math.sign(Number.MAX_VALUE) ||
    !cfg.dwellMs
  ) {
    throw new Error(
      `browse needs the declared observation's scroll count and dwell, got ${JSON.stringify({ scrolls: cfg.scrolls, dwellMs: cfg.dwellMs })}`,
    );
  }
  for (const _ of Array(scrolls).keys()) {
    await humanScrollPage(s.page, 'down');
    await humanIdlePause(cfg.dwellMs);
  }
  return `scrolled ${scrolls}x`;
}

export async function handlePost(s, cfg, ctx) {
  const { acct, character, product, preapprovedText, label, feed } = ctx;
  let text = preapprovedText;
  if (!text) {
    if (!character)
      throw new Error(
        'ACTION_CHARACTER_REQUIRED: no character to write the post as, and no text (SVC_TEXT) supplied',
      );
    text = await generatePost({
      persona: personaOf(character),
      surface: cfg.platform,
      product: product ? product : undefined,
    });
    console.log(`[post-text] ${text}...`);
  }
  if (cfg.action === 'post_promote' && REVIEW_REQUIRED && !preapprovedText)
    return holdForReview(label, acct, {
      surface_label: surfaceOf(cfg, acct, feed),
      product: { name: product.name },
      variant: promotionVariant(character),
      post_text: text,
    });
  if (typeof cfg.submitPost !== 'function')
    throw new Error(
      `cfg.submitPost not provided for ${cfg.platform} ${cfg.action}`,
    );
  await cfg.submitPost(s, text);
  return 'posted';
}

// cfg.pickPost(s), when the platform has one, answers the post the comment
// goes to ({ postTitle, postBody, url }); its failure fails the run. The
// submitter receives that post and the account after the text, and may
// answer the run's result.
export async function handleComment(s, cfg, ctx) {
  const {
    acct,
    character,
    product,
    preapprovedText,
    label,
    feed,
    targetedMode,
  } = ctx;
  const surfaceLabel = surfaceOf(cfg, acct, feed);
  const picked = cfg.pickPost ? await cfg.pickPost(s) : {};
  let text = preapprovedText;
  if (!text) {
    const post = {
      surface: surfaceLabel,
      title: picked.postTitle,
      body: picked.postBody,
    };
    text = product
      ? await generatePromoteComment({
          persona: personaOf(character),
          post,
          product: {
            name: product.name,
            description: product.description,
            variant: promotionVariant(character),
          },
        })
      : await generateOrganicComment({ persona: personaOf(character), post });
    console.log(`[comment-text] ${text}...`);
  } else {
    console.log(
      `[preapproved] using operator-reviewed text (${text.length} chars)`,
    );
  }
  if (cfg.action === 'promote' && REVIEW_REQUIRED && !preapprovedText)
    return holdForReview(label, acct, {
      post_url: picked.url ? picked.url : targetedMode ? feed : null,
      surface_label: surfaceLabel,
      post_title: picked.postTitle,
      post_body: picked.postBody,
      character: { name: character.name, niche: character.niche },
      product: { name: product.name },
      variant: promotionVariant(character),
      comment_text: text,
    });
  const submitter =
    targetedMode && typeof cfg.submitTargetedComment === 'function'
      ? cfg.submitTargetedComment
      : cfg.submitComment;
  if (typeof submitter !== 'function')
    throw new Error(
      `cfg.submitComment not provided for ${cfg.platform} ${cfg.action}`,
    );
  const submitted = await submitter(s, text, picked, acct);
  return typeof submitted === 'string' ? submitted : 'commented';
}
