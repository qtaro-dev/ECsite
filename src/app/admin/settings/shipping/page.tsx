import { randomUUID } from 'node:crypto';
import { AdminShippingSettingsForm } from './ShippingSettingsForm';
import { readAdminShippingSettings } from '@/server/shipping/admin-settings';

export const dynamic = 'force-dynamic';

export default async function AdminShippingSettingsPage() {
  let settings;
  try { settings = await readAdminShippingSettings(randomUUID()); }
  catch { throw new Error('送料設定を読み込めませんでした。時間をおいて再度お試しください。'); }
  return <AdminShippingSettingsForm settings={settings} />;
}
