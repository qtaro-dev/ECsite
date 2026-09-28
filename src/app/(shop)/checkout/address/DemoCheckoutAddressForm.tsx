'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckoutQuoteApiResponseSchema } from '@/lib/checkout-quote-schemas';
import styles from './page.module.css';

const regions = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
type Envelope = { data?: { id?: string }; error?: { message?: string } };

export function DemoCheckoutAddressForm() {
  const router = useRouter();
  const [prefectureCode, setPrefectureCode] = useState(13);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function continueToQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const addressResponse = await fetch('/api/checkout/demo-address', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefectureCode }),
      });
      const address = await addressResponse.json() as Envelope;
      if (!addressResponse.ok || !address.data?.id) throw new Error(address.error?.message ?? 'デモ配送先を用意できませんでした。');
      const quoteResponse = await fetch('/api/checkout/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressId: address.data.id }),
      });
      const quoteBody = await quoteResponse.json() as Envelope;
      if (!quoteResponse.ok) throw new Error(quoteBody.error?.message ?? '正式見積を作成できませんでした。');
      const quote = CheckoutQuoteApiResponseSchema.parse(quoteBody).data;
      if (Date.parse(quote.expiresAt) <= Date.now()) throw new Error('見積の有効期限が切れました。再度お見積もりください。');
      window.sessionStorage.setItem('checkoutQuote', JSON.stringify(quote));
      router.push('/checkout/review');
    } catch (error) { setMessage(error instanceof Error ? error.message : '再試行してください。'); }
    finally { setBusy(false); }
  }

  return <form className={styles.form} onSubmit={continueToQuote}>
    <p className={styles.note}>これは架空データだけを使うデモです。販売・課金・発送は行いません。氏名、実住所、電話番号、メールアドレスを入力しないでください。</p>
    <label htmlFor="demo-region">送料を試す地域</label>
    <select id="demo-region" value={prefectureCode} onChange={(event) => setPrefectureCode(Number(event.target.value))}>
      {regions.map((region, index) => <option key={region} value={index + 1}>{region}</option>)}
    </select>
    <p>配送先は選択した地域の「デモ購入者・〒0000000・架空市デモ専用1番地」を自動で用意します。</p>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <button className={styles.primary} type="submit" disabled={busy}>{busy ? '正式見積を作成中…' : '架空配送先で正式見積へ'}</button>
    <a href="/cart">カートに戻る</a>
  </form>;
}
