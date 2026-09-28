import { CheckoutResult } from '@/features/orders/CheckoutResult';

export default async function CheckoutResultPage({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  const params = await searchParams;
  return <CheckoutResult orderId={params.orderId ?? null} />;
}
