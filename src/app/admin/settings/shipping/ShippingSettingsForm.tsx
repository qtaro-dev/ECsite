'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AdminShippingPreviewResultSchema,
  AdminShippingSettingsResultSchema,
  ShippingSettingsFieldsSchema,
  type AdminShippingSettingsResult,
  type AdminShippingPreviewQuote,
  type ShippingRate,
} from '@/lib/admin-shipping-schemas';
import { YAMATO_SOURCE_URL } from '@/server/shipping/calculator';
import styles from './shipping.module.css';

const prefectures = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県',
  '埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県',
  '岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
  '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県',
  '佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県',
];
const sizeCodes = [60, 80, 100, 120, 140, 160, 180, 200] as const;

type SettingsResult = AdminShippingSettingsResult;
type FormValues = {
  originPrefectureCode: number;
  baseFeeYen: number;
  freeThresholdYen: number;
  heavyThresholdG: 20000;
  rates: ShippingRate[];
  yamatoSourceUrl: string;
  sourceCheckedAt: string;
};
type ApiEnvelope<T> = { data?: T; requestId?: string; error?: { code?: string; message?: string; nextAction?: string } };

function dateInputValue(value: string | null) { return value?.slice(0, 10) ?? ''; }
function dateTimeValue(value: string) { return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null; }

function formValues(settings: SettingsResult['active']): FormValues {
  return {
    originPrefectureCode: settings.originPrefectureCode,
    baseFeeYen: settings.baseFeeYen,
    freeThresholdYen: settings.freeThresholdYen,
    heavyThresholdG: 20000,
    rates: settings.heavyRuleJson.rates as ShippingRate[],
    yamatoSourceUrl: settings.yamatoSourceUrl || YAMATO_SOURCE_URL,
    sourceCheckedAt: dateInputValue(settings.sourceCheckedAt),
  };
}

function compareChanges(before: FormValues, after: FormValues) {
  const changes: string[] = [];
  if (before.originPrefectureCode !== after.originPrefectureCode) changes.push(`発送元: ${prefectures[before.originPrefectureCode - 1]} → ${prefectures[after.originPrefectureCode - 1]}`);
  if (before.baseFeeYen !== after.baseFeeYen) changes.push(`通常送料: ${before.baseFeeYen.toLocaleString('ja-JP')}円 → ${after.baseFeeYen.toLocaleString('ja-JP')}円`);
  if (before.freeThresholdYen !== after.freeThresholdYen) changes.push(`送料無料閾値: ${before.freeThresholdYen.toLocaleString('ja-JP')}円 → ${after.freeThresholdYen.toLocaleString('ja-JP')}円`);
  if (before.rates.length !== after.rates.length || JSON.stringify(before.rates) !== JSON.stringify(after.rates)) changes.push(`重量物運賃行: ${before.rates.length}行 → ${after.rates.length}行`);
  if (before.yamatoSourceUrl !== after.yamatoSourceUrl) changes.push('公式出典URLを変更');
  if (before.sourceCheckedAt !== after.sourceCheckedAt) changes.push(`公式情報確認日: ${before.sourceCheckedAt || '未登録'} → ${after.sourceCheckedAt || '未登録'}`);
  return changes;
}

