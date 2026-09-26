'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_PRODUCT_IMAGE_MAX_BYTES, ADMIN_PRODUCT_IMAGE_MAX_PIXELS, ADMIN_PRODUCT_IMAGE_MAX_SIDE } from '@/lib/admin-product-image-limits';
import {
  AdminProductCreateSchema,
  AdminProductUpdateSchema,
  type AdminProductCategory,
} from '@/lib/admin-product-schemas';
import styles from './editor.module.css';

type SpecKind = 'text' | 'number' | 'select' | 'list';
type SpecField = { key: string; label: string; kind: SpecKind; nullable?: boolean; options?: string[] };
type CategoryConfig = { slug: AdminProductCategory; label: string; fields: SpecField[] };

const categories: CategoryConfig[] = [
  { slug: 'cpu', label: 'CPU', fields: [
    { key: 'socket_code', label: '対応ソケット', kind: 'text', nullable: true },
    { key: 'core_count', label: 'コア数', kind: 'number', nullable: true },
    { key: 'base_clock_mhz', label: 'ベースクロック（MHz）', kind: 'number', nullable: true },
    { key: 'tdp_w', label: 'TDP（W）', kind: 'number', nullable: true },
  ] },
  { slug: 'gpu', label: 'GPU', fields: [
    { key: 'chipset', label: 'チップセット', kind: 'text' }, { key: 'vram_gb', label: 'VRAM（GB）', kind: 'number' },
    { key: 'card_length_mm', label: 'カード長（mm）', kind: 'number', nullable: true },
  ] },
  { slug: 'motherboard', label: 'マザーボード', fields: [
    { key: 'socket_code', label: 'CPUソケット', kind: 'text', nullable: true },
    { key: 'ddr_generation', label: 'メモリ規格', kind: 'select', nullable: true, options: ['DDR4', 'DDR5'] },
    { key: 'form_factor', label: 'フォームファクター', kind: 'select', nullable: true, options: ['ATX', 'mATX', 'ITX'] },
  ] },
  { slug: 'memory', label: 'メモリ', fields: [
    { key: 'ddr_generation', label: 'メモリ規格', kind: 'select', nullable: true, options: ['DDR4', 'DDR5'] },
    { key: 'capacity_gb', label: '合計容量（GB）', kind: 'number', nullable: true },
    { key: 'module_count', label: '枚数', kind: 'number', nullable: true },
    { key: 'speed_mt_s', label: '速度（MT/s）', kind: 'number', nullable: true },
  ] },
  { slug: 'ssd', label: 'SSD', fields: [
    { key: 'capacity_gb', label: '容量（GB）', kind: 'number' }, { key: 'interface', label: '接続方式', kind: 'text' },
    { key: 'form_factor', label: 'フォームファクター', kind: 'text' },
  ] },
  { slug: 'power-supply', label: '電源', fields: [
    { key: 'rated_w', label: '定格出力（W）', kind: 'number' }, { key: 'form_factor', label: 'フォームファクター', kind: 'text' },
    { key: 'efficiency_grade', label: '効率認証', kind: 'text' },
  ] },
  { slug: 'pc-case', label: 'PCケース', fields: [
    { key: 'max_gpu_length_mm', label: '対応GPU長（mm）', kind: 'number', nullable: true },
    { key: 'outer_length_mm', label: 'ケース本体の長さ（mm）', kind: 'number' },
    { key: 'outer_width_mm', label: 'ケース本体の幅（mm）', kind: 'number' },
    { key: 'outer_height_mm', label: 'ケース本体の高さ（mm）', kind: 'number' },
    { key: 'supported_form_factors', label: '対応フォームファクター（カンマ区切り）', kind: 'list', nullable: true },
  ] },
  { slug: 'cpu-cooler', label: 'CPUクーラー', fields: [
    { key: 'supported_socket_codes', label: '対応ソケット（カンマ区切り）', kind: 'list', nullable: true },
    { key: 'height_mm', label: '高さ（mm）', kind: 'number' }, { key: 'cooling_type', label: '冷却方式', kind: 'text' },
  ] },
];

export type ExistingProduct = {
  id: string; version: number; category: AdminProductCategory; slug: string; sku: string; name: string; brand: string;
  description: string; beginnerNote: string; priceTaxIncludedYen: number | null; status: 'draft' | 'published' | 'hidden';
  weightG: number | null; packLengthMm: number | null; packWidthMm: number | null; packHeightMm: number | null;
  useCases: string[]; specifications: Record<string, unknown>; images: Array<{ storagePath: string; altText: string }>;
};
type ProductEditorProps = { initial?: ExistingProduct };

