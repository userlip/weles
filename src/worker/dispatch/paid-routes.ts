// Paid advertising routes, including browser report harvests.
export const PAID_ROUTES: Record<string, (p: string) => string | null> = {
  // Paid-growth/vendor workflows. Google Ads is browser-driven here; Meta has
  // both a browser fallback and an official-CLI wrapper. App store releases
  // are wired to the existing CLI-capable submission trajectories.
  ads_campaign: (p) =>
    p === 'meta'
      ? 'src/trajectories/meta/ads/ads_campaign.mjs'
      : p === 'google'
        ? 'src/trajectories/google/ads/ads_campaign.mjs'
        : null,
  ads_login: (p) =>
    p === 'meta'
      ? 'src/trajectories/meta/ads/ads_login.mjs'
      : p === 'google'
        ? 'src/trajectories/google/ads/ads_login.mjs'
        : null,
  ads_verify_access: (p) =>
    p === 'meta'
      ? 'src/trajectories/meta/ads/ads_verify_access.mjs'
      : p === 'google'
        ? 'src/trajectories/google/ads/ads_verify_access.mjs'
        : null,
  ads_cli_campaign: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/cli/ads_cli_campaign.mjs' : null,
  // Google's API campaign, performance and update trajectories were deleted
  // while these three entries kept resolving to them, so a queued
  // google task passed dispatch and then died on the host with a
  // module-not-found. Resolving to nothing is the refusal the caller can read.
  ads_api_campaign: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/api/ads_api_campaign.mjs' : null,
  ads_api_catalog: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/api/ads_api_catalog.mjs' : null,
  ads_api_audience: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/api/ads_api_audience.mjs' : null,
  ads_api_creative: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/api/ads_api_creative.mjs' : null,
  ads_api_lead_form: (p) =>
    p === 'meta'
      ? 'src/trajectories/meta/ads/api/leads/ads_api_lead_form.mjs'
      : null,
  ads_api_messaging: (p) =>
    p === 'meta'
      ? 'src/trajectories/meta/ads/api/leads/ads_api_messaging.mjs'
      : null,
  ads_performance: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/ads_performance.mjs' : null,
  ads_update_campaign: (p) =>
    p === 'meta' ? 'src/trajectories/meta/ads/ads_update_campaign.mjs' : null,
  ads_cli: (p) => (p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null),
  ads_auth_status: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_doctor: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_login: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_discover: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_token: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_switch: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_auth_logout: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_api_setup_probe: (p) =>
    p === 'apple'
      ? 'src/trajectories/apple/ads/api_client_setup_probe.mjs'
      : null,
  ads_me: (p) => (p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null),
  ads_acls: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_apps_search: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_apps_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_apps_localized_details: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_apps_assets_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_apps_eligibility_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_product_pages: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_product_page_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_product_page_countries: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_product_page_devices: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_product_page_locales: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_creatives: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_creative_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_creative_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_creative_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_geo_search: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_geo_resolve: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaigns: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_update: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_delete: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_pause: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_campaign_resume: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_groups: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_find_org: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_update: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_delete: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ads: (p) => (p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null),
  ads_ad_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_find_org: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_update: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_delete: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keywords: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keyword_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keyword_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keyword_delete: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keywords_update_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keywords_create_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_keywords_delete_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keywords: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keyword_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keyword_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keywords_update_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keywords_create_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_negative_keywords_delete_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keywords: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keyword_find: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keyword_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keywords_create_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keywords_update_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_ad_group_negative_keywords_delete_bulk: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_campaigns: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_ad_groups: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_ads: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_keywords: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_search_terms: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_ad_group_keywords: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_ad_group_search_terms: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_reports_preset: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_impression_share_report: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_impression_share_reports: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_impression_share_report_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_impression_share_report_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_budget_orders: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_budget_order_create: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_budget_order_update: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_budget_order_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_rejection_reasons: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_rejection_reason_view: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_api_request: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/run.mjs' : null,
  ads_report_harvest: (p) =>
    p === 'apple' ? 'src/trajectories/apple/ads/report_harvest.mjs' : null,
};
