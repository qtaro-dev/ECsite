import { Suspense } from 'react';
import { Skeleton } from '@/components/Skeleton';
import { ProductCategorySchema, type ProductCategory } from '@/lib/schemas';
import { getPublishedProductDetail, type ProductDetail } from '@/server/catalog/product-detail';
import { BuildConfigurator, type BuildSelectionLoadState } from '@/features/build/BuildConfigurator';

const categories: ProductCategory[] = ['cpu', 'gpu', 'motherboard', 'memory', 'ssd', 'power-supply', 'pc-case', 'cpu-cooler'];
const slugPattern = /^[a-z0-9][a-z0-9-]{0,119}$/;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export default async function BuildPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const legacyCategory = ProductCategorySchema.safeParse(single(query.category));
  const selectedSlugs = new Map<ProductCategory, string>();
  for (const category of categories) {
    const slug = single(query[category]);
    if (slug && slugPattern.test(slug)) selectedSlugs.set(category, slug);
  }
  const legacySlug = single(query.product);
  if (legacyCategory.success && legacySlug && slugPattern.test(legacySlug) && !selectedSlugs.has(legacyCategory.data)) {
    selectedSlugs.set(legacyCategory.data, legacySlug);
  }

  const loaded = await Promise.all([...selectedSlugs.entries()].map(async ([category, slug]) => {
    try {
      const product = await getPublishedProductDetail(slug);
      return product && product.category === category
        ? { category, product, state: 'loaded' as const }
        : { category, product: null, state: 'missing' as const };
    } catch {
      return { category, product: null, state: 'unavailable' as const };
    }
  }));
  const selections: ProductDetail[] = loaded.flatMap(({ product }) => product ? [product] : []);
  const loadStates: BuildSelectionLoadState[] = loaded.flatMap(({ category, state }) => state === 'loaded' ? [] : [{ category, state }]);

  return <Suspense fallback={<main id="main-content"><Skeleton lines={8} label="構成確認を読み込み中" /></main>}>
    <BuildConfigurator initialSelections={selections} initialLoadStates={loadStates} />
  </Suspense>;
}
