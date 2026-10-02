import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validationErrorResponse } from '@/lib/schemas';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';
import { getPrebuiltPartCandidates, PART_CATEGORIES } from '@/server/admin/prebuilt-part-candidates';

const QuerySchema = z.object({
  slot: z.enum(Object.keys(PART_CATEGORIES) as [keyof typeof PART_CATEGORIES, ...(keyof typeof PART_CATEGORIES)[]]),
  q: z.string().max(100).default(''), page: z.coerce.number().int().min(0).max(999).default(0),
}).strict();

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  const params = request.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({ slot: params.get('slot') ?? undefined,
    q: params.get('q') ?? undefined, page: params.get('page') ?? undefined });
  if (!parsed.success) return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId),
    { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try { return adminSuccess(await getPrebuiltPartCandidates(parsed.data.slot, parsed.data.q, parsed.data.page), authorization.requestId); }
  catch { return adminError(503, authorization.requestId); }
}
