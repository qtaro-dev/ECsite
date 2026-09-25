import { Suspense } from "react";
import { Skeleton } from "@/components/Skeleton";
import { CatalogExplorer } from "@/features/catalog/CatalogExplorer";

export default function SearchPage() {
  return <Suspense fallback={<main id="main-content"><Skeleton lines={5} label="検索画面を読み込み中" /></main>}><CatalogExplorer /></Suspense>;
}
