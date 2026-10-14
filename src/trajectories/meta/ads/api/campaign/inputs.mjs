// Payloads built only for the Marketing API resource the caller chose.
import {
  boolEnv,
  compactObject,
  microsFromUsd,
  parseJsonEnv,
  splitList,
} from '../marketing_api.mjs';
import { statedText } from '../../../../_shared/inputs/stated.mjs';

const stated = (name, what) => statedText([name], what);
const statedJson = (name, what) => {
  stated(name, what);
  return parseJsonEnv(name);
};

export const campaignCreate = (resource) =>
  compactObject({
    name: stated(
      'CAMPAIGN_NAME',
      'the name the ad account lists the campaign under',
    ),
    objective: stated(
      'CAMPAIGN_OBJECTIVE',
      'the Meta campaign objective, e.g. OUTCOME_TRAFFIC',
    ),
    status: stated('STATUS', 'the initial campaign status'),
    special_ad_categories: statedJson(
      'SPECIAL_AD_CATEGORIES',
      'the special ad categories the advertiser declares to Meta, as a JSON array',
    ),
    buying_type: process.env.BUYING_TYPE,
    bid_strategy:
      process.env.CAMPAIGN_BID_STRATEGY ||
      (resource === 'campaign' ||
      process.env.CAMPAIGN_DAILY_BUDGET_USD ||
      process.env.CAMPAIGN_LIFETIME_BUDGET_USD
        ? process.env.BID_STRATEGY
        : undefined),
    daily_budget: microsFromUsd(
      process.env.CAMPAIGN_DAILY_BUDGET_USD ||
        (resource === 'campaign' ? process.env.DAILY_BUDGET_USD : undefined),
    ),
    lifetime_budget: microsFromUsd(
      process.env.CAMPAIGN_LIFETIME_BUDGET_USD ||
        (resource === 'campaign' ? process.env.LIFETIME_BUDGET_USD : undefined),
    ),
    is_adset_budget_sharing_enabled: process.env.IS_ADSET_BUDGET_SHARING_ENABLED,
  });

export const targeting = () =>
  parseJsonEnv(
    'TARGETING_JSON',
    compactObject({
      geo_locations: parseJsonEnv(
        'GEO_LOCATIONS_JSON',
        process.env.COUNTRIES
          ? { countries: splitList(process.env.COUNTRIES) }
          : undefined,
      ),
      age_min: process.env.AGE_MIN ? Number(process.env.AGE_MIN) : undefined,
      age_max: process.env.AGE_MAX ? Number(process.env.AGE_MAX) : undefined,
      genders: parseJsonEnv(
        'GENDERS_JSON',
        process.env.GENDERS
          ? splitList(process.env.GENDERS).map(Number)
          : undefined,
      ),
      custom_audiences: parseJsonEnv(
        'CUSTOM_AUDIENCES_JSON',
        process.env.CUSTOM_AUDIENCE_ID
          ? [{ id: process.env.CUSTOM_AUDIENCE_ID }]
          : undefined,
      ),
      excluded_custom_audiences: parseJsonEnv('EXCLUDED_CUSTOM_AUDIENCES_JSON'),
      publisher_platforms: process.env.PUBLISHER_PLATFORMS
        ? splitList(process.env.PUBLISHER_PLATFORMS)
        : undefined,
      facebook_positions: process.env.FACEBOOK_POSITIONS
        ? splitList(process.env.FACEBOOK_POSITIONS)
        : undefined,
      instagram_positions: process.env.INSTAGRAM_POSITIONS
        ? splitList(process.env.INSTAGRAM_POSITIONS)
        : undefined,
      audience_network_positions: process.env.AUDIENCE_NETWORK_POSITIONS
        ? splitList(process.env.AUDIENCE_NETWORK_POSITIONS)
        : undefined,
      messenger_positions: process.env.MESSENGER_POSITIONS
        ? splitList(process.env.MESSENGER_POSITIONS)
        : undefined,
    }),
  );

