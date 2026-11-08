import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/server/auth/supabase';

const IdsSchema = z.array(z.uuid()).min(1).max(100);

export async function GET(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const rawIds = request.nextUrl.searchParams.get('ids')?.split(',') ?? [];
  const parsed = IdsSchema.safeParse(rawIds);
  if (!parsed.success || new Set(parsed.data).size !== parsed.data.length) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message: 'Invalid product IDs', requestId } }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.from('products')
      .select('id, category:categories(slug)')
      .in('id', parsed.data).eq('status', 'published').is('deleted_at', null);
    if (error || !data) throw new Error('Public product categories are unavailable');
    const categories = Object.fromEntries(data.flatMap((row) => {
      const relation = row.category;
      const category = Array.isArray(relation) ? relation[0] : relation;
      return typeof row.id === 'string' && category && typeof category.slug === 'string'
        ? [[row.id, category.slug]] : [];
    }));
    return NextResponse.json({ data: categories, requestId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { code: 'UNAVAILABLE', message: 'Product categories are unavailable', requestId } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
