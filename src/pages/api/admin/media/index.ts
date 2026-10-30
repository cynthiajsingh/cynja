import { ValidationError } from '../../../../server/errors.ts';
import { json, PayloadError, route } from '../../../../server/http.ts';
import { MAX_UPLOAD_BYTES } from '../../../../server/media/service.ts';

export const GET = route(async (ctx, { media }) => {
  const page = Math.max(1, Number(ctx.url.searchParams.get('page')) || 1);
  return json(await media.list(page));
});

export const POST = route(async (ctx, { media }) => {
  const length = Number(ctx.request.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new PayloadError(413, `Images must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`, 'payload_too_large');
  }
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    throw new ValidationError({ file: 'Send the image as multipart form data.' });
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new ValidationError({ file: 'Choose an image to upload.' });
  const asset = await media.upload({
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    altText: String(form.get('altText') ?? ''),
  });
  return json(asset, { status: 201 });
});
