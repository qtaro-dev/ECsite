import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  AddressPatchSchema,
  AddressSchema,
  ApiErrorSchema,
  ApiErrorCodeSchema,
  CartItemInputSchema,
  CompatibilityStatusSchema,
  IdSchema,
  OrderStatusSchema,
  ProductSortSchema,
  ProductSpecFilterSchema,
  ProductStatusSchema,
  ProductUseCaseSchema,
  QuantitySchema,
  QuoteRequestSchema,
  SearchQuerySchema,
  SmsFlowSchema,
  SmsPurposeSchema,
  YenSchema,
  apiErrorResponse,
  validationErrorResponse,
} from '../../src/lib/schemas';

const contract = parse(readFileSync(resolve(process.cwd(), 'docs/api/openapi.yaml'), 'utf8')) as {
  components: { schemas: Record<string, any>; parameters: Record<string, any> };
  paths: Record<string, { get?: { parameters?: Array<Record<string, any>> } }>;
};
const schemas = contract.components.schemas;
const sortParameter = contract.paths['/products'].get?.parameters?.find((parameter) => parameter.name === 'sort');
const usageParameter = contract.paths['/products'].get?.parameters?.find((parameter) => parameter.name === 'usage');

describe('shared boundary schemas', () => {
  it('accepts UUIDs and rejects malformed identifiers', () => {
    expect(IdSchema.safeParse('d2719f8c-2602-4bdb-a5e6-b8919668b3d9').success).toBe(true);
    expect(IdSchema.safeParse('product-1').success).toBe(false);
  });

  it('limits quantities to integer values from 1 through 10', () => {
    for (const value of [1, 10]) expect(QuantitySchema.safeParse(value).success).toBe(true);
    for (const value of [0, 11, 1.5, '2']) expect(QuantitySchema.safeParse(value).success).toBe(false);
    expect(YenSchema.safeParse(0).success).toBe(true);
    for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(YenSchema.safeParse(value).success).toBe(false);
  });

  it('validates search query bounds, integer URL parameters, and price ordering', () => {
    expect(SearchQuerySchema.parse({ q: 'gpu', minPrice: '1000', maxPrice: '2000', page: '2' })).toMatchObject({
      minPrice: 1000, maxPrice: 2000, page: 2,
    });
    expect(SearchQuerySchema.safeParse({ usage: 'gaming' }).success).toBe(true);
    expect(SearchQuerySchema.safeParse({ usage: 'workstation' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ minPrice: '1.5' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ minPrice: 2000, maxPrice: 1000 }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ unknown: 'ignored?' }).success).toBe(false);
    expect(SearchQuerySchema.parse({ spec: '{"socket_code":"AM5"}' }).spec).toEqual({ socket_code: 'AM5' });
    expect(SearchQuerySchema.safeParse({ spec: '{invalid' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ category: 'unknown' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ category: 'gpu', spec: '{"socket_code":"AM5"}' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ category: 'gpu', spec: '{"vram_gb":"12"}' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ category: 'gpu', spec: '{"vram_gb":12}' }).success).toBe(true);
    expect(ProductSpecFilterSchema.safeParse({ socket_code: 'AM5', core_count: 8 }).success).toBe(true);
    expect(ProductSpecFilterSchema.safeParse({ ['x'.repeat(65)]: 'value' }).success).toBe(false);
    expect(ProductSpecFilterSchema.safeParse(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`filter_${i}`, i]))).success).toBe(false);
  });

  it('validates domestic address and partial update boundaries', () => {
    const address = {
      recipientName: '山田 太郎', postalCode: '1000001', prefectureCode: 13,
      city: '千代田区', street: '千代田1-1', isDefault: false,
    };
    expect(AddressSchema.safeParse(address).success).toBe(true);
    expect(AddressSchema.safeParse({ ...address, postalCode: '100-0001' }).success).toBe(false);
    expect(AddressSchema.safeParse({ ...address, prefectureCode: 48 }).success).toBe(false);
    expect(AddressPatchSchema.safeParse({ addressId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9' }).success).toBe(false);
    expect(AddressPatchSchema.safeParse({ addressId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9', city: '港区' }).success).toBe(true);
  });

  it('accepts exactly one quote destination and quantity compliant cart input', () => {
    const address = {
      recipientName: '山田 太郎', postalCode: '1000001', prefectureCode: 13,
      city: '千代田区', street: '千代田1-1', isDefault: false,
    };
    expect(QuoteRequestSchema.safeParse({ address }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({ addressId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9' }).success).toBe(true);
    expect(QuoteRequestSchema.safeParse({}).success).toBe(false);
    expect(QuoteRequestSchema.safeParse({ address, addressId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9' }).success).toBe(false);
    expect(CartItemInputSchema.safeParse({ productId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9', quantity: 10 }).success).toBe(true);
    expect(CartItemInputSchema.safeParse({ productId: 'd2719f8c-2602-4bdb-a5e6-b8919668b3d9', quantity: 11 }).success).toBe(false);
  });

  it('uses the OpenAPI enum values and required fields', () => {
    expect(sortParameter).toBeDefined();
    expect(ProductSortSchema.options).toEqual(sortParameter?.schema.enum);
    expect(usageParameter).toBeDefined();
    expect(ProductUseCaseSchema.options).toEqual(usageParameter?.schema.enum);
    expect(CompatibilityStatusSchema.options).toEqual(schemas.CompatibilityFinding.properties.status.enum);
    expect(OrderStatusSchema.options).toEqual(schemas.CheckoutStatusResult.properties.status.enum);
    expect(ProductStatusSchema.options).toEqual(schemas.AdminProductFields.properties.status.enum);
    expect(SmsPurposeSchema.options).toEqual(schemas.SmsStart.properties.purpose.enum);
    expect(SmsFlowSchema.options).toEqual(schemas.SmsStart.properties.flow.enum);
    expect(contract.components.parameters.Q.schema.maxLength).toBe(100);
    expect(schemas.Address.required).toEqual(['recipientName', 'postalCode', 'prefectureCode', 'city', 'street', 'isDefault']);
    expect(schemas.CartItemInput.required).toEqual(['productId', 'quantity']);
    expect(schemas.CartItemInput.properties.quantity).toMatchObject({ minimum: 1, maximum: 10 });
    expect(schemas.Address.properties.postalCode.pattern).toBe('^[0-9]{7}$');
  });

  it('returns a safe error envelope without echoing submitted values', () => {
    const result = CartItemInputSchema.safeParse({ productId: 'secret-product-id', quantity: 999 });
    if (result.success) throw new Error('Expected invalid cart item');
    const response = validationErrorResponse(result.error, 'req-123');
    expect(ApiErrorSchema.safeParse(response).success).toBe(true);
    expect(JSON.stringify(response)).not.toContain('secret-product-id');
    expect(JSON.stringify(response)).not.toContain('999');
    const customMessage = 'secret-bearing validation detail: customer@example.test';
    const customIssue = z.string().refine(() => false, { message: customMessage }).safeParse('invalid');
    if (customIssue.success) throw new Error('Expected custom validation failure');
    const customValidation = validationErrorResponse(customIssue.error, 'req-456');
    expect(JSON.stringify(customValidation)).not.toContain(customMessage);
    expect(customValidation.error.fieldErrors).toEqual({ _: ['入力値が正しくありません。'] });

    const internalException = new Error('internal database exception: secret=do-not-return');
    const safeFailure = apiErrorResponse('UNAVAILABLE', 'req-789', internalException);
    expect(ApiErrorSchema.safeParse(safeFailure).success).toBe(true);
    expect(JSON.stringify(safeFailure)).not.toContain(internalException.message);
    expect(safeFailure.error.message).not.toBe(internalException.message);
    expect(ApiErrorCodeSchema.safeParse('INTERNAL_DATABASE_EXCEPTION').success).toBe(false);
  });
});
