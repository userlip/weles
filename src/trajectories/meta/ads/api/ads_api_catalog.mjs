// Meta Marketing API: product catalog and product set wrapper.
//
// RESOURCE (catalog or product_set) and ACTION_KIND (or META_ACTION) are
// required. Only stated fields are sent: an update never rewrites a field,
// such as a catalog's vertical, that the caller did not name, and a read
// returns the fields in FIELDS or, without it, Meta's defaults.

import {
  compactObject,
  graphRequest,
  parseJsonEnv,
  submitEnabled,
  withValidateOnly,
} from './marketing_api.mjs';
import { statedChoice } from '../../../_shared/inputs/stated.mjs';

const BUSINESS_ID = process.env.BUSINESS_ID || process.env.META_BUSINESS_ID;
const CATALOG_ID = process.env.CATALOG_ID || process.env.PRODUCT_CATALOG_ID;
const PRODUCT_SET_ID = process.env.PRODUCT_SET_ID;

function catalogPayload() {
  return compactObject({
    name: process.env.CATALOG_NAME || process.env.NAME,
    vertical: process.env.CATALOG_VERTICAL,
  });
}

function productSetPayload() {
  return compactObject({
    name: process.env.PRODUCT_SET_NAME || process.env.NAME,
    filter: parseJsonEnv(
      'PRODUCT_SET_FILTER_JSON',
      process.env.PRODUCT_SET_FILTER
        ? JSON.parse(process.env.PRODUCT_SET_FILTER)
        : undefined,
    ),
  });
}

const readOpts = (label) => ({
  execute: submitEnabled() || process.env.LIVE_READ === '1',
  label,
});

async function readCatalog() {
  const path = CATALOG_ID
    ? `/${CATALOG_ID}`
    : `/${BUSINESS_ID}/owned_product_catalogs`;
  await graphRequest(
    'GET',
    path,
    { fields: process.env.FIELDS, limit: process.env.LIMIT },
    readOpts('meta-ads-api-catalog-read'),
  );
}

async function readProductSet() {
  const path = PRODUCT_SET_ID
    ? `/${PRODUCT_SET_ID}`
    : `/${CATALOG_ID}/product_sets`;
  await graphRequest(
    'GET',
    path,
    { fields: process.env.FIELDS, limit: process.env.LIMIT },
    readOpts('meta-ads-api-product-set-read'),
  );
}

// What each ACTION does to each RESOURCE; `list` is a read without an id.
const RESOURCES = {
  catalog: {
    async create() {
      if (!BUSINESS_ID)
        throw new Error(
          'BUSINESS_ID or META_BUSINESS_ID required for catalog create',
        );
      await graphRequest(
        'POST',
        `/${BUSINESS_ID}/owned_product_catalogs`,
        withValidateOnly(catalogPayload(), { validateOnly: false }),
        { label: 'meta-ads-api-catalog' },
      );
    },
    read: readCatalog,
    list: readCatalog,
    async update() {
      if (!CATALOG_ID)
        throw new Error('CATALOG_ID required for catalog update');
      await graphRequest(
        'POST',
        `/${CATALOG_ID}`,
        withValidateOnly(catalogPayload(), { validateOnly: false }),
        { label: 'meta-ads-api-catalog-update' },
      );
    },
  },
  product_set: {
    async create() {
      if (!CATALOG_ID)
        throw new Error('CATALOG_ID required for product set create');
      await graphRequest(
        'POST',
        `/${CATALOG_ID}/product_sets`,
        withValidateOnly(productSetPayload(), { validateOnly: false }),
        { label: 'meta-ads-api-product-set' },
      );
    },
    read: readProductSet,
    list: readProductSet,
    async update() {
      if (!PRODUCT_SET_ID)
        throw new Error('PRODUCT_SET_ID required for product set update');
      await graphRequest(
        'POST',
        `/${PRODUCT_SET_ID}`,
        withValidateOnly(productSetPayload(), { validateOnly: false }),
        { label: 'meta-ads-api-product-set-update' },
      );
    },
    async delete() {
      if (!PRODUCT_SET_ID)
        throw new Error('PRODUCT_SET_ID required for product set delete');
      await graphRequest(
        'DELETE',
        `/${PRODUCT_SET_ID}`,
        {},
        { label: 'meta-ads-api-product-set-delete' },
      );
    },
  },
};

const resource = statedChoice(['RESOURCE'], RESOURCES, 'the object acted on');
const actions = RESOURCES[resource];
const action = statedChoice(['ACTION_KIND', 'META_ACTION'], actions, `what is done with the ${resource}`);
await actions[action]();
console.log(`PASS: Meta catalog API ${action} ${resource} completed`);
