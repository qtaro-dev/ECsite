import type { CatalogCategory } from "@/lib/schemas";

export const categoryImageFiles = {
  cpu: "01_cpu.png",
  gpu: "02_gpu.png",
  motherboard: "03_motherboard.png",
  memory: "04_memory.png",
  ssd: "05_storage.png",
  hdd: "05_storage.png",
  "power-supply": "06_power_supply.png",
  "pc-case": "07_pc_case.png",
  "cpu-cooler": "08_cpu_cooler.png",
} as const satisfies Record<Exclude<CatalogCategory, "prebuilt-pc">, string>;

export const categoryImageDirectory = "/images/home-category";

export const categoryIllustrationLabel = "カテゴリのイメージ";

export const storageCategory = {
  name: "ストレージ",
  href: "/categories/storage",
  parts: [
    { category: "ssd", name: "SSD", description: "OSやアプリをすばやく起動したいときに。" },
    { category: "hdd", name: "HDD", description: "写真や動画などを大容量で保存したいときに。" },
  ],
} as const;

export function isStoragePart(category: CatalogCategory | undefined) {
  return storageCategory.parts.some((part) => part.category === category);
}

export function categoryImage(category: Exclude<CatalogCategory, "prebuilt-pc">): string;
export function categoryImage(category: CatalogCategory): string | undefined;
export function categoryImage(category: CatalogCategory) {
  if (category === "prebuilt-pc") return undefined;
  return `${categoryImageDirectory}/${categoryImageFiles[category]}`;
}
