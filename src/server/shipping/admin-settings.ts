import 'server-only';
import { createClient } from '@supabase/supabase-js';
import {
  AdminShippingSettingsResultSchema,
  type AdminShippingSettingsUpdate,
} from '@/lib/admin-shipping-schemas';

const SHIPPING_COLUMNS = 'id,version,origin_prefecture_code,base_fee_yen,free_threshold_yen,heavy_threshold_g,heavy_rule_json,yamato_source_url,source_checked_at,active_from,is_active';

export class ShippingSettingsError extends Error {
  constructor(readonly databaseCode: string) { super('Shipping settings operation failed'); }
}

function createShippingSettingsClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Shipping settings database configuration is unavailable');
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function toAdminSetting(value: Record<string, unknown>) {
  const rawRates = value.heavy_rule_json;
  const heavyRuleJson = typeof rawRates === 'object' && rawRates !== null && !Array.isArray(rawRates)
    && Array.isArray((rawRates as Record<string, unknown>).rates)
    ? rawRates
    : { rates: [] };
  return {
    id: value.id,
    version: value.version,
    originPrefectureCode: value.origin_prefecture_code,
    baseFeeYen: value.base_fee_yen,
    freeThresholdYen: value.free_threshold_yen,
    heavyThresholdG: value.heavy_threshold_g,
    heavyRuleJson,
    yamatoSourceUrl: value.yamato_source_url,
    sourceCheckedAt: value.source_checked_at,
    activeFrom: value.active_from,
    isActive: value.is_active,
  };
}

export async function readAdminShippingSettings(auditId: string) {
  const client = createShippingSettingsClient();
  const { data, error } = await client.from('shipping_settings')
    .select(SHIPPING_COLUMNS).order('active_from', { ascending: false }).limit(10);
  if (error) throw new ShippingSettingsError(error.code ?? 'UNAVAILABLE');
  const rows = (data ?? []).map((row) => toAdminSetting(row as Record<string, unknown>));
  const active = rows.find((setting) => setting.isActive === true);
  if (!active) throw new ShippingSettingsError('P0001');
  return AdminShippingSettingsResultSchema.parse({ active, history: rows, auditId });
}

export async function saveAdminShippingSettings(
  values: AdminShippingSettingsUpdate,
  actorId: string,
  requestId: string,
) {
  const client = createShippingSettingsClient();
  const { error } = await client.rpc('admin_update_shipping_settings', {
    p_expected_version: values.expectedVersion,
    p_origin_prefecture_code: values.originPrefectureCode,
    p_base_fee_yen: values.baseFeeYen,
    p_free_threshold_yen: values.freeThresholdYen,
    p_heavy_threshold_g: values.heavyThresholdG,
    p_heavy_rule_json: values.heavyRuleJson,
    p_yamato_source_url: values.yamatoSourceUrl,
    p_source_checked_at: values.sourceCheckedAt,
    p_actor_id: actorId,
    p_request_id: requestId,
  });
  if (error) throw new ShippingSettingsError(error.code ?? 'UNAVAILABLE');
  return readAdminShippingSettings(requestId);
}
