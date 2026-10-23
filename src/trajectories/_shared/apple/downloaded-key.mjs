// An Apple .p8 key the browser downloads, kept as a vault item and never
// written to disk: its id from the file name Apple gives it, its PEM read
// from the browser's download stream, and the browser's copy deleted.

import { writeScopedSecretItem } from '../../../_shared/scoped-secrets.mjs';

/** The downloaded file's bytes, read from the browser's stream. */
async function downloadedBytes(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Keep the .p8 `download` as `service`'s item with `extra` fields beside its
 * key id and private key; answers the key id. A download not named
 * AuthKey_<key id>.p8 is refused by its name.
 */
export async function keepDownloadedKey(download, service, extra) {
  const fileName = download.suggestedFilename();
  const keyId = fileName.match(/^AuthKey_(?<id>[A-Z\d]+)\.p8$/)?.groups?.id;
  if (!keyId)
    throw new Error(
      `APPLE_KEY_UNREADABLE: the download is named ${JSON.stringify(fileName)}, not AuthKey_<key id>.p8`,
    );
  const privateKey = (await downloadedBytes(download)).toString('utf8');
  await download.delete();
  writeScopedSecretItem(service, {
    ...extra,
    key_id: keyId,
    private_key: privateKey,
  });
  return keyId;
}
