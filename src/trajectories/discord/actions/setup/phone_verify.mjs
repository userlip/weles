// Verify the Discord account with a rented phone number (it unblocks the
// server endpoints behind Discord's phone wall), through the shared Discord
// action runner (../../../_shared/discord/run.mjs): the account, its seat,
// the ban signal and the kept verdict are the runner's. The web client is
// driven, not the raw API: its requests carry the client's own headers and
// its in-page captcha.
//
// Env: DISCORD_PHONE_COUNTRY (required): the country the number is rented in
// and the account is verified with.
//
// The settings, add-phone control and fields are found by the vision model;
// the code is read from the rented number's order once it arrives, and the
// order is cancelled when the run fails. The verification counts once
// Discord's own account record (/users/@me) holds the number.
import {
  getNumber,
  textedCode,
  cancelOrder,
} from '../../../../../dist/utils/identity/sms.js';
import { runDiscordAction } from '../../../_shared/discord/run.mjs';
import { readDiscordApi } from '../../../_shared/discord/response.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  fillDescribed,
} from '../../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';

const COUNTRY = statedText(
  ['DISCORD_PHONE_COUNTRY'],
  'the country the SMS number is rented in and the account is verified with',
);

await runDiscordAction({
  action: 'phone_verify',
  url: 'https://discord.com/channels/@me',
  run: { country: COUNTRY },
  act: async (s, acct) => {
    const number = await getNumber('discord', COUNTRY);
    console.log(
      `[phone_verify] number=${number.phone} order=${number.orderId} provider=${number.provider}`,
    );
    try {
      await clickDescribed(s.page, 'the user settings button');
      await clickDescribed(
        s.page,
        'the button that adds a phone number to the account',
      );
      // Discord's field takes the number without its leading plus.
      await fillDescribed(
        s.page,
        'the phone number field',
        number.phone.replace(/^\+/, ''),
      );
      await s.page.keyboard.press('Enter');
      await pageSettled(s.page);
      const captcha = await s.solveCaptcha();
      if (captcha === 'captcha failed')
        throw new Error(
          'DISCORD_PHONE_CAPTCHA_FAILED: the captcha after the number was not solved',
        );
      const code = await textedCode(number);
      await fillDescribed(
        s.page,
        'the field that takes the SMS verification code',
        code,
      );
      await s.page.keyboard.press('Enter');
      await pageSettled(s.page);
      const { phone } = await readDiscordApi(
        s.page,
        '/users/@me',
        'DISCORD_ACCOUNT',
      );
      if (phone !== number.phone)
        throw new Error(
          `DISCORD_PHONE_NOT_VERIFIED: Discord's account record holds ${JSON.stringify(phone)} after the code, not ${number.phone}`,
        );
    } catch (error) {
      await cancelOrder(number).catch((cancelError) => {
        throw new AggregateError(
          [error, cancelError],
          `${error.message}; and the SMS order was not cancelled: ${cancelError.message}`,
        );
      });
      throw error;
    }
    await s.patchAccount(acct.id, {
      metadata: {
        phone: number.phone,
        phone_verified_at: new Date().toISOString(),
        phone_country: COUNTRY,
      },
    });
    return `${acct.username} verified ${number.phone}`;
  },
});
