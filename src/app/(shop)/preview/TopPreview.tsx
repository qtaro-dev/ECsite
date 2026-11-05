import type { Metadata } from "next";
import Link from "next/link";
import { HomeWithArtwork, type HomeArtworkVariant } from "../HomeWithArtwork";
import styles from "./top-preview.module.css";

const options = {
  a: { href: "/preview/top-a", label: "比較A" },
  b: { href: "/preview/top-b", label: "比較B" },
  c: { href: "/preview/top-c", label: "比較C" },
  d: { href: "/preview/top-d", label: "比較D" },
  e: { href: "/preview/top-e", label: "比較E" },
} as const satisfies Record<HomeArtworkVariant, { href: string; label: string }>;

type Variant = keyof typeof options;

const navigationLabel = "トップページ画像の比較";

export function topPreviewMetadata(variant: Variant): Metadata {
  return {
    title: options[variant].label,
    robots: { index: false, follow: false },
  };
}

export function TopPreview({ variant }: { variant: Variant }) {
  return (
    <HomeWithArtwork
      variant={variant}
      previewNavigation={
        <nav className={styles.navigation} aria-label={navigationLabel}>
          {Object.entries(options).map(([key, item]) => (
            <Link key={key} href={item.href} aria-current={key === variant ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
      }
    />
  );
}
