'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { AdminPrebuiltPcCreateSchema, AdminPrebuiltPcDetailSchema, AdminPrebuiltPcUpdateSchema } from '@/lib/admin-prebuilt-pc-schemas';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES, ADMIN_PRODUCT_IMAGE_MAX_PIXELS, ADMIN_PRODUCT_IMAGE_MAX_SIDE, ADMIN_PRODUCT_MULTIPART_MAX_BYTES } from '@/lib/admin-product-image-limits';
import styles from './prebuilt-pc-editor.module.css';

type Part = { label: string; details: string };
type PartKey = 'cpu' | 'gpu' | 'memory' | 'ssd' | 'motherboard' | 'powerSupply' | 'pcCase';
type Image = { storagePath: string; altText: string; sortOrder: number };
type Detail = z.infer<typeof AdminPrebuiltPcDetailSchema>;
type Props = { initial?: Detail; initialMessage?: string };
type Fields = {
  slug: string; sku: string; name: string; brand: string; description: string; beginnerNote: string;
  priceTaxIncludedYen: string; status: Detail['status']; weightG: string; packLengthMm: string; packWidthMm: string; packHeightMm: string;
};

const partKeys: PartKey[] = ['cpu', 'gpu', 'memory', 'ssd', 'motherboard', 'powerSupply', 'pcCase'];
const partLabels: Record<PartKey, string> = { cpu: 'CPU', gpu: 'GPU', memory: 'メモリ', ssd: 'SSD', motherboard: 'マザーボード', powerSupply: '電源', pcCase: 'PCケース' };
const usageOptions = [['gaming', 'ゲーム'], ['daily', '普段使い'], ['editing', '動画編集']] as const;
const requiredParts = new Set<PartKey>(['cpu', 'gpu', 'memory', 'ssd']);
const numericKeys = ['priceTaxIncludedYen', 'weightG', 'packLengthMm', 'packWidthMm', 'packHeightMm'] as const;
const blankPart = (): Part => ({ label: '', details: '' });

function initialValues(initial?: Detail): Fields {
  const value = (number: number | null | undefined) => number == null ? '' : String(number);
  return {
    slug: initial?.slug ?? '', sku: initial?.sku ?? '', name: initial?.name ?? '', brand: initial?.brand ?? '',
    description: initial?.description ?? '', beginnerNote: initial?.beginnerNote ?? '',
    priceTaxIncludedYen: value(initial?.priceTaxIncludedYen), status: initial?.status ?? 'draft', weightG: value(initial?.weightG),
    packLengthMm: value(initial?.packLengthMm), packWidthMm: value(initial?.packWidthMm), packHeightMm: value(initial?.packHeightMm),
  };
}

