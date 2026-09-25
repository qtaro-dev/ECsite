import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { apiErrorResponse, validationErrorResponse } from '@/lib/schemas';
import { parseProductSearch, searchProducts } from '@/server/catalog/product-search';

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const params: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (Object.hasOwn(params, key)) {
      return Response.json(apiErrorResponse('BAD_REQUEST', requestId), { status: 400 });
    }
    params[key] = value;
  }

  let query;
  try {
    query = parseProductSearch(params);
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(validationErrorResponse(error, requestId), { status: 400 });
    }
    return Response.json(apiErrorResponse('BAD_REQUEST', requestId), { status: 400 });
  }

  try {
    return Response.json({ data: await searchProducts(query), requestId });
  } catch {
    return Response.json(apiErrorResponse('UNAVAILABLE', requestId), { status: 503 });
  }
}