export function AdminShippingSettingsForm({ settings: initialSettings }: { settings: SettingsResult }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [values, setValues] = useState(() => formValues(initialSettings.active));
  const [confirmChanges, setConfirmChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [auditId, setAuditId] = useState(initialSettings.auditId);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<AdminShippingPreviewQuote | null>(null);
  const [trial, setTrial] = useState({
    unitPriceYen: 9999, quantity: 1, weightG: 20000, packLengthMm: 300,
    packWidthMm: 200, packHeightMm: 100, destinationPrefectureCode: 13,
  });
  const initialValues = formValues(settings.active);
  const changes = compareChanges(initialValues, values);

  function setField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setConfirmChanges(false);
    setNotice(null);
  }

  function setRate(index: number, key: keyof ShippingRate, value: number) {
    setValues((current) => ({
      ...current,
      rates: current.rates.map((rate, row) => row === index ? { ...rate, [key]: value } : rate),
    }));
    setConfirmChanges(false);
    setNotice(null);
  }

  function fields() {
    return ShippingSettingsFieldsSchema.parse({
      originPrefectureCode: values.originPrefectureCode,
      baseFeeYen: values.baseFeeYen,
      freeThresholdYen: values.freeThresholdYen,
      heavyThresholdG: 20000,
      heavyRuleJson: { rates: values.rates },
      yamatoSourceUrl: values.yamatoSourceUrl,
      sourceCheckedAt: dateTimeValue(values.sourceCheckedAt),
    });
  }

  async function save() {
    let valid;
    try { valid = fields(); }
    catch { setNotice({ kind: 'error', text: '入力値と公式料金表の行を確認してください。' }); return; }
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/settings/shipping', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...valid, expectedVersion: settings.active.version }),
      });
      const body = await response.json() as ApiEnvelope<SettingsResult>;
      if (!response.ok || !body.data) {
        setNotice({ kind: 'error', text: body.error?.message ?? '保存できませんでした。入力値と現在の版を確認してください。' });
        return;
      }
      const parsed = AdminShippingSettingsResultSchema.parse(body.data);
      setSettings(parsed);
      setValues(formValues(parsed.active));
      setAuditId(parsed.auditId);
      setConfirmChanges(false);
      setNotice({ kind: 'success', text: `新しい送料規則版を保存しました: ${parsed.active.version}` });
      router.refresh();
    } catch {
      setNotice({ kind: 'error', text: '通信に失敗しました。入力は保持されています。再度お試しください。' });
    } finally { setBusy(false); }
  }

  async function calculatePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let valid;
    try { valid = fields(); }
    catch { setNotice({ kind: 'error', text: '試算前に送料設定と運賃表を確認してください。' }); return; }
    setPreviewBusy(true);
    setNotice(null);
    setPreview(null);
    try {
      const response = await fetch('/api/admin/settings/shipping/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...valid, destinationPrefectureCode: trial.destinationPrefectureCode, items: [{
          unitPriceYen: trial.unitPriceYen, quantity: trial.quantity, weightG: trial.weightG,
          packLengthMm: trial.packLengthMm, packWidthMm: trial.packWidthMm, packHeightMm: trial.packHeightMm,
        }] }),
      });
      const body = await response.json() as ApiEnvelope<unknown>;
      if (!response.ok || !body.data) {
        setNotice({ kind: 'error', text: [body.error?.message, body.error?.nextAction].filter(Boolean).join(' ') || 'この条件では試算できません。' });
        return;
      }
      const parsed = AdminShippingPreviewResultSchema.parse(body.data);
      setPreview(parsed.quote);
    } catch {
      setNotice({ kind: 'error', text: '試算に失敗しました。入力値を確認して再度お試しください。' });
    } finally { setPreviewBusy(false); }
  }

  function addRate() {
    setValues((current) => ({ ...current, rates: [...current.rates, {
      originPrefectureCode: current.originPrefectureCode,
      destinationPrefectureCode: 13,
      sizeCode: 160,
      feeYen: 0,
    }] }));
    setConfirmChanges(false);
    setNotice(null);
  }

  return (
    <main className={styles.page}>
      <h1>A05 送料設定</h1>
      <p className={styles.lead}>変更は新しい版として保存されます。新しい注文から適用し、作成済み注文の送料と発送元は変更しません。</p>
      <section className={styles.current} aria-label="現在有効な送料規則">
        <p>現在有効な版: <strong>{settings.active.version}</strong></p>
        <p>適用開始: <time dateTime={settings.active.activeFrom}>{new Date(settings.active.activeFrom).toLocaleString('ja-JP')}</time></p>
      </section>

      {notice && <p className={notice.kind === 'error' ? styles.error : notice.kind === 'success' ? styles.success : styles.info} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); setConfirmChanges(true); setNotice(null); }}>
        <fieldset>
          <legend>通常送料</legend>
          <label>発送元の都道府県
            <select value={values.originPrefectureCode} onChange={(event) => setField('originPrefectureCode', Number(event.target.value))}>
              {prefectures.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
          </label>
          <label>全国一律の通常送料（税込・円）
            <input type="number" min={0} max={2147483647} step={1} value={values.baseFeeYen} onChange={(event) => setField('baseFeeYen', Number(event.target.value))} required />
          </label>
          <label>通常送料が無料になる商品小計（税込・円）
            <input type="number" min={0} max={2147483647} step={1} value={values.freeThresholdYen} onChange={(event) => setField('freeThresholdYen', Number(event.target.value))} required />
          </label>
          <p className={styles.note}>重量物の境界は20,000g（20kg）固定です。北海道・沖縄県も通常送料の対象で、離島という理由の加算はありません。</p>
        </fieldset>

        <fieldset>
          <legend>重量物運賃表</legend>
          <p className={styles.note}>20kg以上の商品は1点1梱包で加算します。料金表に該当行がない注文の確定見積は利用できません。</p>
          <a href={values.yamatoSourceUrl} target="_blank" rel="noreferrer">ヤマト運輸の公式料金表（別タブで開く）</a>
          <div className={styles.tableWrap}>
            <table>
              <caption>発送元・お届け先・梱包サイズごとの税込運賃</caption>
              <thead><tr><th scope="col">発送元</th><th scope="col">お届け先</th><th scope="col">サイズ</th><th scope="col">運賃（税込・円）</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {values.rates.map((rate, index) => <tr key={`${index}-${rate.originPrefectureCode}-${rate.destinationPrefectureCode}-${rate.sizeCode}`}>
                  <td data-label="発送元"><select aria-label={`運賃行${index + 1} 発送元`} value={rate.originPrefectureCode} onChange={(event) => setRate(index, 'originPrefectureCode', Number(event.target.value))}>{prefectures.map((name, code) => <option key={name} value={code + 1}>{name}</option>)}</select></td>
                  <td data-label="お届け先"><select aria-label={`運賃行${index + 1} お届け先`} value={rate.destinationPrefectureCode} onChange={(event) => setRate(index, 'destinationPrefectureCode', Number(event.target.value))}>{prefectures.map((name, code) => <option key={name} value={code + 1}>{name}</option>)}</select></td>
                  <td data-label="サイズ"><select aria-label={`運賃行${index + 1} サイズ`} value={rate.sizeCode} onChange={(event) => setRate(index, 'sizeCode', Number(event.target.value) as ShippingRate['sizeCode'])}>{sizeCodes.map((size) => <option key={size} value={size}>{size}サイズ</option>)}</select></td>
                  <td data-label="運賃"><input aria-label={`運賃行${index + 1} 料金`} type="number" min={0} max={2147483647} step={1} value={rate.feeYen} onChange={(event) => setRate(index, 'feeYen', Number(event.target.value))} required /></td>
                  <td data-label="操作"><button className={styles.remove} type="button" onClick={() => setField('rates', values.rates.filter((_, row) => row !== index))}>削除</button></td>
                </tr>)}
                {values.rates.length === 0 && <tr><td colSpan={5}>運賃表がありません。重量物を含む確定見積は算定できません。</td></tr>}
              </tbody>
            </table>
          </div>
          <button type="button" className={styles.secondary} onClick={addRate}>運賃行を追加</button>
          <label>公式情報の確認日
            <input type="date" value={values.sourceCheckedAt} onChange={(event) => setField('sourceCheckedAt', event.target.value)} />
          </label>
          <label>公式出典URL
            <input type="url" value={values.yamatoSourceUrl} onChange={(event) => setField('yamatoSourceUrl', event.target.value)} required />
          </label>
          <p className={styles.note}>運賃を登録する場合は、ヤマト運輸公式情報の確認日が必要です。非公式ドメインのURLは保存できません。</p>
        </fieldset>

        {!confirmChanges ? <button className={styles.primary} type="submit" disabled={busy || changes.length === 0}>変更内容を確認</button>
          : <section className={styles.diff} aria-label="保存前の変更内容" aria-live="polite">
            <h2>この変更を新しい版として保存しますか？</h2>
            {changes.length === 0 ? <p>設定に変更はありません。</p> : <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul>}
            <div className={styles.actions}>
              <button className={styles.primary} type="button" disabled={busy || changes.length === 0} onClick={save}>{busy ? '保存中…' : 'この内容で保存'}</button>
              <button className={styles.secondary} type="button" disabled={busy} onClick={() => setConfirmChanges(false)}>編集へ戻る</button>
            </div>
          </section>}
      </form>

      <section className={styles.preview}>
        <h2>送料ルールの試算</h2>
        <p className={styles.note}>入力した下書き設定をサーバー上の共通計算器で計算します。保存は行いません。</p>
        <form onSubmit={calculatePreview}>
          <label>商品単価（税込・円）<input type="number" min={0} max={2147483647} step={1} value={trial.unitPriceYen} onChange={(event) => setTrial({ ...trial, unitPriceYen: Number(event.target.value) })} /></label>
          <label>数量<input type="number" min={1} max={10} step={1} value={trial.quantity} onChange={(event) => setTrial({ ...trial, quantity: Number(event.target.value) })} /></label>
          <label>商品重量（g）<input type="number" min={1} max={30000} step={1} value={trial.weightG} onChange={(event) => setTrial({ ...trial, weightG: Number(event.target.value) })} /></label>
          <label>梱包の縦（mm）<input type="number" min={1} max={1700} step={1} value={trial.packLengthMm} onChange={(event) => setTrial({ ...trial, packLengthMm: Number(event.target.value) })} /></label>
          <label>梱包の横（mm）<input type="number" min={1} max={1700} step={1} value={trial.packWidthMm} onChange={(event) => setTrial({ ...trial, packWidthMm: Number(event.target.value) })} /></label>
          <label>梱包の高さ（mm）<input type="number" min={1} max={1700} step={1} value={trial.packHeightMm} onChange={(event) => setTrial({ ...trial, packHeightMm: Number(event.target.value) })} /></label>
          <label>お届け先<select value={trial.destinationPrefectureCode} onChange={(event) => setTrial({ ...trial, destinationPrefectureCode: Number(event.target.value) })}>{prefectures.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
          <button className={styles.secondary} type="submit" disabled={previewBusy}>{previewBusy ? '試算中…' : '入力した規則で試算'}</button>
        </form>
        {preview && <dl className={styles.result} aria-live="polite">
          <div><dt>商品小計</dt><dd>{preview.goodsTotalYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>通常送料</dt><dd>{preview.shippingBaseYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>重量物送料</dt><dd>{preview.shippingHeavyYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>送料合計</dt><dd>{preview.shippingTotalYen.toLocaleString('ja-JP')}円</dd></div>
          <div><dt>税込合計</dt><dd>{preview.grandTotalYen.toLocaleString('ja-JP')}円</dd></div>
        </dl>}
      </section>

      <section className={styles.history}>
        <h2>設定履歴</h2>
        <ol>{settings.history.map((entry) => <li key={entry.id}>
          <strong>{entry.version}</strong>{entry.isActive && <span className={styles.active}>有効</span>}
          <span>{new Date(entry.activeFrom).toLocaleString('ja-JP')}</span>
          <span>発送元: {prefectures[entry.originPrefectureCode - 1]}</span>
          <span>通常送料: {entry.baseFeeYen.toLocaleString('ja-JP')}円 / 送料無料: {entry.freeThresholdYen.toLocaleString('ja-JP')}円</span>
          <span>重量物運賃: {entry.heavyRuleJson.rates.length}行</span>
        </li>)}</ol>
      </section>
      <p className={styles.audit}>監査ID: <code>{auditId}</code></p>
    </main>
  );
}
