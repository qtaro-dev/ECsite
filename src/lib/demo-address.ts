import { z } from 'zod';

export const DemoRegionSchema = z.object({ prefectureCode: z.number().int().min(1).max(47) }).strict();

export function demoAddress(prefectureCode: number) {
  return {
    recipientName: 'デモ購入者', postalCode: '0000000', prefectureCode,
    city: '架空市', street: 'デモ専用1番地', building: null, isDefault: false,
  };
}

export function isDemoAddress(address: unknown): boolean {
  if (!address || typeof address !== 'object' || Array.isArray(address)) return false;
  const value = address as Record<string, unknown>;
  return DemoRegionSchema.safeParse({ prefectureCode: value.prefectureCode }).success
    && value.recipientName === 'デモ購入者' && value.postalCode === '0000000'
    && value.city === '架空市' && value.street === 'デモ専用1番地'
    && value.building == null;
}