const initialText: Omit<ExistingProduct, 'id' | 'version' | 'images' | 'specifications'> = {
  category: 'cpu', slug: '', sku: '', name: '', brand: '', description: '', beginnerNote: '',
  priceTaxIncludedYen: null, status: 'draft', weightG: null, packLengthMm: null, packWidthMm: null,
  packHeightMm: null, useCases: [],
};
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function AdminProductEditor({ initial }: ProductEditorProps) {
  const router = useRouter();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState({ ...initialText, ...initial });
  const [version, setVersion] = useState(initial?.version ?? 0);
  const [specValues, setSpecValues] = useState<Record<string, unknown>>(initial?.specifications ?? {});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [imageError, setImageError] = useState('');
  const [imageAltText, setImageAltText] = useState(initial ? `${initial.name || initial.sku}の商品画像` : '新商品の画像');
  const [images, setImages] = useState(initial?.images ?? []);
  const [removedImages, setRemovedImages] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const category = useMemo(() => categories.find((item) => item.slug === fields.category) ?? categories[0], [fields.category]);

  function updateField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((current) => ({ ...current, [key]: value }));
  }
  function fieldErrors(name: string) { return errors[name] ?? []; }

  async function chooseImage(file: File | undefined) {
    setImageFile(null);
    setImageDimensions(null);
    setImageError('');
    if (!file) return;
    if (!allowedImageTypes.has(file.type)) { setImageError('JPEG、PNG、WebP形式の画像を選択してください。'); if (imageInputRef.current) imageInputRef.current.value = ''; return; }
    if (file.size > ADMIN_PRODUCT_IMAGE_MAX_BYTES) { setImageError('画像は10MiB以下にしてください。'); if (imageInputRef.current) imageInputRef.current.value = ''; return; }
    try {
      const image = await createImageBitmap(file);
      const { width, height } = image;
      image.close();
      if (width < 1 || height < 1 || width > ADMIN_PRODUCT_IMAGE_MAX_SIDE || height > ADMIN_PRODUCT_IMAGE_MAX_SIDE
        || width * height > ADMIN_PRODUCT_IMAGE_MAX_PIXELS) {
        setImageError('画像の寸法は各辺8,000px以下、総画素2,400万以下にしてください。');
        if (imageInputRef.current) imageInputRef.current.value = '';
        return;
      }
      setImageFile(file);
      setImageDimensions({ width, height });
    } catch {
      setImageError('画像データを読み取れません。別の画像を選択してください。');
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }

  function valueFor(field: SpecField) {
    const current = specValues[field.key];
    return Array.isArray(current) ? current.join(', ') : current == null ? '' : String(current);
  }

  function changeSpec(field: SpecField, raw: string) {
    let value: unknown;
    if (!raw.trim()) value = field.nullable ? null : '';
    else if (field.kind === 'number') value = Number(raw);
    else if (field.kind === 'list') value = raw.split(',').map((item) => item.trim()).filter(Boolean);
    else value = raw;
    setSpecValues((current) => ({ ...current, [field.key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const numeric = (value: string) => value === '' ? null : Number(value);
    const payload = {
      category: fields.category,
      slug: fields.slug,
      sku: fields.sku,
      name: fields.name,
      brand: fields.brand,
      description: fields.description,
      beginnerNote: fields.beginnerNote,
      priceTaxIncludedYen: numeric(String(fields.priceTaxIncludedYen ?? '')),
      status: fields.status,
      weightG: numeric(String(fields.weightG ?? '')),
      packLengthMm: numeric(String(fields.packLengthMm ?? '')),
      packWidthMm: numeric(String(fields.packWidthMm ?? '')),
      packHeightMm: numeric(String(fields.packHeightMm ?? '')),
      useCases: fields.useCases,
      specifications: specValues,
      ...(initial ? { expectedVersion: version } : {}),
    };
    const parsed = initial ? AdminProductUpdateSchema.safeParse(payload) : AdminProductCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const nextErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        nextErrors[key] = [...(nextErrors[key] ?? []), issue.message];
      }
      setErrors(nextErrors);
      setMessage('入力内容を確認してください。');
      return;
    }
    const retainedImages = images.filter((image) => !removedImages.includes(image.storagePath));
    if (fields.status === 'published' && retainedImages.length === 0 && !imageFile) {
      setErrors({ images: ['公開には少なくとも1枚の商品画像が必要です。'] });
      setMessage('入力内容を確認してください。');
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('payload', JSON.stringify({
        ...(initial ? { productId: initial.id } : {}),
        fields: parsed.data,
        images: retainedImages.map((image, index) => ({ storagePath: image.storagePath, altText: image.altText, sortOrder: index })),
        imageAltText: imageAltText.trim() || `${fields.name || fields.sku}の商品画像`,
      }));
      if (imageFile) formData.set('image', imageFile, imageFile.name);
      const response = await fetch('/api/admin/products', {
        method: initial ? 'PATCH' : 'POST', body: formData,
      });
      const result = await response.json() as { data?: { productId?: string; version?: number; images?: Array<{ storagePath: string; altText: string }>; cleanupPending?: boolean }; error?: { fieldErrors?: Record<string, string[]> } };
      if (!response.ok || !result.data?.productId) {
        setErrors(result.error?.fieldErrors ?? {});
        setMessage(response.status === 409 ? '別の管理者が先に更新しました。最新内容を読み込み直してください。'
          : response.status === 400 ? '入力内容を確認してください。'
            : '保存できませんでした。入力を保持したまま再度お試しください。');
        return;
      }
      setMessage(result.data.cleanupPending
        ? '商品を保存しました。置換した非公開画像の後片付けが保留中です。管理者へ連絡してください。'
        : '商品を保存しました。');
      setImageFile(null);
      if (imageInputRef.current) imageInputRef.current.value = '';
      setRemovedImages([]);
      if (result.data.version !== undefined) setVersion(result.data.version);
      if (result.data.images) setImages(result.data.images);
      if (!initial) router.replace(`/admin/products/${result.data.productId}`);
      else router.refresh();
    } catch {
      setMessage('通信できませんでした。入力内容はこの画面に保持しています。');
    } finally { setBusy(false); }
  }

  function textInput(name: keyof typeof initialText, label: string, type = 'text') {
    const errorsForField = fieldErrors(String(name));
    return <div className={styles.field} key={String(name)}>
      <label htmlFor={String(name)}>{label}</label>
      <input id={String(name)} type={type} value={String(fields[name] ?? '')} onChange={(event) => updateField(name, (type === 'number' ? numericInput(event.target.value) : event.target.value) as never)} aria-invalid={errorsForField.length > 0} aria-describedby={errorsForField.length ? `${String(name)}-error` : undefined} />
      {errorsForField.map((error, index) => <p className={styles.error} id={`${String(name)}-error`} key={`${name}-${index}`}>{error}</p>)}
    </div>;
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <section className={styles.section} aria-labelledby="product-basic-title">
        <h2 id="product-basic-title">基本情報</h2>
        <div className={styles.grid}>
          <div className={styles.field}><label htmlFor="category">カテゴリ</label><select id="category" disabled={Boolean(initial)} value={fields.category} onChange={(event) => { updateField('category', event.target.value as AdminProductCategory); setSpecValues({}); }}>
            {categories.map((item) => <option value={item.slug} key={item.slug}>{item.label}</option>)}
          </select>{initial && <small>登録後のカテゴリ変更はできません。</small>}</div>
          {textInput('slug', 'slug')}{textInput('sku', 'SKU')}{textInput('name', '商品名')}{textInput('brand', 'ブランド')}
          <div className={styles.field}><label htmlFor="description">商品説明</label><textarea id="description" maxLength={5000} value={fields.description} onChange={(event) => updateField('description', event.target.value)} aria-invalid={fieldErrors('description').length > 0} />{fieldErrors('description').map((error) => <p className={styles.error} key={error}>{error}</p>)}</div>
          <div className={styles.field}><label htmlFor="beginnerNote">初心者向けメモ</label><textarea id="beginnerNote" maxLength={2000} value={fields.beginnerNote} onChange={(event) => updateField('beginnerNote', event.target.value)} aria-invalid={fieldErrors('beginnerNote').length > 0} />{fieldErrors('beginnerNote').map((error) => <p className={styles.error} key={error}>{error}</p>)}</div>
          {textInput('priceTaxIncludedYen', '税込価格（円）', 'number')}
          <div className={styles.field}><label htmlFor="status">公開状態</label><select id="status" value={fields.status} onChange={(event) => updateField('status', event.target.value as typeof fields.status)}><option value="draft">下書き</option><option value="published">公開</option><option value="hidden">非公開</option></select></div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="product-shipping-title">
        <h2 id="product-shipping-title">用途・梱包</h2>
        <fieldset className={styles.uses}><legend>おすすめ用途</legend>{[['gaming','ゲーム'],['daily','普段使い'],['editing','動画編集']].map(([value,label]) => <label key={value}><input type="checkbox" checked={fields.useCases.includes(value)} onChange={(event) => updateField('useCases', event.target.checked ? [...fields.useCases, value] : fields.useCases.filter((item) => item !== value))} />{label}</label>)}</fieldset>
        <div className={styles.grid}>{textInput('weightG', '商品重量（g）', 'number')}{textInput('packLengthMm', '梱包後の長さ（mm）', 'number')}{textInput('packWidthMm', '梱包後の幅（mm）', 'number')}{textInput('packHeightMm', '梱包後の高さ（mm）', 'number')}</div>
      </section>

      <section className={styles.section} aria-labelledby="product-spec-title">
        <h2 id="product-spec-title">{category.label}の仕様</h2>
        <p className={styles.help}>仕様が未確定の場合は下書きで保存できます。公開時は必須仕様を確認します。</p>
        <div className={styles.grid}>{category.fields.map((field) => {
          const name = `specifications.${field.key}`;
          const fieldErrorList = fieldErrors(name);
          const id = `spec-${field.key}`;
          const common = { id, value: valueFor(field), onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => changeSpec(field, event.target.value), 'aria-invalid': fieldErrorList.length > 0, 'aria-describedby': fieldErrorList.length ? `${id}-error` : undefined };
          return <div className={styles.field} key={field.key}>
            <label htmlFor={id}>{field.label}{field.nullable ? '（任意）' : '（必須）'}</label>
            {field.kind === 'select' ? <select {...common}><option value="">未設定</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
              : <input {...common} type={field.kind === 'number' ? 'number' : 'text'} min={field.kind === 'number' ? 1 : undefined} />}
            {fieldErrorList.map((error, index) => <p className={styles.error} id={`${id}-error`} key={`${field.key}-${index}`}>{error}</p>)}
          </div>;
        })}</div>
      </section>

      <section className={styles.section} aria-labelledby="product-images-title">
        <h2 id="product-images-title">商品画像</h2>
        {images.map((image) => {
          const removed = removedImages.includes(image.storagePath);
          return <div className={styles.imageRow} key={image.storagePath}>
            <label htmlFor={`image-alt-${image.storagePath}`}>代替テキスト</label>
            <input id={`image-alt-${image.storagePath}`} value={image.altText} disabled={removed}
              onChange={(event) => setImages((current) => current.map((entry) => entry.storagePath === image.storagePath ? { ...entry, altText: event.target.value } : entry))} />
            <button type="button" className={styles.imageRemove} aria-pressed={removed}
              onClick={() => setRemovedImages((current) => removed ? current.filter((path) => path !== image.storagePath) : [...current, image.storagePath])}>
              {removed ? '削除を取り消す' : '画像を削除'}
            </button>
            <small>{removed ? '保存時に削除します' : '現在の商品画像'}</small>
          </div>;
        })}
        <div className={styles.field}><label htmlFor="product-image">画像を選択</label><input ref={imageInputRef} id="product-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void chooseImage(event.target.files?.[0])} aria-invalid={Boolean(imageError)} aria-describedby={imageError ? 'image-error' : undefined} />
          <small>静止画のJPEG・PNG・WebP、10MiB以下。各辺8,000px以下・総画素2,400万以下です。</small>
          {imageError && <p className={styles.error} id="image-error" role="alert">{imageError}</p>}
          {imageFile && <><label htmlFor="new-image-alt">新しい画像の代替テキスト</label><input id="new-image-alt" maxLength={240} value={imageAltText} onChange={(event) => setImageAltText(event.target.value)} /></>}
          {[...fieldErrors('images'), ...fieldErrors('image')].map((error, index) => <p className={styles.error} key={`${error}-${index}`}>{error}</p>)}
          {imageFile && imageDimensions && <p aria-live="polite">選択済み: {imageFile.name} · {imageDimensions.width} × {imageDimensions.height}px · {Math.ceil(imageFile.size / 1024)} KiB</p>}
        </div>
      </section>
      {message && <p className={message.startsWith('入力内容') ? styles.alert : styles.success} role="status">{message}</p>}
      <div className={styles.actions}><button type="submit" disabled={busy}>{busy ? '保存中…' : initial ? '変更を保存' : '商品を作成'}</button>{initial && <button type="button" className={styles.secondary} onClick={() => router.push('/admin/products')}>一覧へ戻る</button>}</div>
      {initial && <p className={styles.audit}>編集版: {version}</p>}
    </form>
  );
}

function numericInput(value: string) { return value === '' ? null : Number(value); }
