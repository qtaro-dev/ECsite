import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { categoryIllustrationLabel, categoryImageFiles } from '../../src/lib/category-images.ts';

const minimumPublished = 3;
const brand = '架空メーカー リグラボ';
const tiers = ['ベーシック', 'スタンダード', 'プラス'];
const catalog = {
  cpu: ['CPU', 16800, 11000, 500, [180, 150, 100], [
    { socket_code: 'AM4', core_count: 4, base_clock_mhz: 3200, tdp_w: 45 },
    { socket_code: 'AM5', core_count: 6, base_clock_mhz: 3700, tdp_w: 65 },
    { socket_code: 'AM5', core_count: 8, base_clock_mhz: 4200, tdp_w: 105 },
  ]],
  gpu: ['グラフィックボード', 29800, 20000, 1800, [360, 240, 110], [
    { chipset: 'RigLab G60', vram_gb: 8, card_length_mm: 220 },
    { chipset: 'RigLab G70', vram_gb: 12, card_length_mm: 265 },
    { chipset: 'RigLab G80', vram_gb: 16, card_length_mm: 305 },
  ]],
  motherboard: ['マザーボード', 12800, 7000, 1300, [350, 280, 90], [
    { socket_code: 'AM4', ddr_generation: 'DDR4', form_factor: 'mATX' },
    { socket_code: 'AM5', ddr_generation: 'DDR5', form_factor: 'mATX' },
    { socket_code: 'AM5', ddr_generation: 'DDR5', form_factor: 'ATX' },
  ]],
  memory: ['メモリ', 5980, 4500, 200, [190, 120, 35], [
    { ddr_generation: 'DDR4', capacity_gb: 16, module_count: 2, speed_mt_s: 3200 },
    { ddr_generation: 'DDR5', capacity_gb: 32, module_count: 2, speed_mt_s: 5600 },
    { ddr_generation: 'DDR5', capacity_gb: 64, module_count: 2, speed_mt_s: 6000 },
  ]],
  ssd: ['SSD', 4980, 5000, 150, [150, 120, 35], [
    { capacity_gb: 500, interface: 'SATA', form_factor: '2.5インチ' },
    { capacity_gb: 1000, interface: 'PCIe 4.0 x4', form_factor: 'M.2 2280' },
    { capacity_gb: 2000, interface: 'PCIe 4.0 x4', form_factor: 'M.2 2280' },
  ]],
  hdd: ['HDD', 6980, 5500, 850, [230, 160, 80], [
    { capacity_gb: 1000, interface: 'SATA', form_factor: '3.5インチ' },
    { capacity_gb: 4000, interface: 'SATA', form_factor: '3.5インチ' },
    { capacity_gb: 8000, interface: 'SATA', form_factor: '3.5インチ' },
  ]],
  'power-supply': ['電源ユニット', 6980, 4000, 2200, [290, 220, 140], [
    { rated_w: 550, form_factor: 'ATX', efficiency_grade: 'Bronze相当' },
    { rated_w: 650, form_factor: 'ATX', efficiency_grade: 'Gold相当' },
    { rated_w: 850, form_factor: 'ATX', efficiency_grade: 'Gold相当' },
  ]],
  'pc-case': ['PCケース', 6980, 5000, 6500, [550, 330, 580], [
    { max_gpu_length_mm: 260, outer_length_mm: 350, outer_width_mm: 180, outer_height_mm: 350, supported_form_factors: ['mATX', 'ITX'] },
    { max_gpu_length_mm: 320, outer_length_mm: 430, outer_width_mm: 210, outer_height_mm: 450, supported_form_factors: ['ATX', 'mATX', 'ITX'] },
    { max_gpu_length_mm: 380, outer_length_mm: 480, outer_width_mm: 250, outer_height_mm: 520, supported_form_factors: ['ATX', 'mATX', 'ITX'] },
  ]],
  'cpu-cooler': ['CPUクーラー', 2980, 3500, 1200, [240, 180, 180], [
    { supported_socket_codes: ['AM4', 'AM5'], height_mm: 75, cooling_type: '空冷' },
    { supported_socket_codes: ['AM4', 'AM5', 'LGA1700'], height_mm: 135, cooling_type: '空冷' },
    { supported_socket_codes: ['AM4', 'AM5', 'LGA1700'], height_mm: 160, cooling_type: '空冷' },
  ]],
};

function checked(result, operation) {
  if (result.error) throw new Error(operation + 'に失敗しました（' + (result.error.code ?? result.error.statusCode ?? '接続エラー') + '）');
  return result.data;
}

