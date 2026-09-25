import { NextRequest, NextResponse } from 'next/server';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      const isGoogle = data.user?.app_metadata.provider === 'google';
      if (isGoogle) return NextResponse.redirect(new URL(next, request.url));
      const query = new URLSearchParams({ confirmed: '1', next });
      if (data.user?.email) query.set('email', data.user.email);
      return NextResponse.redirect(new URL(`/verify?${query.toString()}`, request.url));
    }
  }
  return NextResponse.redirect(new URL('/verify?result=link-invalid', request.url));
}
