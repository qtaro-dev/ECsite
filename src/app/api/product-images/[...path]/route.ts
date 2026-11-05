const segmentPattern = /^[\p{L}\p{N}._ -]+$/u;

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await params;
  if (!path.length || path.length > 12 || path.some((part) => part === '.' || part === '..' || !segmentPattern.test(part))) {
    return new Response(null, { status: 404 });
  }
  const objectPath = path.join('/');
  if (objectPath.length > 512) return new Response(null, { status: 404 });

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!baseUrl || !anonKey) return new Response(null, { status: 503 });
  const headers = new Headers({ apikey: anonKey });
  if (!anonKey.startsWith('sb_publishable_')) {
    // Hosted Storage requires a bearer token for a legacy anon JWT.
    // Refuse other key types so this proxy always uses the anonymous RLS role.
    const legacyKey = /^eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(anonKey);
    if (!legacyKey) return new Response(null, { status: 503 });
    try {
      const payload: unknown = JSON.parse(Buffer.from(legacyKey[1], 'base64url').toString('utf8'));
      if (typeof payload !== 'object' || payload === null || !('role' in payload) || payload.role !== 'anon') {
        return new Response(null, { status: 503 });
      }
    } catch {
      return new Response(null, { status: 503 });
    }
    headers.set('Authorization', `Bearer ${anonKey}`);
  }
  const encodedPath = path.map(encodeURIComponent).join('/');
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, '')}/storage/v1/object/authenticated/product-images/${encodedPath}`, {
      headers,
      cache: 'no-store',
    });
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status === 404 ? 404 : 403 });
  const contentType = upstream.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    await upstream.body.cancel();
    return new Response(null, { status: 415 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
