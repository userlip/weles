// The Weles services whose credentials trajectories read and write through
// src/_shared/scoped-secrets.mjs, each with its reader identity and the
// fields its credential holds.
//
// Each service's `item` is the vault role its credential plays: reads ask the
// acquisition catalog and Skarbiec for `role:<item>`, and the local
// credentials file keys the fields by that name. A service Weles writes
// declares the Skarbiec `kind` its item is stored as; the write goes to the
// item playing the role through `stado credentials put --role`, under Stado's
// own identity on the host. No vault item id is written here.

const LOGIN_FIELDS = Object.freeze({ username: true, password: true });
const LOGIN_WITH_TOTP_FIELDS = Object.freeze({
  username: true,
  password: true,
  totp_secret: true,
});
const BASIC_PROXY_FIELDS = Object.freeze({ username: true, password: true });
const ENDPOINT_PROXY_FIELDS = Object.freeze({
  username: true,
  password: true,
  host: true,
  ports: true,
});
const API_KEY_FIELDS = Object.freeze({ api_key: true });

export const SERVICES = Object.freeze({
  googleSso: Object.freeze({
    consumer: 'weles-google-sso-client',
    item: 'weles-google-sso-login',
    tokenFile: 'weles-google-sso-client-skarbiec-token',
    fields: LOGIN_FIELDS,
  }),
  googleAds: Object.freeze({
    consumer: 'weles-google-ads-client',
    item: 'weles-google-ads-login',
    tokenFile: 'weles-google-ads-client-skarbiec-token',
    kind: 'login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  gmail: Object.freeze({
    consumer: 'weles-gmail-client',
    item: 'weles-gmail-login',
    tokenFile: 'weles-gmail-client-skarbiec-token',
    fields: LOGIN_FIELDS,
  }),
  googleDrive: Object.freeze({
    consumer: 'weles-google-drive-client',
    item: 'weles-google-drive-login',
    tokenFile: 'weles-google-drive-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  googleWorkspaceAdmin: Object.freeze({
    consumer: 'weles-google-workspace-admin-client',
    item: 'weles-google-workspace-admin-login',
    tokenFile: 'weles-google-workspace-admin-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  oxylabsDashboard: Object.freeze({
    consumer: 'weles-oxylabs-dashboard-client',
    item: 'weles-oxylabs-dashboard-login',
    tokenFile: 'weles-oxylabs-dashboard-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  brightdataDashboard: Object.freeze({
    consumer: 'weles-brightdata-dashboard-client',
    item: 'weles-brightdata-dashboard-login',
    tokenFile: 'weles-brightdata-dashboard-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  brightdataBrowser: Object.freeze({
    consumer: 'weles-brightdata-browser-client',
    item: 'weles-brightdata-browser',
    tokenFile: 'weles-brightdata-browser-client-skarbiec-token',
    fields: Object.freeze({ websocket_url: true }),
  }),
  umamiDashboard: Object.freeze({
    consumer: 'weles-umami-dashboard-client',
    item: 'weles-umami-dashboard-login',
    tokenFile: 'weles-umami-dashboard-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  linearDashboard: Object.freeze({
    consumer: 'weles-linear-dashboard-client',
    item: 'weles-linear-dashboard-login',
    tokenFile: 'weles-linear-dashboard-client-skarbiec-token',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  vastDashboard: Object.freeze({
    consumer: 'weles-vast-dashboard-client',
    item: 'weles-vast-dashboard-login',
    tokenFile: 'weles-vast-dashboard-client-skarbiec-token',
    fields: LOGIN_FIELDS,
  }),
  supabaseDashboard: Object.freeze({
    consumer: 'weles-supabase-dashboard-client',
    item: 'weles-supabase-dashboard-login',
    tokenFile: 'weles-supabase-dashboard-client-skarbiec-token',
    fields: LOGIN_FIELDS,
  }),
  appleAppStoreConnectApi: Object.freeze({
    consumer: 'weles-apple-app-store-connect-api-client',
    item: 'api-appstoreconnect-weles',
    tokenFile: 'weles-apple-app-store-connect-api-client-skarbiec-token',
    fields: Object.freeze({ key_id: true, issuer_id: true, private_key: true }),
  }),
  oxylabsResidential: Object.freeze({
    consumer: 'weles-oxylabs-residential-proxy-client',
    item: 'weles-oxylabs-residential-proxy',
    tokenFile: 'weles-oxylabs-residential-proxy-client-skarbiec-token',
    fields: BASIC_PROXY_FIELDS,
  }),
  oxylabsMobile: Object.freeze({
    consumer: 'weles-oxylabs-mobile-proxy-client',
    item: 'weles-oxylabs-mobile-proxy',
    tokenFile: 'weles-oxylabs-mobile-proxy-client-skarbiec-token',
    kind: 'proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  oxylabsIsp: Object.freeze({
    consumer: 'weles-oxylabs-isp-proxy-client',
    item: 'weles-oxylabs-isp-proxy',
    tokenFile: 'weles-oxylabs-isp-proxy-client-skarbiec-token',
    kind: 'proxy',
    fields: ENDPOINT_PROXY_FIELDS,
  }),
  oxylabsDedicatedIsp: Object.freeze({
    consumer: 'weles-oxylabs-dedicated-isp-proxy-client',
    item: 'weles-oxylabs-dedicated-isp-proxy',
    tokenFile: 'weles-oxylabs-dedicated-isp-proxy-client-skarbiec-token',
    kind: 'proxy',
    fields: ENDPOINT_PROXY_FIELDS,
  }),
  brightdataProxy: Object.freeze({
    consumer: 'weles-brightdata-proxy-client',
    item: 'weles-brightdata-proxy',
    tokenFile: 'weles-brightdata-proxy-client-skarbiec-token',
    fields: Object.freeze({ username: true, password: true, zone: true }),
  }),
  antiCaptcha: Object.freeze({
    consumer: 'weles-anti-captcha-client',
    item: 'weles-anti-captcha-api',
    tokenFile: 'weles-anti-captcha-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  twoCaptcha: Object.freeze({
    consumer: 'weles-two-captcha-client',
    item: 'weles-two-captcha-api',
    tokenFile: 'weles-two-captcha-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  capsolver: Object.freeze({
    consumer: 'weles-capsolver-client',
    item: 'weles-capsolver-api',
    tokenFile: 'weles-capsolver-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  capmonster: Object.freeze({
    consumer: 'weles-capmonster-client',
    item: 'weles-capmonster-api',
    tokenFile: 'weles-capmonster-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  noCaptcha: Object.freeze({
    consumer: 'weles-nocaptcha-client',
    item: 'weles-nocaptcha-api',
    tokenFile: 'weles-nocaptcha-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  nopecha: Object.freeze({
    consumer: 'weles-nopecha-client',
    item: 'weles-nopecha-api',
    tokenFile: 'weles-nopecha-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  juicySms: Object.freeze({
    consumer: 'weles-juicysms-client',
    item: 'weles-juicysms-api',
    tokenFile: 'weles-juicysms-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  smsActivate: Object.freeze({
    consumer: 'weles-sms-activate-client',
    item: 'weles-sms-activate-api',
    tokenFile: 'weles-sms-activate-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
  discordBot: Object.freeze({
    consumer: 'weles-discord-bot-client',
    item: 'weles-discord-bot',
    tokenFile: 'weles-discord-bot-client-skarbiec-token',
    fields: API_KEY_FIELDS,
  }),
});
