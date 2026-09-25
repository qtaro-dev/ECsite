import { NextRequest, NextResponse } from 'next/server';
import { AdminShippingSettingsUpdateSchema } from '@/lib/admin-shipping-schemas';
import { ApiErrorSchema, validationErrorResponse } from '@/lib/schemas';
import { readAdminShippingSettings, saveAdminShippingSettings, ShippingSettingsError } from '@/server/shipping/admin-settings';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';

function shippingError(status: 400 | 409, message: string, requestId: string) {
  const code = status === 400 ? 'BAD_REQUEST' : 'CONFLICT';
  return NextResponse.json(ApiErrorSchema.parse({ error: { code, message }, requestId }), {
    status, headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  try {
    const settings = await readAdminShippingSettings(authorization.requestId);
    return adminSuccess(settings, authorization.requestId);
  } catch {
    return adminError(503, authorization.requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const authorization = await authorizeAdminApi(request, true);
  if ('response' in authorization) return authorization.response;
  let body: unknown;
  try { body = await request.json(); } catch {
    return shippingError(400, '入力内容を確認してください。', authorization.requestId);
  }
  const parsed = AdminShippingSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId), {
      status: 400, headers: { 'Cache-Control': 'no-store' },
    });
  }
  try {
    const settings = await saveAdminShippingSettings(parsed.data, authorization.access.userId, authorization.requestId);
    return adminSuccess(settings, authorization.requestId);
  } catch (error) {
    if (error instanceof ShippingSettingsError && error.databaseCode === 'P0001') {
      return shippingError(409, '設定が更新されています。最新の版を読み直して再度お試しください。', authorization.requestId);
    }
    if (error instanceof ShippingSettingsError && error.databaseCode === '22023') {
      return shippingError(400, '料金設定を確認してください。', authorization.requestId);
    }
    return adminError(503, authorization.requestId);
  }
}
