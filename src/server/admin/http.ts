import { NextResponse, type NextRequest } from 'next/server';
import { ApiErrorSchema } from '@/lib/schemas';
import { requireAdminAccess } from '@/server/admin/authorization';
import { sameOrigin } from '@/server/auth/http';

export function adminRequestId() { return crypto.randomUUID(); }

export function adminError(status: 401 | 403 | 503, requestId = adminRequestId()) {
  const code = status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE';
  const message = status === 401 ? '認証が必要です。'
    : status === 403 ? 'この操作を実行する権限がありません。'
      : '現在サービスを利用できません。時間をおいて再度お試しください。';
  return NextResponse.json(ApiErrorSchema.parse({ error: { code, message }, requestId }), {
    status, headers: { 'Cache-Control': 'no-store' },
  });
}

export async function authorizeAdminApi(request: NextRequest, mutation = false) {
  const requestId = adminRequestId();
  if (mutation && !sameOrigin(request)) return { response: adminError(403, requestId), requestId } as const;
  const access = await requireAdminAccess();
  if (access.kind === 'denied') return { response: adminError(access.status, requestId), requestId } as const;
  return { access, requestId } as const;
}

export function adminSuccess<T>(data: T, requestId: string) {
  return NextResponse.json({ data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
}
