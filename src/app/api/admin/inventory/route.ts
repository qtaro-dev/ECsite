import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AdminInventoryAdjustmentInputSchema, AdminInventoryStateSchema } from '@/lib/admin-inventory-schemas';
import { ApiErrorSchema, validationErrorResponse } from '@/lib/schemas';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';
import { adjustAdminInventory, getAdminInventory, InventoryAdjustmentError } from '@/server/admin/inventory';

const ConflictDataSchema = z.object({ latest: AdminInventoryStateSchema }).strict();
const PageSchema = z.preprocess((value) => typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(100_000));

function inventoryError(status: 400 | 404 | 409, message: string, requestId: string, data?: unknown) {
  const code = status === 400 ? 'BAD_REQUEST' : status === 404 ? 'NOT_FOUND' : 'CONFLICT';
  return NextResponse.json(ApiErrorSchema.extend({ data: ConflictDataSchema.optional() }).parse({
    error: { code, message }, requestId, ...(data ? { data } : {}),
  }), { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  const parsedPage = PageSchema.safeParse(request.nextUrl.searchParams.get('page') ?? '1');
  if (!parsedPage.success) return NextResponse.json(validationErrorResponse(parsedPage.error, authorization.requestId), {
    status: 400, headers: { 'Cache-Control': 'no-store' },
  });
  try { return adminSuccess(await getAdminInventory(parsedPage.data), authorization.requestId); }
  catch { return adminError(503, authorization.requestId); }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminApi(request, true);
  if ('response' in authorization) return authorization.response;
  let body: unknown;
  try { body = await request.json(); } catch { return inventoryError(400, '入力内容を確認してください。', authorization.requestId); }
  const parsed = AdminInventoryAdjustmentInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId), {
    status: 400, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    return adminSuccess(await adjustAdminInventory(parsed.data, authorization.access.userId, authorization.requestId), authorization.requestId);
  } catch (error) {
    if (error instanceof InventoryAdjustmentError) {
      if (error.status === 'not_found') return inventoryError(404, '商品が見つかりません。商品一覧を再読み込みしてください。', authorization.requestId);
      const latest = AdminInventoryStateSchema.safeParse(error.latest);
      const message = error.status === 'conflict'
        ? '在庫が別の操作で更新されました。最新値を確認して、もう一度調整してください。'
        : error.status === 'below_allocated'
          ? '実在庫は引当数より少なくできません。最新値を確認して再操作してください。'
          : error.status === 'above_maximum'
            ? '実在庫が登録可能な上限を超えます。数量を確認してください。'
            : '実在庫は0未満にできません。数量を確認して再操作してください。';
      return inventoryError(error.status === 'conflict' ? 409 : 400, message, authorization.requestId,
        latest.success ? { latest: latest.data } : undefined);
    }
    return adminError(503, authorization.requestId);
  }
}
