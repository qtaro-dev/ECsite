import Image from "next/image";
import type { ReactNode } from "react";
import { HomeContent } from "./HomeContent";
import styles from "./home-artwork.module.css";

const titleImage = { src: "/preview/top/toppage_title01.png", width: 1672, height: 941 };
const imageSizes = "(max-width: 767px) calc(100vw - 3rem), (max-width: 1200px) 36vw, 30rem";

const artwork = {
  a: { placement: "panel", image: titleImage },
  b: { placement: "panel", image: { src: "/preview/top/toppage_title02.png", width: 1536, height: 1024 } },
  c: { placement: "backdrop", image: titleImage },
  d: { placement: "backdrop", image: titleImage, widthClass: "wideBackdrop" },
  e: { placement: "backdrop", image: titleImage, widthClass: "widerBackdrop" },
} as const;

export type HomeArtworkVariant = keyof typeof artwork;
export const selectedHomeArtwork = "e" satisfies HomeArtworkVariant;

export function HomeWithArtwork({ variant, previewNavigation, showCardImages = false }: { variant: HomeArtworkVariant; previewNavigation?: ReactNode; showCardImages?: boolean }) {
  const option = artwork[variant];
  const isBackdrop = option.placement === "backdrop";
  const artClassName = "widthClass" in option
    ? `${styles.backdrop} ${styles[option.widthClass]}`
    : isBackdrop ? styles.backdrop : styles.art;

  return (
    <HomeContent
      hideHeroEyebrow
      heroClassName={isBackdrop ? styles.backdropHero : undefined}
      previewNavigation={previewNavigation}
      showCardImages={showCardImages}
      heroArt={
        <div className={artClassName} aria-hidden="true">
          <Image {...option.image} alt="" sizes={imageSizes} loading="eager" unoptimized />
        </div>
      }
    />
  );
}
