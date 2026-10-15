import sharp from 'sharp';

// The image media types the model's chat API accepts in a data URL, by the
// format name sharp reads from the bytes.
const MODEL_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

// Infer the media type from the bytes: browser screenshots can be WebP even
// when their retained artifact name ends in .png. Do not re-encode the image.
export async function modelMessageContent(
  prompt: string,
  images?: readonly Buffer[],
) {
  if (!images?.length) return prompt;
  const parts = await Promise.all(
    images.map(async (bytes) => {
      const { format } = await sharp(bytes).metadata();
      if (!format)
        throw new Error('the model image holds no format sharp could read');
      if (!Object.hasOwn(MODEL_MEDIA_TYPES, format))
        throw new Error(`Unsupported model image format: ${format}`);
      return {
        type: 'image_url',
        image_url: {
          url: `data:${MODEL_MEDIA_TYPES[format]};base64,${bytes.toString('base64')}`,
        },
      };
    }),
  );
  return [{ type: 'text', text: prompt }, ...parts];
}
