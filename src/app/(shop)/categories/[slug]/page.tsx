import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/Skeleton";
import { CatalogExplorer } from "@/features/catalog/CatalogExplorer";
import { ProductCategorySchema } from "@/lib/schemas";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = ProductCategorySchema.safeParse(slug);
  if (!category.success) notFound();
  return <Suspense fallback={<main id="main-content"><Skeleton lines={5} label="カテゴリ商品を読み込み中" /></main>}><CatalogExplorer category={category.data} /></Suspense>;
}
