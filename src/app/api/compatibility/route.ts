import { ZodError } from 'zod';
import { apiErrorResponse, validationErrorResponse } from '../../../lib/schemas';
import { evaluateCompatibility, loadCompatibilityProducts, parseCompatibilityRequest } from '../../../server/catalog/compatibility';

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(apiErrorResponse('BAD_REQUEST', requestId), { status: 400 });
  }
  let parsed;
  try {
    parsed = parseCompatibilityRequest(input);
  } catch (error) {
    if (error instanceof ZodError) return Response.json(validationErrorResponse(error, requestId), { status: 400 });
    return Response.json(apiErrorResponse('BAD_REQUEST', requestId), { status: 400 });
  }
  try {
    const products = await loadCompatibilityProducts(parsed);
    if (products.length !== parsed.products.length || parsed.products.some((item) => products.find((product) => product.id === item.productId)?.category !== item.category)) {
      return Response.json(apiErrorResponse('NOT_FOUND', requestId), { status: 404 });
    }
    return Response.json({ data: evaluateCompatibility(products), requestId });
  } catch {
    return Response.json(apiErrorResponse('UNAVAILABLE', requestId), { status: 503 });
  }
}
