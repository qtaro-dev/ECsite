import { NextRequest, NextResponse } from 'next/server';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const isGoogleFlow = request.nextUrl.searchParams.get('flow') === 'google';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      const isGoogle = data.user?.app_metadata.provider === 'google';
      if (isGoogle) return NextResponse.redirect(new URL(next, siteUrl));
      const query = new URLSearchParams({ confirmed: '1', next });
      if (data.user?.email) query.set('email', data.user.email);
      return NextResponse.redirect(new URL(`/verify?${query.toString()}`, siteUrl));
    }
  }
  if (isGoogleFlow) return NextResponse.redirect(new URL('/login?error=google', siteUrl));
  return NextResponse.redirect(new URL('/verify?result=link-invalid', siteUrl));
}
