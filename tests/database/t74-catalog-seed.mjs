import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = new URL(process.env.SUPABASE_URL);
assert.equal(url.hostname, '127.0.0.1', 'T74 integration tests require a local disposable database');
const service = createClient(url.origin, process.env.SUPABASE_SERVICE_ROLE_KEY);
const publicClient = createClient(url.origin, process.env.SUPABASE_ANON_KEY);
const cli = ['supabase/seeds/t74-catalog.mjs', '--target-host', url.host];
const actor = '00000000-0000-4000-8000-000000000741';

function run(...args) {
  return execFileSync(process.execPath, [...cli, ...args], { encoding: 'utf8' });
}

async function data(request) {
  const result = await request;
  assert.equal(result.error, null);
  return result.data;
}

async function snapshot() {
  const products = await data(service.from('products')
    .select('id,slug,sku,name,status,version,price_tax_included_yen').order('id'));
  const images = await data(service.from('product_images')
    .select('product_id,storage_path,alt_text').order('id'));
  const inventory = await data(service.from('inventory').select('product_id,on_hand,allocated,version').order('product_id'));
  return { products, images, inventory };
}

const before = await snapshot();
const dryRun = run();
assert.match(dryRun, /hdd: 公開 0件 \/ 追加予定 3件/);
assert.deepEqual(await snapshot(), before, 'dry-run wrote to the database');

const first = run('--apply', '--admin-id', actor);
console.log(first.trim());
const after = await snapshot();
for (const key of Object.keys(before)) {
  const oldKeys = new Set(before[key].map((item) => item.id ?? item.storage_path ?? item.product_id));
  assert.deepEqual(after[key].filter((item) => oldKeys.has(item.id ?? item.storage_path ?? item.product_id)), before[key],
    'existing ' + key + ' changed');
}

const categories = ['cpu', 'gpu', 'motherboard', 'memory', 'ssd', 'hdd', 'power-supply', 'pc-case', 'cpu-cooler'];
for (const category_slug of categories) {
  const [result] = await data(publicClient.rpc('search_published_products', { category_slug }));
  assert.ok(result.total >= 3);
  for (const product of result.items.filter(({ sku }) => sku.startsWith('T74-'))) {
    assert.ok(Object.keys(product.specifications).length > 0);
    assert.ok(after.inventory.some((row) => row.product_id === product.id && row.on_hand > 0 && row.allocated === 0));
    assert.equal(product.images[0].altText, 'カテゴリのイメージ');
    const file = await data(service.storage.from('product-images').download(product.images[0].path));
    assert.ok(file.size > 0);
  }
}

const second = run('--apply', '--admin-id', actor);
assert.doesNotMatch(second, /追加対象 [1-9]/);
assert.deepEqual(await snapshot(), after, 'repeated apply changed the catalog');
console.log('T74 dry run, public catalog, real images and idempotent apply passed.');