const promotedObject = () =>
  parseJsonEnv(
    'PROMOTED_OBJECT_JSON',
    compactObject({
      application_id: process.env.APP_ID,
      object_store_url: process.env.OBJECT_STORE_URL,
      page_id:
        process.env.PROMOTED_PAGE_ID ||
        (boolEnv('PROMOTED_OBJECT_USES_PAGE', false)
          ? process.env.PAGE_ID ||
            process.env.FACEBOOK_PAGE_ID ||
            process.env.META_FACEBOOK_PAGE_ID
          : undefined),
      pixel_id: process.env.PIXEL_ID,
      custom_event_type: process.env.APP_EVENT || process.env.CUSTOM_EVENT_TYPE,
      product_catalog_id: process.env.CATALOG_ID,
      product_set_id: process.env.PRODUCT_SET_ID,
      whatsapp_phone_number: process.env.WHATSAPP_NUMBER,
    }),
  );

export const adSetCreate = (campaignId = process.env.CAMPAIGN_ID) =>
  compactObject({
    name: stated(
      'AD_SET_NAME',
      'the name the ad account lists the ad set under',
    ),
    campaign_id: campaignId,
    status: stated('AD_SET_STATUS', 'the initial ad set status'),
    daily_budget: microsFromUsd(
      process.env.AD_SET_DAILY_BUDGET_USD || process.env.DAILY_BUDGET_USD,
    ),
    lifetime_budget: microsFromUsd(
      process.env.AD_SET_LIFETIME_BUDGET_USD || process.env.LIFETIME_BUDGET_USD,
    ),
    bid_amount: microsFromUsd(process.env.BID_AMOUNT_USD),
    bid_strategy: stated(
      'BID_STRATEGY',
      'how Meta bids for the ad set, e.g. LOWEST_COST_WITHOUT_CAP',
    ),
    billing_event: stated(
      'BILLING_EVENT',
      'what Meta charges the ad set for, e.g. IMPRESSIONS',
    ),
    optimization_goal: stated(
      'OPTIMIZATION_GOAL',
      'what Meta optimises the ad set for, e.g. LINK_CLICKS',
    ),
    destination_type:
      process.env.CAMPAIGN_DESTINATION || process.env.DESTINATION_TYPE,
    targeting: targeting(),
    promoted_object: promotedObject(),
    start_time: process.env.START_TIME,
    end_time: process.env.END_TIME,
  });

export const objectStorySpec = () =>
  parseJsonEnv(
    'OBJECT_STORY_SPEC_JSON',
    compactObject({
      page_id:
        process.env.PAGE_ID ||
        process.env.FACEBOOK_PAGE_ID ||
        process.env.META_FACEBOOK_PAGE_ID,
      instagram_actor_id: process.env.INSTAGRAM_ACTOR_ID,
      link_data: parseJsonEnv(
        'LINK_DATA_JSON',
        process.env.DESTINATION_URL || process.env.FINAL_URL
          ? compactObject({
              link: process.env.DESTINATION_URL || process.env.FINAL_URL,
              message: process.env.PRIMARY_TEXT,
              name: process.env.HEADLINE,
              description: process.env.DESCRIPTION,
              call_to_action: process.env.CALL_TO_ACTION_TYPE
                ? {
                    type: process.env.CALL_TO_ACTION_TYPE,
                    value: compactObject({
                      link:
                        process.env.DESTINATION_URL || process.env.FINAL_URL,
                      app_link: process.env.APP_LINK,
                      page: process.env.CALL_TO_ACTION_PAGE_ID,
                      whatsapp_number: process.env.WHATSAPP_NUMBER,
                    }),
                  }
                : undefined,
              image_hash: process.env.IMAGE_HASH,
              child_attachments: parseJsonEnv('CHILD_ATTACHMENTS_JSON'),
            })
          : undefined,
      ),
      template_data: parseJsonEnv('TEMPLATE_DATA_JSON'),
      video_data: parseJsonEnv('VIDEO_DATA_JSON'),
    }),
  );
