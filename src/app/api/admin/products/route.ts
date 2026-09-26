import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { apiErrorResponse, validationErrorResponse } from '@/lib/schemas';
import { AdminProductCreateSchema, AdminProductImageInputSchema, AdminProductSaveFormSchema, AdminProductUpdateSchema } from '@/lib/admin-product-schemas';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';
import { getAdminProducts } from '@/server/admin/products';
import { ProductSaveError, saveAdminProduct } from '@/server/admin/save-product';

const QuerySchema = z.object({ q: z.string().max(100).optional() }).strict();

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  const parsed = QuerySchema.safeParse({ q: request.nextUrl.searchParams.get('q') ?? undefined });
  if (!parsed.success) {
    return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId), {
      status: 400, headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    return adminSuccess({ items: await getAdminProducts(parsed.data.q) }, authorization.requestId);
  } catch {
    return adminError(503, authorization.requestId);
  }
}

async function saveProductRequest(request: NextRequest, update: boolean) {
  const authorization = await authorizeAdminApi(request, true);
  if ('response' in authorization) return authorization.response;
  let form: FormData;
  try { form = await request.formData(); }
  catch { return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  const payloadText = form.get('payload');
  let payloadJson: unknown;
  try { payloadJson = typeof payloadText === 'string' ? JSON.parse(payloadText) : null; }
  catch { payloadJson = null; }
  const payload = AdminProductSaveFormSchema.safeParse(payloadJson);
  if (!payload.success) return NextResponse.json(validationErrorResponse(payload.error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if ((update && !payload.data.productId) || (!update && payload.data.productId)) {
    return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const fields = update ? AdminProductUpdateSchema.safeParse(payload.data.fields) : AdminProductCreateSchema.safeParse(payload.data.fields);
  const images = z.array(AdminProductImageInputSchema).safeParse(payload.data.images);
  if (!fields.success || !images.success) {
    const error = !fields.success ? fields.error : (images as { success: false; error: z.ZodError }).error;
    return NextResponse.json(validationErrorResponse(error, authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const image = form.get('image');
  if (image !== null && !(image instanceof File)) return NextResponse.json(apiErrorResponse('BAD_REQUEST', authorization.requestId), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    const data = await saveAdminProduct({ ...(update ? { productId: payload.data.productId } : {}), fields: fields.data, images: images.data, imageAltText: payload.data.imageAltText,
      ...(image instanceof File ? { imageFile: image } : {}), actorId: authorization.access.userId, requestId: authorization.requestId });
    return update ? adminSuccess(data, authorization.requestId)
      : NextResponse.json({ data, requestId: authorization.requestId }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ProductSaveError) {
      const status = error.code === 'BAD_REQUEST' ? 400 : error.code === 'FORBIDDEN' ? 403 : error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : 503;
      const apiCode = error.code === 'FORBIDDEN' ? 'FORBIDDEN' : error.code === 'CONFLICT' ? 'CONFLICT'
        : error.code === 'NOT_FOUND' ? 'NOT_FOUND' : error.code === 'BAD_REQUEST' ? 'BAD_REQUEST' : 'UNAVAILABLE';
      const body = apiErrorResponse(apiCode, authorization.requestId);
      return NextResponse.json(error.fieldErrors ? { ...body, error: { ...body.error, fieldErrors: error.fieldErrors } } : body,
        { status, headers: { 'Cache-Control': 'no-store' } });
    }
    return adminError(503, authorization.requestId);
  }
}

export async function POST(request: NextRequest) { return saveProductRequest(request, false); }
export async function PATCH(request: NextRequest) { return saveProductRequest(request, true); }
