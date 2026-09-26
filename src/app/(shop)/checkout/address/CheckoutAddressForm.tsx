'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AddressSchema } from '@/lib/schemas';
import { CheckoutQuoteApiResponseSchema, type CheckoutQuoteResult } from '@/lib/checkout-quote-schemas';
import styles from './page.module.css';

type SavedAddress = {
  id: string; recipientName: string; postalCode: string; prefectureCode: number;
  city: string; street: string; building: string | null; isDefault: boolean;
};
type Envelope<T> = { data?: T; error?: { code?: string; message?: string }; requestId?: string };

const prefectures = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

export function CheckoutAddressForm({ addresses }: { addresses: SavedAddress[] }) {
  const router = useRouter();
  const [newAddress, setNewAddress] = useState(addresses.length === 0);
  const [selectedId, setSelectedId] = useState(addresses[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState({ recipientName: '', postalCode: '', prefectureCode: 13, city: '', street: '', building: '' });

  async function requestQuote(addressId: string) {
    const response = await fetch('/api/checkout/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressId }),
    });
    const body = await response.json() as Envelope<unknown>;
    if (!response.ok) throw new Error(body.error?.message ?? '正式見積を作成できませんでした。');
    const parsed = CheckoutQuoteApiResponseSchema.parse(body);
    window.sessionStorage.setItem('checkoutQuote', JSON.stringify(parsed.data));
    return parsed.data;
  }

  async function continueToQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId && !newAddress) { setMessage('配送先を選択してください。'); return; }
    setBusy(true); setMessage('');
    try {
      let addressId = selectedId;
      if (newAddress) {
        const parsed = AddressSchema.safeParse({ ...fields, building: fields.building || null, isDefault: addresses.length === 0 });
        if (!parsed.success) { setMessage('住所の各項目を確認してください。'); return; }
        const saveResponse = await fetch('/api/account/addresses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data),
        });
        const saved = await saveResponse.json() as Envelope<SavedAddress>;
        if (!saveResponse.ok || !saved.data?.id) throw new Error(saved.error?.message ?? '配送先を登録できませんでした。');
        addressId = saved.data.id;
      }
      const quote: CheckoutQuoteResult = await requestQuote(addressId);
      if (Date.parse(quote.expiresAt) <= Date.now()) throw new Error('見積の有効期限が切れました。再度お見積もりください。');
      router.push('/checkout/review');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '処理に失敗しました。再度お試しください。');
    } finally { setBusy(false); }
  }

  return <form className={styles.form} onSubmit={continueToQuote}>
    {addresses.length > 0 && <fieldset>
      <legend>登録済みの配送先</legend>
      {addresses.map((address) => <label className={styles.addressChoice} key={address.id}>
        <input type="radio" name="addressId" value={address.id} checked={!newAddress && selectedId === address.id} onChange={() => { setNewAddress(false); setSelectedId(address.id); }} />
        <span><strong>{address.recipientName}</strong>{address.isDefault && <span className={styles.default}>既定</span>}<br />〒{address.postalCode}<br />{prefectures[address.prefectureCode - 1]}{address.city}{address.street}{address.building ? ` ${address.building}` : ''}</span>
      </label>)}
    </fieldset>}
    <fieldset>
      <legend>今回のお届け先</legend>
      <label className={styles.addressChoice}><input type="radio" name="addressChoice" checked={newAddress} onChange={() => setNewAddress(true)} />新しい配送先を登録する</label>
      {newAddress && <div className={styles.fields}>
        <label>お名前<input autoComplete="name" maxLength={80} required value={fields.recipientName} onChange={(event) => setFields({ ...fields, recipientName: event.target.value })} /></label>
        <label>郵便番号（ハイフンなし）<input autoComplete="postal-code" inputMode="numeric" pattern="[0-9]{7}" maxLength={7} required value={fields.postalCode} onChange={(event) => setFields({ ...fields, postalCode: event.target.value })} /></label>
        <label>都道府県<select autoComplete="address-level1" value={fields.prefectureCode} onChange={(event) => setFields({ ...fields, prefectureCode: Number(event.target.value) })}>{prefectures.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
        <label>市区町村<input autoComplete="address-level2" maxLength={100} required value={fields.city} onChange={(event) => setFields({ ...fields, city: event.target.value })} /></label>
        <label>番地<input autoComplete="address-line1" maxLength={150} required value={fields.street} onChange={(event) => setFields({ ...fields, street: event.target.value })} /></label>
        <label>建物名・部屋番号（任意）<input autoComplete="address-line2" maxLength={100} value={fields.building} onChange={(event) => setFields({ ...fields, building: event.target.value })} /></label>
        <p className={styles.note}>新しい配送先は会員の配送先一覧へ登録してから見積もります。公開デモでは架空の住所を入力してください。</p>
      </div>}
    </fieldset>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <button className={styles.primary} type="submit" disabled={busy}>{busy ? '商品・在庫・送料を確認中…' : '住所を確認して正式見積へ'}</button>
    <a href="/cart">カートに戻る</a>
  </form>;
}
