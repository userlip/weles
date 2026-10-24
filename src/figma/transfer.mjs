// Transfer helpers the Figma exporter uses that carry no credential: naming,
// digests, the request that names its failure, gzip and download. The token
// and the Figma API calls stay in export-design-assets.mjs.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname } from 'node:path';
import { constants, createGzip } from 'node:zlib';
import { describeError } from '../_shared/error-chain/index.cjs';

/**
 * A file-name fragment of `value`: its letters and digits, accents removed,
 * joined by dashes. A value with none gives an empty fragment; every caller
 * appends the node id or file key, which keeps the name unique.
 */
export function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// The media types Figma serves image fills and renders as, and the file
// extension each is written with.
const EXTENSION_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * The extension for a download Figma served as `contentType` from `url`: the
 * declared media type's, else the URL path's own when it is one of the same
 * extensions. A download that is neither is refused, naming both, rather
 * than written under an extension nobody chose.
 */
export function extensionFor(contentType, url) {
  const [mediaType] = String(contentType).split(';');
  const declared = EXTENSION_BY_TYPE[mediaType.trim().toLowerCase()];
  if (declared) return declared;
  const fromPath = extname(new URL(url).pathname).toLowerCase();
  if (Object.values(EXTENSION_BY_TYPE).includes(fromPath)) return fromPath;
  throw new Error(
    `Figma served ${new URL(url).pathname} as ${contentType}, a media type the exporter writes no extension for (${Object.keys(EXTENSION_BY_TYPE).join(', ')})`,
  );
}

/**
 * Every value a request carries that must not appear in an error: its
 * header values and its URL's query parameter values (a signed asset URL
 * carries its signature there).
 */
function sentValues(url, init) {
  const values = [...new URL(url).searchParams.values()];
  if (init.headers) values.push(...Object.values(init.headers).map(String));
  return values.filter(Boolean);
}

function redacted(text, values) {
  return values.reduce(
    (out, value) => out.split(value).join('[redacted]'),
    text,
  );
}

/**
 * One request. A network failure or a non-success answer is the error, with
 * the status, the server's Retry-After when it sent one, and the body with
 * every header and query value the request sent replaced by [redacted].
 */
export async function request(url, init) {
  const path = new URL(url).pathname;
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(
      `Figma network failure for ${path}: ${describeError(error)}`,
      { cause: error },
    );
  }
  if (response.ok) return response;
  let body;
  try {
    body = await response.text();
  } catch (error) {
    throw new Error(
      `Figma HTTP ${response.status} for ${path}, and its body could not be read: ${describeError(error)}`,
      { cause: error },
    );
  }
  const retryAfter = response.headers.get('retry-after');
  const after = retryAfter ? ` (Retry-After: ${retryAfter})` : '';
  throw new Error(
    `Figma HTTP ${response.status} for ${path}${after}: ${redacted(body, sentValues(url, init))}`,
  );
}

/** Gzips `source` into `destination` at zlib's best compression. */
export async function gzipFile(source, destination) {
  await new Promise((resolve, reject) => {
    const input = createReadStream(source);
    const output = createWriteStream(destination);
    const gzip = createGzip({ level: constants.Z_BEST_COMPRESSION });
    input.on('error', reject);
    gzip.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    input.pipe(gzip).pipe(output);
  });
}

/** Downloads `url` to `destination`; contentType is the one served, or null. */
export async function download(url, destination) {
  const response = await request(url, {});
  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, buffer);
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    contentType: response.headers.get('content-type'),
  };
}
