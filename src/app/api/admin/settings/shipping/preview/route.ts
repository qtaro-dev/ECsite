import { NextRequest, NextResponse } from 'next/server';
import { AdminShippingPreviewRequestSchema, AdminShippingPreviewResultSchema } from '@/lib/admin-shipping-schemas';
import { ApiErrorSchema, validationErrorResponse } from '@/lib/schemas';
import { calculateShippingAndTax, type ShippingSettings } from '@/server/shipping/calculator';
import { adminError, adminSuccess, authorizeAdminApi } from '@/server/admin/http';

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminApi(request, true);
  if ('response' in authorization) return authorization.response;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(ApiErrorSchema.parse({
      error: { code: 'BAD_REQUEST', message: '入力内容を確認してください。' }, requestId: authorization.requestId,
    }), { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const parsed = AdminShippingPreviewRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json(validationErrorResponse(parsed.error, authorization.requestId), {
    status: 400, headers: { 'Cache-Control': 'no-store' },
  });
  const input = parsed.data;
  const settings: ShippingSettings = {
    version: 'preview',
    originPrefectureCode: input.originPrefectureCode,
    baseFeeYen: input.baseFeeYen,
    freeThresholdYen: input.freeThresholdYen,
    heavyThresholdG: input.heavyThresholdG,
    yamatoSourceUrl: input.yamatoSourceUrl,
    sourceCheckedAt: input.sourceCheckedAt,
    isActive: true,
    heavyRuleJson: input.heavyRuleJson,
  };
  const result = calculateShippingAndTax({
    mode: 'final',
    items: input.items,
    address: { prefectureCode: input.destinationPrefectureCode },
    settings,
  });
  if (!result.ok) {
    const guidance: Record<typeof result.reason, { message: string; nextAction: string }> = {
      rate_unavailable: { message: '指定された発送元・お届け先・サイズの運賃行がありません。', nextAction: '重量物運賃表に該当する行を追加してください。' },
      rate_table_unavailable: { message: '重量物運賃表を読み取れません。', nextAction: '運賃表を確認して保存してください。' },
      package_unavailable: { message: '梱包サイズを算定できません。', nextAction: '商品の梱包寸法を入力してください。' },
      yamato_limit_exceeded: { message: '梱包寸法または重量が配送上限を超えています。', nextAction: '寸法・重量を確認してください。' },
      address_required: { message: 'お届け先を指定してください。', nextAction: '都道府県を選択してください。' },
      invalid_items: { message: '商品条件が正しくありません。', nextAction: '単価、数量、重量、梱包寸法を確認してください。' },
      invalid_settings: { message: '送料設定の形式を確認できません。', nextAction: '設定値と運賃表を確認してください。' },
      inactive_settings: { message: '送料設定が有効ではありません。', nextAction: '有効な設定を確認してください。' },
    };
    const { message, nextAction } = guidance[result.reason];
    return NextResponse.json({ error: { code: result.code, reason: result.reason, message, nextAction }, requestId: authorization.requestId }, {
      status: 422, headers: { 'Cache-Control': 'no-store' },
    });
  }
  const preview = AdminShippingPreviewResultSchema.safeParse({ quote: result.quote });
  if (!preview.success) return adminError(503, authorization.requestId);
  return adminSuccess(preview.data, authorization.requestId);
}