export default function PrebuiltPcEditor({ initial, initialMessage }: Props) {
  const router = useRouter();
  const imageInput = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState(() => initialValues(initial));
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [parts, setParts] = useState<Record<PartKey, Part>>(() => Object.fromEntries(partKeys.map((key) => [key, initial?.components?.[key] ?? blankPart()])) as Record<PartKey, Part>);
  const [selectedUseCases, setSelectedUseCases] = useState<Detail['useCases']>(initial?.useCases ?? []);
  const [images, setImages] = useState<Image[]>(initial?.images ?? []);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageAltText, setImageAltText] = useState(`${initial?.name || initial?.sku || '構成済みPC'}の商品画像`);
  const [imageError, setImageError] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState(initialMessage ?? '');
  const [busy, setBusy] = useState(false);

  const fieldErrors = (name: string) => errors[name] ?? [];
  const imageErrors = [...fieldErrors('images'), ...fieldErrors('image')];
  const imageErrorIds = imageErrors.map((_, index) => `prebuilt-image-server-error-${index}`);
  function changeField(name: keyof Fields, value: string) { setFields((current) => ({ ...current, [name]: value })); }
  function changePart(key: PartKey, prop: keyof Part, value: string) { setParts((current) => ({ ...current, [key]: { ...current[key], [prop]: value } })); }

  async function chooseImage(file?: File) {
    setImageFile(null); setImageError('');
    if (!file) return;
    let error = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) error = 'JPEG、PNG、WebP形式の静止画を選択してください。';
    else if (file.size < 1 || file.size > ADMIN_PRODUCT_IMAGE_MAX_BYTES) error = '画像は4,000,000 bytes（約4MB）以下にしてください。';
    else {
      try {
        const bitmap = await createImageBitmap(file);
        const { width, height } = bitmap; bitmap.close();
        if (!width || !height || width > ADMIN_PRODUCT_IMAGE_MAX_SIDE || height > ADMIN_PRODUCT_IMAGE_MAX_SIDE || width * height > ADMIN_PRODUCT_IMAGE_MAX_PIXELS) {
          error = '画像は各辺8,000px以下、総画素2,400万以下にしてください。';
        }
      } catch { error = '画像データを読み取れません。別の画像を選択してください。'; }
    }
    if (error) { setImageError(error); if (imageInput.current) imageInput.current.value = ''; }
    else setImageFile(file);
  }

  function buildPayloadFields() {
    const hasAnyPart = partKeys.some((key) => parts[key].label.trim() || parts[key].details.trim());
    const components = hasAnyPart ? Object.fromEntries(partKeys
      .filter((key) => requiredParts.has(key) || parts[key].label.trim() || parts[key].details.trim())
      .map((key) => [key, parts[key]])) : null;
    const numbers = Object.fromEntries(numericKeys.map((key) => [key, fields[key] === '' ? null : Number(fields[key])]));
    return {
      slug: fields.slug, sku: fields.sku, name: fields.name, brand: fields.brand, description: fields.description,
      beginnerNote: fields.beginnerNote, ...numbers, status: fields.status, useCases: selectedUseCases, components,
      ...(initial ? { expectedVersion: version } : {}),
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('');
    const candidate = buildPayloadFields();
    const parsed = initial ? AdminPrebuiltPcUpdateSchema.safeParse(candidate) : AdminPrebuiltPcCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      const next: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) { const key = issue.path.join('.'); next[key] = [...(next[key] ?? []), issue.message]; }
      setErrors(next); setMessage('入力内容を確認してください。'); return;
    }
    const retained = images.filter((image) => !removedImages.includes(image.storagePath)).map((image, index) => ({ ...image, sortOrder: index }));
    if (fields.status === 'published' && retained.length === 0 && !imageFile) {
      setErrors({ images: ['公開には少なくとも1枚の商品画像が必要です。'] }); setMessage('入力内容を確認してください。'); return;
    }
    const serialized = JSON.stringify({ ...(initial ? { productId: initial.id } : {}), fields: parsed.data, images: retained, imageAltText: imageAltText.trim() });
    if (new TextEncoder().encode(serialized).byteLength + (imageFile?.size ?? 0) + 16_384 > ADMIN_PRODUCT_MULTIPART_MAX_BYTES) {
      setErrors({ image: ['画像と入力内容を合わせた送信データは4,300,000 bytes以下にしてください。'] }); setMessage('入力内容を確認してください。'); return;
    }
    const formData = new FormData(); formData.set('payload', serialized);
    if (imageFile) formData.set('image', imageFile, imageFile.name);
    setErrors({}); setBusy(true);
    try {
      const response = await fetch('/api/admin/prebuilt-pcs', { method: initial ? 'PATCH' : 'POST', body: formData });
      const result = await response.json() as { data?: { productId?: string; version?: number; images?: Image[]; cleanupPending?: boolean }; error?: { fieldErrors?: Record<string, string[]> } };
      if (!response.ok || !result.data?.productId) {
        setErrors(result.error?.fieldErrors ?? {});
        setMessage(response.status === 409 ? '別の管理者が先に更新しました。最新内容を読み込み直してください。'
          : response.status === 404 ? '商品が見つかりません。一覧から開き直してください。'
            : response.status === 401 || response.status === 403 ? '管理者権限を確認できません。管理者アカウントで再ログインしてください。'
            : response.status === 413 ? '画像と入力内容を合わせた送信データは4,300,000 bytes以下にしてください。'
              : response.status === 400 ? '入力内容を確認してください。' : '保存できませんでした。入力を保持したまま再度お試しください。');
        return;
      }
      setImages(result.data.images ?? retained); setRemovedImages([]); setImageFile(null);
      if (result.data.version !== undefined) setVersion(result.data.version);
      if (imageInput.current) imageInput.current.value = '';
      setMessage(result.data.cleanupPending
        ? '構成済みPCを保存しました。置換した画像の後片付けが保留中です。管理者へ連絡してください。'
        : '構成済みPCを保存しました。');
      if (!initial) router.replace(`/admin/prebuilt-pcs/${result.data.productId}?saved=1`);
      else { router.replace(`/admin/prebuilt-pcs/${initial.id}`, { scroll: false }); router.refresh(); }
    } catch { setMessage('通信できませんでした。入力内容はこの画面に保持しています。'); }
    finally { setBusy(false); }
  }

  function textField(name: keyof Fields, label: string, type: 'text' | 'number' = 'text', help?: { id: string; text: string; placeholder?: string }) {
    const list = fieldErrors(name);
    const errorIds = list.map((_, index) => `${name}-error-${index}`);
    return <div className={styles.field} key={name}>
      <label htmlFor={name}>{label}</label>
      <input id={name} type={type} min={type === 'number' ? 0 : undefined} value={fields[name]} onChange={(event) => changeField(name, event.target.value)}
        placeholder={help?.placeholder} aria-invalid={list.length > 0} aria-describedby={[help?.id, ...errorIds].filter(Boolean).join(' ') || undefined} />
      {help && <small id={help.id}>{help.text}</small>}
      {list.map((error, index) => <p id={errorIds[index]} className={styles.error} key={index}>{error}</p>)}
    </div>;
  }

  function textArea(name: 'description' | 'beginnerNote', label: string, maxLength: number) {
    const list = fieldErrors(name);
    const errorIds = list.map((_, index) => `${name}-error-${index}`);
    return <div className={styles.field} key={name}><label htmlFor={name}>{label}</label>
      <textarea id={name} maxLength={maxLength} value={fields[name]} onChange={(event) => changeField(name, event.target.value)}
        aria-invalid={list.length > 0} aria-describedby={errorIds.length ? errorIds.join(' ') : undefined} />
      {list.map((error, index) => <p id={errorIds[index]} className={styles.error} key={index}>{error}</p>)}
    </div>;
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <section className={styles.section} aria-labelledby="basic-title">
        <h2 id="basic-title">基本情報</h2>
        <div className={styles.grid}>
          {textField('slug', '商品ページURL（slug）', 'text', {
            id: 'slug-description', placeholder: 'ryzen-7-7700',
            text: '商品ページURLの末尾に使います（例: ryzen-7-7700 → /products/ryzen-7-7700）。小文字英数字と単語の区切りのハイフンのみ、1～160文字で、他の商品と重複できません。SKU（在庫管理用コード）とは別です。公開後に変更すると既存URLが変わるため、必要な場合は慎重に変更してください。',
          })}
          {textField('sku', '完成PCのSKU')}{textField('name', '商品名')}{textField('brand', 'ブランド')}
          {textArea('description', '商品説明', 5000)}{textArea('beginnerNote', '初心者向けメモ', 2000)}
          {textField('priceTaxIncludedYen', '税込価格（円）', 'number')}
          <div className={styles.field}><label htmlFor="status">公開状態</label><select id="status" value={fields.status} onChange={(event) => changeField('status', event.target.value)}>
            <option value="draft">下書き</option><option value="published">公開</option><option value="hidden">非公開</option>
          </select>{fieldErrors('status').map((error, index) => <p className={styles.error} key={index}>{error}</p>)}</div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="components-title" aria-describedby={['components-help', fieldErrors('components').length ? 'components-schema-error' : undefined].filter(Boolean).join(' ')}>
        <h2 id="components-title">採用パーツの構成</h2>
        <p id="components-help" className={styles.help}>パーツ名と詳細を自由入力します。単品パーツSKU・在庫とは連動しません。公開時はCPU・GPU・メモリ・SSDの名前と詳細が必要です。すべて空欄なら構成なしの下書きとして保存できます。</p>
        <div className={styles.componentGrid}>
          {partKeys.map((key) => {
            const labelErrors = fieldErrors(`components.${key}.label`); const detailErrors = fieldErrors(`components.${key}.details`);
            const labelErrorIds = labelErrors.map((_, index) => `${key}-label-error-${index}`);
            const detailErrorIds = detailErrors.map((_, index) => `${key}-details-error-${index}`);
            return <fieldset className={styles.component} key={key}>
              <legend>{partLabels[key]}{requiredParts.has(key) ? '（必須）' : '（任意）'}</legend>
              <div className={styles.field}><label htmlFor={`${key}-label`}>パーツ名</label>
                <input id={`${key}-label`} maxLength={120} value={parts[key].label} onChange={(event) => changePart(key, 'label', event.target.value)}
                  aria-invalid={labelErrors.length > 0} aria-describedby={labelErrorIds.length ? labelErrorIds.join(' ') : undefined} />
                {labelErrors.map((error, index) => <p className={styles.error} id={labelErrorIds[index]} key={index}>{error}</p>)}
              </div>
              <div className={styles.field}><label htmlFor={`${key}-details`}>詳細・仕様</label>
                <textarea id={`${key}-details`} maxLength={300} value={parts[key].details} onChange={(event) => changePart(key, 'details', event.target.value)}
                  aria-invalid={detailErrors.length > 0} aria-describedby={detailErrorIds.length ? detailErrorIds.join(' ') : undefined} />
                {detailErrors.map((error, index) => <p className={styles.error} id={detailErrorIds[index]} key={index}>{error}</p>)}
              </div>
            </fieldset>;
          })}
        </div>
        {fieldErrors('components').map((error, index) => <p id="components-schema-error" className={styles.error} role="alert" key={index}>{error}</p>)}
      </section>

      <section className={styles.section} aria-labelledby="usage-title">
        <h2 id="usage-title">おすすめ用途・梱包</h2>
        <fieldset className={styles.uses} aria-describedby={fieldErrors('useCases').length ? 'use-cases-error' : undefined}><legend>おすすめ用途（複数選択可）</legend>
          {usageOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={selectedUseCases.includes(value)} onChange={(event) => setSelectedUseCases((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} />{label}</label>)}
        </fieldset>
        {fieldErrors('useCases').map((error, index) => <p className={styles.error} id="use-cases-error" key={index}>{error}</p>)}
        <div className={styles.grid}>{textField('weightG', '商品重量（g）', 'number')}{textField('packLengthMm', '梱包後の長さ（mm）', 'number')}{textField('packWidthMm', '梱包後の幅（mm）', 'number')}{textField('packHeightMm', '梱包後の高さ（mm）', 'number')}</div>
        {['weightG', 'packLengthMm', 'packWidthMm', 'packHeightMm'].flatMap((name) => fieldErrors(name).map((error, index) => <p className={styles.error} key={`${name}-${index}`}>{error}</p>))}
      </section>

      <section className={styles.section} aria-labelledby="images-title">
        <h2 id="images-title">商品画像</h2><p className={styles.help}>公開には画像が1枚以上必要です。静止画のJPEG・PNG・WebPを選択してください。</p>
        {images.map((image) => {
          const removed = removedImages.includes(image.storagePath);
          return <div className={styles.imageRow} key={image.storagePath}>
            <label htmlFor={`alt-${image.storagePath}`}>代替テキスト</label>
            <input id={`alt-${image.storagePath}`} value={image.altText} disabled={removed} onChange={(event) => setImages((current) => current.map((item) => item.storagePath === image.storagePath ? { ...item, altText: event.target.value } : item))} />
            <button type="button" aria-pressed={removed} onClick={() => setRemovedImages((current) => removed ? current.filter((path) => path !== image.storagePath) : [...current, image.storagePath])}>{removed ? '削除を取り消す' : '画像を削除'}</button>
            <small>{removed ? '保存時に削除します' : '現在の商品画像'}</small>
          </div>;
        })}
        <div className={styles.field}><label htmlFor="prebuilt-image">画像を選択</label>
          <input ref={imageInput} id="prebuilt-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseImage(event.target.files?.[0])}
            aria-invalid={Boolean(imageError || imageErrors.length)} aria-describedby={[imageError ? 'prebuilt-image-error' : undefined, ...imageErrorIds].filter(Boolean).join(' ') || undefined} />
          <small>保存時に自動で最適化し、画像ファイルを1MiB以下にします。4,000,000 bytes以下、各辺8,000px以下、総画素2,400万以下。</small>
          {imageError && <p id="prebuilt-image-error" className={styles.error} role="alert">{imageError}</p>}
          {imageFile && <><label htmlFor="image-alt">新しい画像の代替テキスト</label><input id="image-alt" maxLength={240} value={imageAltText} onChange={(event) => setImageAltText(event.target.value)} /><p aria-live="polite">選択済み: {imageFile.name} · {Math.ceil(imageFile.size / 1024)} KiB</p></>}
          {imageErrors.map((error, index) => <p className={styles.error} id={imageErrorIds[index]} key={`${index}-${error}`}>{error}</p>)}
        </div>
      </section>
      {message && <p className={message.startsWith('入力内容') ? styles.alert : styles.success} role="status" aria-live="polite">{message}</p>}
      <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? '保存中…' : initial ? '変更を保存' : '構成済みPCを作成'}</button><button type="button" className={styles.secondary} onClick={() => router.push('/admin/products')}>商品一覧へ戻る</button></div>
      {initial && <p className={styles.version}>編集版: {version}</p>}
    </form>
  );
}
