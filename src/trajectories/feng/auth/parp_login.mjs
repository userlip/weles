#!/usr/bin/env node
// Automatyczny login do lsi.parp.gov.pl przez reset hasła.
// Email idzie na adres konta PARP (PARP_EMAIL); link resetu czyta Skrzynka
// (skrzynka sync / message list), tylko z poczty od nadawcy PARP_RESET_SENDER
// otrzymanej po wysłaniu prośby. Po resecie zapisuje nowe hasło do
// ~/.weles/parp_login.json. Każda strona jest czytana, gdy się ustali (jak
// strona sama to zgłasza); każdy brak kończy przebieg z nazwaną przyczyną.

import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { registrationPassword } from '../../../../dist/utils/identity/password.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';

const EMAIL = statedText(['PARP_EMAIL'], 'the PARP account address');
// The sender PARP's reset mail comes from, as the caller states it: the reset
// link is read only from that sender's mail.
const RESET_SENDER = statedText(
  ['PARP_RESET_SENDER'],
  "the address PARP's password-reset mail is sent from",
);
const STORE = join(homedir(), '.weles', 'parp_login.json');
const NEW_PASSWORD = registrationPassword();
const LOGIN_URL = 'https://lsi.parp.gov.pl/';
// Skrzynka is run as the program of that name on PATH, as every product
// command is.
const SKRZYNKA = 'skrzynka';

const EMAIL_FIELD =
  'input[type="email"], input[name="email"], input[id*="email" i], input[placeholder*="email" i]';

function logn(msg) {
  console.log(`[parp_login] ${msg}`);
}

async function screenshot(s, name) {
  const path = join(
    runRecordingsDir('parp_login'),
    `parp_${name}_${Date.now()}.png`,
  );
  await s.page.screenshot({ path, fullPage: true });
  logn(`screenshot: ${path}`);
  return path;
}

// Each control is found by the vision model from what it does
// (`_shared/page/judged/seen.mjs`), so a reworded PARP page is still read.
async function clickControl(s, description) {
  logn(`klikam: ${description}`);
  await clickDescribed(s.page, description);
  await pageSettled(s.page);
}

function skrzynka(args) {
  return JSON.parse(execFileSync(SKRZYNKA, args, { encoding: 'utf8' }));
}

function resetMailbox() {
  const mailbox = skrzynka(['mailbox', 'list']).find(
    (m) => m.email.toLowerCase() === EMAIL.toLowerCase(),
  );
  if (!mailbox) {
    throw new Error(
      `Skrzynka has no mailbox ${EMAIL}; import its Skarbiec item with skrzynka mailbox import`,
    );
  }
  return mailbox.id;
}

// A reset link is one that leads back into the site being logged into, below
// its front page; homepage or footer links never qualify.
function resetLink(body) {
  const host = new URL(LOGIN_URL).host;
  return [...body.matchAll(/https?:\/\/[^\s<>"]+/gi)]
    .map(([candidate]) => new URL(candidate))
    .find(
      (url) => url.host === host && (url.pathname !== '/' || url.search !== ''),
    );
}

// One sync and read of the PARP mailbox in Skrzynka, narrowed by Skrzynka to
// the reset sender's mail received since the request. Skrzynka offers no push
// or blocking read, so a reset mail that has not arrived yet is refused with
// what to do.
function readResetLink(requestedAt) {
  const mailboxId = resetMailbox();
  skrzynka(['sync', '--mailbox', mailboxId]);
  const mail = skrzynka([
    'message',
    'list',
    '--mailbox',
    mailboxId,
    '--sender',
    RESET_SENDER,
    '--since',
    requestedAt.toISOString(),
  ]);
  const link = mail.map((m) => resetLink(m.body_text)).find(Boolean);
  if (link === undefined)
    throw new Error(
      `mail resetowy od ${RESET_SENDER} jeszcze nie dotarł do skrzynki ${EMAIL} w Skrzynce (${mail.length} wiadomości od niego od ${requestedAt.toISOString()} bez linku); uruchom ponownie, gdy przyjdzie (albo PARP ma captcha / blokadę resetu).`,
    );
  logn(`znalazłem link reset: ${link.href}`);
  return link.href;
}

/** The visible field `selector` names, refused by name when the page shows none. */
async function visibleField(s, selector, what) {
  const field = s.page.locator(selector).filter({ visible: true }).first();
  if (!(await field.count()))
    throw new Error(`${s.page.url()} nie pokazuje pola ${what} (${selector})`);
  return field;
}

const s = await WSession.start({
  label: 'parp_login',
  proxy: statedProxy('the PARP login'),
});
try {
  logn('otwieram lsi.parp.gov.pl');
  await s.goto(LOGIN_URL);
  await pageSettled(s.page);
  await screenshot(s, 'login_page');

  await clickControl(
    s,
    'the link on the login form for a forgotten password (password reset)',
  );
  await screenshot(s, 'reset_form');

  logn(`wpisuję email: ${EMAIL}`);
  await humanFill(s.page, await visibleField(s, EMAIL_FIELD, 'email'), EMAIL);
  await pageSettled(s.page);

  const requestedAt = new Date();
  await clickControl(s, 'the button that sends the password reset request');
  await screenshot(s, 'reset_submitted');

  logn('czytam skrzynkę PARP w Skrzynce');
  const link = readResetLink(requestedAt);

  logn('otwieram link resetu');
  await s.goto(link);
  await pageSettled(s.page);
  await screenshot(s, 'reset_link_opened');

  // The reset form shows the new password and its confirmation: the page's
  // visible password fields, in order.
  const [newField, confirmField] = await s.page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .all();
  if (confirmField === undefined)
    throw new Error(
      `${s.page.url()} nie pokazuje dwóch pól hasła (nowe i potwierdzenie)`,
    );

  logn(`wpisuję nowe hasło (zapisuję do ${STORE})`);
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(
    STORE,
    JSON.stringify(
      {
        email: EMAIL,
        password: NEW_PASSWORD,
        createdAt: new Date().toISOString(),
      },
      null,
      '  ',
    ),
  );
  await humanFill(s.page, newField, NEW_PASSWORD);
  await humanFill(s.page, confirmField, NEW_PASSWORD);
  await pageSettled(s.page);

  await clickControl(s, 'the button that saves the new password');
  await screenshot(s, 'after_password_set');

  logn(`final URL po reset: ${s.page.url()}`);
  logn(`OK: hasło zapisane do ${STORE}`);
} finally {
  await s.close();
}
