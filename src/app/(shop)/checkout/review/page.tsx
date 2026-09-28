import { CheckoutReview } from './CheckoutReview';
import { createSupabaseServerClient } from '@/server/auth/supabase';
import { isDemoUser } from '@/lib/demo-auth';

export default async function CheckoutReviewPage() {
  let demo = false;
  try {
    const client = await createSupabaseServerClient();
    const { data: { user } } = await client.auth.getUser();
    demo = isDemoUser(user);
  } catch { /* The checkout API still requires a verified session. */ }
  return <CheckoutReview demo={demo} />;
}
