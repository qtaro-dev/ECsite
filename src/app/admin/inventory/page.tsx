import { randomUUID } from 'node:crypto';
import { getAdminInventory } from '@/server/admin/inventory';
import { AdminInventoryResponseSchema } from '@/lib/admin-inventory-schemas';
import InventoryManager from './InventoryManager';

export const dynamic = 'force-dynamic';

export default async function AdminInventoryPage() {
  const auditId = randomUUID();
  let inventory;
  try {
    inventory = AdminInventoryResponseSchema.parse(await getAdminInventory());
  } catch {
    throw new Error(`在庫情報を読み込めませんでした。時間をおいて再度お試しください。（監査ID: ${auditId}）`);
  }
    return <InventoryManager initialInventory={inventory} />;
}
