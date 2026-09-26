import { createSupabaseServerClient } from '@/server/auth/supabase';
import { IdSchema } from '@/lib/schemas';
import { CartScreen } from '@/features/cart/CartScreen';

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function CartPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const productIdValue = single(query.productId);
  const productId = productIdValue && IdSchema.safeParse(productIdValue).success ? productIdValue : null;
  const quantityValue = single(query.quantity);
  const parsedQuantity = quantityValue && /^[0-9]+$/.test(quantityValue) ? Number(quantityValue) : 1;
  const quantity = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 10 ? parsedQuantity : 1;

  let isMember = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    isMember = !error && Boolean(user);
  } catch {
    // The cart page remains usable anonymously if auth is temporarily unavailable.
  }

  return <CartScreen isMember={isMember} initialProduct={productId ? { productId, quantity } : null} />;
}