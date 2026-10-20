// The Skarbiec items Weles's services read with their own scoped consumers,
// each with the fields its credential holds.

// Credential schemas shared by the scoped reader and writer.
const API_KEY_FIELD = Object.freeze({ api_key: true });
const LOGIN_FIELDS = Object.freeze({ username: true, password: true });
const LOGIN_WITH_TOTP_FIELDS = Object.freeze({
  username: true,
  password: true,
  totp_secret: true,
});
const ENDPOINT_PROXY_FIELDS = Object.freeze({
  username: true,
  password: true,
  host: true,
  ports: true,
});
const BASIC_PROXY_FIELDS = Object.freeze({ username: true, password: true });
const BRIGHTDATA_PROXY_FIELDS = Object.freeze({
  username: true,
  password: true,
  zone: true,
});
export const SERVICE_CONTRACTS = Object.freeze({
  googleSso: Object.freeze({
    consumer: 'weles-google-sso-client',
    item: 'weles-google-sso-login',
    fields: LOGIN_FIELDS,
  }),
  googleWorkspaceAdmin: Object.freeze({
    consumer: 'weles-google-workspace-admin-client',
    item: 'weles-google-workspace-admin-login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  brightdataDashboard: Object.freeze({
    consumer: 'weles-brightdata-dashboard-client',
    item: 'weles-brightdata-dashboard-login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  oxylabsDashboard: Object.freeze({
    consumer: 'weles-oxylabs-dashboard-client',
    item: 'weles-oxylabs-dashboard-login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  umamiDashboard: Object.freeze({
    consumer: 'weles-umami-dashboard-client',
    item: 'weles-umami-dashboard-login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  linearDashboard: Object.freeze({
    consumer: 'weles-linear-dashboard-client',
    item: 'weles-linear-dashboard-login',
    fields: LOGIN_WITH_TOTP_FIELDS,
  }),
  vastDashboard: Object.freeze({
    consumer: 'weles-vast-dashboard-client',
    item: 'weles-vast-dashboard-login',
    fields: LOGIN_FIELDS,
  }),
  antiCaptcha: Object.freeze({
    consumer: 'weles-anti-captcha-client',
    item: 'weles-anti-captcha-api',
    fields: API_KEY_FIELD,
  }),
  twoCaptcha: Object.freeze({
    consumer: 'weles-two-captcha-client',
    item: 'weles-two-captcha-api',
    fields: API_KEY_FIELD,
  }),
  capsolver: Object.freeze({
    consumer: 'weles-capsolver-client',
    item: 'weles-capsolver-api',
    fields: API_KEY_FIELD,
  }),
  capmonster: Object.freeze({
    consumer: 'weles-capmonster-client',
    item: 'weles-capmonster-api',
    fields: API_KEY_FIELD,
  }),
  noCaptcha: Object.freeze({
    consumer: 'weles-nocaptcha-client',
    item: 'weles-nocaptcha-api',
    fields: API_KEY_FIELD,
  }),
  nopecha: Object.freeze({
    consumer: 'weles-nopecha-client',
    item: 'weles-nopecha-api',
    fields: API_KEY_FIELD,
  }),
  juicySms: Object.freeze({
    consumer: 'weles-juicysms-client',
    item: 'weles-juicysms-api',
    fields: API_KEY_FIELD,
  }),
  oxylabsResidential: Object.freeze({
    consumer: 'weles-oxylabs-residential-proxy-client',
    item: 'weles-oxylabs-residential-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  oxylabsMobile: Object.freeze({
    consumer: 'weles-oxylabs-mobile-proxy-client',
    item: 'weles-oxylabs-mobile-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  brightdataProxy: Object.freeze({
    consumer: 'weles-brightdata-proxy-client',
    item: 'weles-brightdata-proxy',
    fields: BRIGHTDATA_PROXY_FIELDS,
  }),
  packetstreamProxy: Object.freeze({
    consumer: 'weles-packetstream-proxy-client',
    item: 'weles-packetstream-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  iproyalProxy: Object.freeze({
    consumer: 'weles-iproyal-proxy-client',
    item: 'weles-iproyal-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  iproyalMobileProxy: Object.freeze({
    consumer: 'weles-iproyal-mobile-proxy-client',
    item: 'weles-iproyal-mobile-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  pingproxiesProxy: Object.freeze({
    consumer: 'weles-pingproxies-proxy-client',
    item: 'weles-pingproxies-proxy',
    fields: BASIC_PROXY_FIELDS,
  }),
  oxylabsIsp: Object.freeze({
    consumer: 'weles-oxylabs-isp-proxy-client',
    item: 'weles-oxylabs-isp-proxy',
    fields: ENDPOINT_PROXY_FIELDS,
  }),
  oxylabsDedicatedIsp: Object.freeze({
    consumer: 'weles-oxylabs-dedicated-isp-proxy-client',
    item: 'weles-oxylabs-dedicated-isp-proxy',
    fields: ENDPOINT_PROXY_FIELDS,
  }),
  decodoIsp: Object.freeze({
    consumer: 'weles-decodo-isp-proxy-client',
    item: 'weles-decodo-isp-proxy',
    fields: ENDPOINT_PROXY_FIELDS,
  }),
  smsActivate: Object.freeze({
    consumer: 'weles-sms-activate-client',
    item: 'weles-sms-activate-api',
    fields: API_KEY_FIELD,
  }),
} as const);
