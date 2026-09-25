import { NextRequest, NextResponse } from 'next/server';
import { safeReturnPath } from '@/server/auth/safe-return-path';
import { createSupabaseServerClient } from '@/server/auth/supabase';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const next = safeReturnPath(request.nextUrl.searchParams.get('next'));
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const callback = new URL('/auth/callback', siteUrl);
  callback.searchParams.set('next', next);
  callback.searchParams.set('flow', 'google');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      scopes: 'openid email profile',
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(new URL('/login?error=google', siteUrl));
  }
  return NextResponse.redirect(data.url);
}
