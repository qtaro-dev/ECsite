'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/Button';
import { StatusMessage } from '@/components/StatusMessage';
import styles from './address-manager.module.css';

type Address = {
  id: string; recipientName: string; postalCode: string; prefectureCode: number;
  city: string; street: string; building: string | null; isDefault: boolean;
};
type FormValue = Omit<Address, 'id'>;
type ApiReply = { data?: Address[] | Address | { deleted: boolean }; error?: { message?: string; fieldErrors?: Record<string, string[]> } };
const prefectures = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
const empty: FormValue = { recipientName: '', postalCode: '', prefectureCode: 13, city: '', street: '', building: '', isDefault: false };

export function AddressManager({ initialAddresses, returnTo }: { initialAddresses: Address[]; returnTo: string }) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [form, setForm] = useState<FormValue>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Address | null>(null);

  function startEdit(address: Address) {
    setEditing(address.id);
    const fields: FormValue = {
      recipientName: address.recipientName,
      postalCode: address.postalCode,
      prefectureCode: address.prefectureCode,
      city: address.city,
      street: address.street,
      building: address.building,
      isDefault: address.isDefault,
    };
    setForm({ ...fields, building: fields.building ?? '' });
    setFieldErrors({}); setMessage('');
  }
  function startNew() { setEditing(null); setForm({ ...empty }); setFieldErrors({}); setMessage(''); }
  function update<K extends keyof FormValue>(key: K, value: FormValue[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); setFieldErrors({});
    try {
      const response = await fetch('/api/account/addresses', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, building: form.building || null, ...(editing ? { addressId: editing } : {}) }),
      });
      const result = await response.json() as ApiReply;
      if (!response.ok) { setFieldErrors(result.error?.fieldErrors ?? {}); setMessage(result.error?.message ?? '保存できませんでした。入力内容を確認してください。'); return; }
      const saved = result.data as Address;
      setAddresses((current) => [...current.filter((item) => item.id !== saved.id).map((item) => saved.isDefault ? { ...item, isDefault: false } : item), saved].sort((a,b) => Number(b.isDefault)-Number(a.isDefault)));
      startNew(); router.refresh();
    } catch { setMessage('通信できませんでした。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!confirmDelete) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/account/addresses/${confirmDelete.id}`, { method: 'DELETE' });
      const result = await response.json() as ApiReply;
      if (!response.ok) { setMessage(result.error?.message ?? '削除できませんでした。時間をおいて再度お試しください。'); return; }
      setAddresses((current) => current.filter((item) => item.id !== confirmDelete.id)); setConfirmDelete(null); router.refresh();
    } catch { setMessage('通信できませんでした。時間をおいて再度お試しください。'); }
    finally { setBusy(false); }
  }

  const field = (key: keyof FormValue) => fieldErrors[key]?.[0];
  return <div className={styles.layout}>
    <section aria-labelledby="saved-addresses-heading">
      <div className={styles.heading}><div><p className={styles.eyebrow}>DELIVERY</p><h2 id="saved-addresses-heading">登録済みの配送先</h2></div><Button variant="secondary" type="button" onClick={startNew}>新しい配送先</Button></div>
      {addresses.length === 0 ? <StatusMessage kind="info" title="配送先はまだありません"><p>既定の配送先もありません。下のフォームから配送先を登録してください。</p></StatusMessage> : <>{!addresses.some((address) => address.isDefault) && <p>既定の配送先は設定されていません。購入時に住所を選ぶか、住所を既定に設定してください。</p>}<div className={styles.cards}>{addresses.map((address) => <article className={styles.card} key={address.id}>
        <div><h3>{address.recipientName}{address.isDefault && <span className={styles.badge}>既定</span>}</h3><p>〒{address.postalCode}</p><p>{prefectures[address.prefectureCode - 1]}{address.city}{address.street}</p>{address.building && <p>{address.building}</p>}</div>
        <div className={styles.actions}><Button variant="secondary" type="button" onClick={() => startEdit(address)}>編集</Button><Button variant="danger" type="button" onClick={() => setConfirmDelete(address)}>削除</Button></div>
      </article>)}</div></>}
    </section>
    {returnTo.startsWith('/checkout/') && <p><Link href={returnTo}>注文手続きに戻る</Link></p>}
    <section className={styles.formCard} aria-labelledby="address-form-heading">
      <p className={styles.eyebrow}>ADDRESS BOOK</p><h2 id="address-form-heading">{editing ? '配送先を編集' : '配送先を登録'}</h2>
      <StatusMessage kind="warning" title="デモでの住所入力"><p>実際に発送することはありません。公開デモでは、実在する個人情報を避け、架空の情報を入力してください。</p></StatusMessage>
      <form onSubmit={save} noValidate>
        <label htmlFor="recipientName">お届け先の氏名</label><input id="recipientName" value={form.recipientName} maxLength={80} autoComplete="name" onChange={(e) => update('recipientName', e.target.value)} aria-invalid={!!field('recipientName')} />{field('recipientName') && <p className={styles.error}>{field('recipientName')}</p>}
        <label htmlFor="postalCode">郵便番号（ハイフンなし）</label><input id="postalCode" inputMode="numeric" autoComplete="postal-code" maxLength={7} placeholder="1000001" value={form.postalCode} onChange={(e) => update('postalCode', e.target.value.replace(/[^0-9]/g, '').slice(0,7))} aria-invalid={!!field('postalCode')} />{field('postalCode') && <p className={styles.error}>{field('postalCode')}</p>}
        <label htmlFor="prefectureCode">都道府県</label><select id="prefectureCode" value={form.prefectureCode} autoComplete="address-level1" onChange={(e) => update('prefectureCode', Number(e.target.value))}>{prefectures.map((prefecture, index) => <option value={index + 1} key={prefecture}>{prefecture}</option>)}</select>{field('prefectureCode') && <p className={styles.error}>{field('prefectureCode')}</p>}
        <label htmlFor="city">市区町村</label><input id="city" value={form.city} maxLength={100} autoComplete="address-level2" onChange={(e) => update('city', e.target.value)} aria-invalid={!!field('city')} />{field('city') && <p className={styles.error}>{field('city')}</p>}
        <label htmlFor="street">番地</label><input id="street" value={form.street} maxLength={150} autoComplete="address-line1" onChange={(e) => update('street', e.target.value)} aria-invalid={!!field('street')} />{field('street') && <p className={styles.error}>{field('street')}</p>}
        <label htmlFor="building">建物・部屋番号（任意）</label><input id="building" value={form.building ?? ''} maxLength={100} autoComplete="address-line2" onChange={(e) => update('building', e.target.value)} aria-invalid={!!field('building')} />{field('building') && <p className={styles.error}>{field('building')}</p>}
        <label className={styles.checkbox}><input type="checkbox" checked={form.isDefault} onChange={(e) => update('isDefault', e.target.checked)} />この住所を既定にする</label>
        {message && <p className={styles.error} role="alert">{message}</p>}
        <div className={styles.actions}><Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存する'}</Button>{editing && <Button type="button" variant="secondary" onClick={startNew}>編集をやめる</Button>}</div>
      </form>
    </section>
    {confirmDelete && <div className={styles.dialogBackdrop}><section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description"><h2 id="delete-heading">配送先を削除しますか？</h2><p id="delete-description">{confirmDelete.recipientName} さん（〒{confirmDelete.postalCode}）を削除します。この操作は取り消せません。</p>{message && <p className={styles.error} role="alert">{message}</p>}<div className={styles.actions}><Button variant="danger" type="button" disabled={busy} onClick={remove}>削除する</Button><Button variant="secondary" type="button" disabled={busy} onClick={() => { setConfirmDelete(null); setMessage(''); }}>キャンセル</Button></div></section></div>}
  </div>;
}
