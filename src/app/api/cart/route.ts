import { NextRequest, NextResponse } from 'next/server';
import { CartItemInputSchema, IdSchema, apiErrorResponse, validationErrorResponse } from '@/lib/schemas';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { anonymousCartTokenHash, ANONYMOUS_CART_COOKIE, ANONYMOUS_CART_COOKIE_MAX_AGE, createAnonymousCartCookieValue, isAuthSessionMissing } from '@/server/cart/anonymous-cookie';
import { CartApiError, getCart, putCartItem, removeCartItem } from '@/server/cart/cart-api';
import { createCartServiceClient } from '@/server/cart/service-client';
import { sameOrigin } from '@/server/auth/http';

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: ANONYMOUS_CART_COOKIE_MAX_AGE };
}

function errorResponse(error: unknown, id: string) {
  const code = error instanceof CartApiError ? error.code : 'UNAVAILABLE';
  const status = code === 'BAD_REQUEST' ? 400 : code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 503;
  return NextResponse.json(apiErrorResponse(code, id), { status, headers: { 'Cache-Control': 'no-store' } });
}

async function owner(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissing(error)) throw new CartApiError('UNAVAILABLE');
  const cookieValue = request.cookies.get(ANONYMOUS_CART_COOKIE)?.value;
  const tokenHash = anonymousCartTokenHash(cookieValue);
  return { supabase, user, cookieValue, tokenHash };
}

export async function GET(request: NextRequest): Promise<Response> {
  const id = crypto.randomUUID();
  let response: NextResponse;
  try {
    const resolved = await owner(request);
    if (!resolved.user && resolved.cookieValue && !resolved.tokenHash) throw new CartApiError('BAD_REQUEST');
    let tokenHash = resolved.tokenHash;
    let issuedCookie: string | null = null;
    const shouldIssue = !resolved.user && !tokenHash;
    if (shouldIssue) {
      issuedCookie = createAnonymousCartCookieValue();
      tokenHash = anonymousCartTokenHash(issuedCookie) ?? null;
    }
    const client = resolved.user ? resolved.supabase : createCartServiceClient();
    const data = await getCart(client, resolved.user ? null : tokenHash);
    response = NextResponse.json({ data, requestId: id }, { headers: { 'Cache-Control': 'no-store' } });
    if (issuedCookie) response.cookies.set(ANONYMOUS_CART_COOKIE, issuedCookie, cookieOptions());
    return response;
  } catch (error) { return errorResponse(error, id); }
}

export async function PUT(request: NextRequest): Promise<Response> {
  const id = crypto.randomUUID();
  if (!sameOrigin(request)) return NextResponse.json(apiErrorResponse('FORBIDDEN', id), { status: 403, headers: { 'Cache-Control': 'no-store' } });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json(apiErrorResponse('BAD_REQUEST', id), { status: 400 }); }
  const parsed = CartItemInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationErrorResponse(parsed.error, id), { status: 400 });
  let resolved: Awaited<ReturnType<typeof owner>> | null = null;
  let issuedCookie: string | null = null;
  let ownerTokenHash: string | null = null;
  try {
    resolved = await owner(request);
    if (!resolved.user && resolved.cookieValue && !resolved.tokenHash) throw new CartApiError('BAD_REQUEST');
    issuedCookie = !resolved.user && !resolved.tokenHash ? createAnonymousCartCookieValue() : null;
    ownerTokenHash = resolved.user ? null : resolved.tokenHash ?? anonymousCartTokenHash(issuedCookie!);
    const client = resolved.user ? resolved.supabase : createCartServiceClient();
    const data = await putCartItem(client, ownerTokenHash, parsed.data.productId, parsed.data.quantity);
    const response = NextResponse.json({ data, requestId: id }, { headers: { 'Cache-Control': 'no-store' } });
    if (issuedCookie) response.cookies.set(ANONYMOUS_CART_COOKIE, issuedCookie, cookieOptions());
    return response;
  } catch (error) {
    if (error instanceof CartApiError && error.code === 'CONFLICT' && resolved) {
      const base = apiErrorResponse('CONFLICT', id);
      let currentCart;
      try {
        const client = resolved.user ? resolved.supabase : createCartServiceClient();
        currentCart = await getCart(client, ownerTokenHash);
      } catch { return errorResponse(new CartApiError('UNAVAILABLE'), id); }
      const response = NextResponse.json({ ...base, error: { ...base.error, currentCart } }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      if (issuedCookie) response.cookies.set(ANONYMOUS_CART_COOKIE, issuedCookie, cookieOptions());
      return response;
    }
    return errorResponse(error, id);
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const id = crypto.randomUUID();
  if (!sameOrigin(request)) return NextResponse.json(apiErrorResponse('FORBIDDEN', id), { status: 403, headers: { 'Cache-Control': 'no-store' } });
  const productId = request.nextUrl.searchParams.get('productId');
  const parsedId = IdSchema.safeParse(productId);
  if (!parsedId.success) return NextResponse.json(apiErrorResponse('BAD_REQUEST', id), { status: 400 });
  try {
    const resolved = await owner(request);
    if (!resolved.user && resolved.cookieValue && !resolved.tokenHash) throw new CartApiError('BAD_REQUEST');
    if (!resolved.user && !resolved.tokenHash) throw new CartApiError('BAD_REQUEST');
    const client = resolved.user ? resolved.supabase : createCartServiceClient();
    const data = await removeCartItem(client, resolved.user ? null : resolved.tokenHash, parsedId.data);
    return NextResponse.json({ data, requestId: id }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error, id); }
}