function draftFor(category, number) {
  const [label, basePrice, step, weight, dimensions, specifications] = catalog[category];
  const tier = (number - 1) % tiers.length;
  const [length, width, height] = dimensions;
  const sku = 'T74-' + category.toUpperCase() + '-' + String(number).padStart(2, '0');
  return {
    fields: {
      category_slug: category, slug: sku.toLowerCase(), sku, name: 'リグラボ ' + label + ' ' + tiers[tier] + ' ' + number,
      brand, description: '購入体験のデモ用に作成した架空の' + label + 'です。',
      beginner_note: '実在する製品ではありません。仕様と価格を比較できます。',
      price_tax_included_yen: basePrice + step * tier, status: 'draft', weight_g: weight,
      pack_length_mm: length, pack_width_mm: width, pack_height_mm: height,
    },
    specifications: specifications[tier],
    stock: [8, 5, 3][tier],
    category,
  };
}

async function publishedCount(client, categoryId) {
  const result = await client.from('products').select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId).eq('status', 'published').is('deleted_at', null);
  checked(result, '公開商品数の確認');
  if (typeof result.count !== 'number') throw new Error('公開商品数を取得できません。');
  return result.count;
}

async function planCategory(client, category, count) {
  const items = [];
  for (let number = 1; items.length < minimumPublished - count; number++) {
    const draft = draftFor(category, number);
    const existing = checked(await client.from('products').select('id')
      .or('slug.eq.' + draft.fields.slug + ',sku.eq.' + draft.fields.sku).limit(1), '既存商品との重複確認');
    if (existing.length === 0) items.push(draft);
  }
  return items;
}

async function createProduct(client, actor, item) {
  const id = randomUUID();
  const path = id + '/' + randomUUID() + '.png';
  const bytes = await readFile(new URL('../../public/images/home-category/' + categoryImageFiles[item.category], import.meta.url));
  checked(await client.storage.from('product-images').upload(path, bytes, { contentType: 'image/png', upsert: false }), 'カテゴリ画像の登録');
  const input = {
    p_product_id: id, p_expected_version: null, p_fields: item.fields, p_specifications: item.specifications,
    p_use_cases: [], p_images: [{ storage_path: path, alt_text: categoryIllustrationLabel, sort_order: 0 }], p_actor_id: actor,
  };
  checked(await client.rpc('admin_save_product', { ...input, p_request_id: 't74-draft-' + id }), '商品下書きの登録');
  const adjusted = checked(await client.rpc('admin_adjust_inventory', {
    p_product_id: id, p_delta: item.stock, p_reason: 'T74 デモ商品初期在庫', p_expected_version: 0,
    p_actor_id: actor, p_request_id: 't74-stock-' + id,
  }), '初期在庫の登録');
  if (adjusted?.status !== 'updated') throw new Error('初期在庫を確定できません。');
  checked(await client.rpc('admin_save_product', {
    ...input, p_expected_version: 0, p_fields: { ...item.fields, status: 'published' }, p_request_id: 't74-publish-' + id,
  }), '商品の公開');
}

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: 'boolean' }, 'target-host': { type: 'string' }, 'admin-id': { type: 'string' } },
    allowPositionals: false,
  });
  const url = new URL(process.env.SUPABASE_URL ?? '');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || url.host !== values['target-host']
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1'))) {
    throw new Error('SUPABASE_URL、サービスロール鍵、明示された --target-host を確認してください。');
  }
  const actor = values['admin-id'];
  if (values.apply && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(actor ?? '')) {
    throw new Error('--apply には既存の管理者のUUIDを --admin-id で指定してください。');
  }
  const client = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  if (values.apply) {
    const membership = checked(await client.from('admin_memberships').select('user_id')
      .eq('user_id', actor).is('revoked_at', null).maybeSingle(), '実行する管理者の確認');
    if (!membership) throw new Error('指定した管理者に有効な管理権限がありません。');
  }
  const categories = checked(await client.from('categories').select('id,slug').in('slug', Object.keys(catalog)), 'カテゴリの確認');
  if (categories.length !== Object.keys(catalog).length) throw new Error('T73を含む既存マイグレーションを先に適用してください。');

  for (const { id, slug } of categories) {
    const before = await publishedCount(client, id);
    const items = await planCategory(client, slug, before);
    console.log(slug + ': 公開 ' + before + '件 / ' + (values.apply ? '追加対象 ' : '追加予定 ') + items.length + '件');
    for (const item of items) {
      console.log('  ' + item.fields.sku + ' ' + item.fields.name + ' ¥' + item.fields.price_tax_included_yen + ' 在庫 ' + item.stock);
      if (values.apply && await publishedCount(client, id) < minimumPublished) {
        try {
          await createProduct(client, actor, item);
        } catch (error) {
          throw new Error(item.fields.sku + ' の追加を中断しました。' + error.message);
        }
      }
    }
    if (values.apply) {
      const after = await publishedCount(client, id);
      console.log('  反映後: ' + after + '件');
      if (after < minimumPublished) throw new Error(slug + 'の公開商品数が不足しています。');
    }
  }
}

try {
  await main();
} catch (error) {
  // Avoid printing SDK objects, request headers, URLs, or credential values.
  console.error(error instanceof TypeError ? '接続設定または通信を確認してください。' : error.message);
  process.exitCode = 1;
}
