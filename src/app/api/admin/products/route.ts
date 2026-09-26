import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validationErrorResponse } from '@/lib/schemas';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';
import { getAdminProducts } from '@/server/admin/products';

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
