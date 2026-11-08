'use client';

import { PartProductImage } from '@/components/PartProductImage';
import { categoryImage } from '@/lib/category-images';
import { CatalogCategorySchema } from '@/lib/schemas';

export function CartProductImage({ imagePath, category }: { imagePath: string | null; category?: string }) {
  const parsedCategory = CatalogCategorySchema.safeParse(category);
  const categoryArt = parsedCategory.success ? categoryImage(parsedCategory.data) : undefined;
  return <PartProductImage
    image={imagePath ? { path: imagePath, altText: '' } : undefined}
    categoryArt={categoryArt ?? '/images/prebuilt-pc-placeholder.svg'}
    fallbackLabel={categoryArt ? undefined : '商品画像のイメージ'} />;
}
