import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, validationErrorResponse } from '@/lib/schemas';
import { AdminPrebuiltPcCreateSchema, AdminPrebuiltPcImageFileSchema, AdminPrebuiltPcImageInputSchema, AdminPrebuiltPcSaveFormSchema, AdminPrebuiltPcUpdateSchema } from '@/lib/admin-prebuilt-pc-schemas';
import { ADMIN_PRODUCT_MULTIPART_MAX_BYTES } from '@/lib/admin-product-image-limits';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';
import { getAdminPrebuiltPcs, getPrebuiltPcById, PrebuiltPcSaveError, saveAdminPrebuiltPc } from '@/server/admin/prebuilt-pcs';

const QuerySchema = z.object({ q: z.string().max(100).optional(), productId: z.uuid().optional() }).strict();

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  const parsed = QuerySchema.safeParse({ q: request.nextUrl.searchParams.get('q') ?? undefined, productId: request.nextUrl.searchParams.get('productId') ?? undefined });
  if (!parsed.success) return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    if (parsed.data.productId) {
      const item = await getPrebuiltPcById(parsed.data.productId);
      return item ? adminSuccess(item, authorization.requestId) : NextResponse.json(apiErrorResponse('NOT_FOUND', authorization.requestId), { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return adminSuccess({ items: await getAdminPrebuiltPcs(parsed.data.q) }, authorization.requestId);
  } catch { return adminError(503, authorization.requestId); }
}

async function saveRequest(request: NextRequest, update: boolean) {
  const authorization = await authorizeAdminApi(request, true);
  if ('response' in authorization) return authorization.response;
  const tooLarge = () => NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 413, headers: { 'Cache-Control': 'no-store' } });
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > ADMIN_PRODUCT_MULTIPART_MAX_BYTES) return tooLarge();
  let form: FormData;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > ADMIN_PRODUCT_MULTIPART_MAX_BYTES) return tooLarge();
    const contentType = request.headers.get('content-type');
    if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch { return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  let raw: unknown;
  try { raw = typeof form.get('payload') === 'string' ? JSON.parse(form.get('payload') as string) : null; } catch { raw = null; }
  const payload = AdminPrebuiltPcSaveFormSchema.safeParse(raw);
  if (!payload.success || (update ? !payload.data.productId : Boolean(payload.data.productId))) {
    return NextResponse.json(payload.success ? apiErrorResponse('BAD_REQUEST', authorization.requestId) : validationErrorResponse(payload.error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const fields = update ? AdminPrebuiltPcUpdateSchema.safeParse(payload.data.fields) : AdminPrebuiltPcCreateSchema.safeParse(payload.data.fields);
  const images = z.array(AdminPrebuiltPcImageInputSchema).safeParse(payload.data.images);
  if (!fields.success || !images.success) {
    const error = !fields.success ? fields.error : (images as { success: false; error: z.ZodError }).error;
    return NextResponse.json(validationErrorResponse(error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const rawImage = form.get('image');
  if (rawImage !== null && !(rawImage instanceof File)) return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  const image = rawImage === null ? null : AdminPrebuiltPcImageFileSchema.safeParse({ image: rawImage });
  if (image && !image.success) return NextResponse.json(validationErrorResponse(image.error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    const saved = await saveAdminPrebuiltPc({
      ...(update ? { productId: payload.data.productId } : {}), fields: fields.data, images: images.data,
      imageAltText: payload.data.imageAltText, ...(image?.success ? { imageFile: image.data.image } : {}),
      actorId: authorization.access.userId, requestId: authorization.requestId,
    });
    return update ? adminSuccess(saved, authorization.requestId) : NextResponse.json({ data: saved, requestId: authorization.requestId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PrebuiltPcSaveError) {
      const status = error.code === 'BAD_REQUEST' ? 400 : error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : 503;
      const code = error.code === 'FORBIDDEN' ? 'FORBIDDEN' : error.code === 'CONFLICT' ? 'CONFLICT' : error.code === 'NOT_FOUND' ? 'NOT_FOUND' : error.code === 'BAD_REQUEST' ? 'BAD_REQUEST' : 'UNAVAILABLE';
      const body = apiErrorResponse(code, authorization.requestId);
      return NextResponse.json(error.fieldErrors ? { ...body, error: { ...body.error, fieldErrors: error.fieldErrors } } : body, { status, headers: { 'Cache-Control': 'no-store' } });
    }
    return adminError(503, authorization.requestId);
  }
}

export async function POST(request: NextRequest) { return saveRequest(request, false); }
export async function PATCH(request: NextRequest) { return saveRequest(request, true); }
