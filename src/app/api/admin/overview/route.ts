import { NextRequest } from 'next/server';
import { AdminOverviewSchema } from '@/lib/admin-schemas';
import { createAdminDataClient, getAdminOverview } from '@/server/admin/overview';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';

export async function GET(request: NextRequest) {
  const authorization = await authorizeAdminApi(request);
  if ('response' in authorization) return authorization.response;
  try {
    const data = await getAdminOverview(createAdminDataClient());
    return adminSuccess(AdminOverviewSchema.omit({ auditId: true }).parse(data), authorization.requestId);
  } catch {
    return adminError(503, authorization.requestId);
  }
}
