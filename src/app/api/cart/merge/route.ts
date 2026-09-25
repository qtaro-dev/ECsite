import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/schemas';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { sameOrigin } from '@/server/auth/http';
import { anonymousCartTokenHash, ANONYMOUS_CART_COOKIE, isAuthSessionMissing } from '@/server/cart/anonymous-cookie';
import { CartApiError, getCart, mergeCart } from '@/server/cart/cart-api';

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (!sameOrigin(request)) return NextResponse.json(apiErrorResponse('FORBIDDEN', requestId), { status: 403, headers: { 'Cache-Control': 'no-store' } });
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError && !isAuthSessionMissing(authError)) throw new CartApiError('UNAVAILABLE');
    if (!user) throw new CartApiError('UNAUTHORIZED');
    const cookie = request.cookies.get(ANONYMOUS_CART_COOKIE)?.value;
    const tokenHash = anonymousCartTokenHash(cookie);
    if (cookie && !tokenHash) throw new CartApiError('BAD_REQUEST');
    const data = tokenHash ? await mergeCart(supabase, tokenHash) : { cart: await getCart(supabase, null), adjustments: [] };
    const response = NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    if (tokenHash) response.cookies.set(ANONYMOUS_CART_COOKIE, '', {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0,
    });
    return response;
  } catch (error) {
    const code = error instanceof CartApiError ? error.code : 'UNAVAILABLE';
    const status = code === 'BAD_REQUEST' ? 400 : code === 'UNAUTHORIZED' ? 401 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 503;
    return NextResponse.json(apiErrorResponse(code, requestId), { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
