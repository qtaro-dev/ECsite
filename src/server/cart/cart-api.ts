import 'server-only';
import { CartMergeResultSchema, CartProjectionSchema, type CartMergeResult, type CartProjection } from '@/lib/schemas';

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

function throwRpcError(error: { code?: string; message?: string }): never {
  if (error.code === 'P0001' || error.message === 'cart stock conflict') throw new CartApiError('CONFLICT');
  if (error.code === 'P0002' || error.message === 'cart product unavailable') throw new CartApiError('NOT_FOUND');
  if (error.code === '22023') throw new CartApiError('BAD_REQUEST');
  if (error.code === '42501') throw new CartApiError('UNAUTHORIZED');
  throw new CartApiError('UNAVAILABLE');
}

export class CartApiError extends Error {
  constructor(readonly code: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE') { super(code); }
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) throwRpcError(error);
  return data;
}

export async function getCart(client: RpcClient, anonymousTokenHash: string | null): Promise<CartProjection> {
  return CartProjectionSchema.parse(await rpc(client, 'cart_get', { p_anonymous_token_hash: anonymousTokenHash }));
}

export async function putCartItem(client: RpcClient, anonymousTokenHash: string | null, productId: string, quantity: number): Promise<CartProjection> {
  return CartProjectionSchema.parse(await rpc(client, 'cart_put', {
    p_anonymous_token_hash: anonymousTokenHash, p_product_id: productId, p_quantity: quantity,
  }));
}

export async function mergeCart(client: RpcClient, anonymousTokenHash: string): Promise<CartMergeResult> {
  return CartMergeResultSchema.parse(await rpc(client, 'cart_merge', { p_anonymous_token_hash: anonymousTokenHash }));
}

export async function removeCartItem(client: RpcClient, anonymousTokenHash: string | null, productId: string): Promise<CartProjection> {
  return CartProjectionSchema.parse(await rpc(client, 'cart_remove', { p_anonymous_token_hash: anonymousTokenHash, p_product_id: productId }));
}
