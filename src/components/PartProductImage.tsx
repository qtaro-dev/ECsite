"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { categoryIllustrationLabel } from "@/lib/category-images";
import { productImageUrl } from "@/lib/product-image-url";

type PartProductImageProps = {
  image?: { path: string; altText: string };
  categoryArt: string;
  fallbackLabel?: string;
  sizes?: string;
};

export function PartProductImage(props: PartProductImageProps) {
  return <PartProductImageContent key={props.image?.path} {...props} />;
}

function PartProductImageContent({ image, categoryArt, fallbackLabel = categoryIllustrationLabel, sizes }: PartProductImageProps) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const registeredSource = image && productImageUrl(image.path);
  const showFallback = !registeredSource || failed;

  function checkRegisteredImage(element: HTMLImageElement) {
    // Existing fixture images can load successfully but contain only one pixel.
    if (element.naturalWidth === 0 || (element.naturalWidth === 1 && element.naturalHeight === 1)) {
      setFailed(true);
    }
  }

  useEffect(() => {
    if (!showFallback && imageRef.current?.complete) checkRegisteredImage(imageRef.current);
  }, [showFallback]);

  const src = showFallback ? categoryArt : registeredSource;
  const alt = showFallback ? "" : image?.altText ?? "";
  const events = showFallback ? {} : {
    ref: imageRef,
    onLoad: (event: React.SyntheticEvent<HTMLImageElement>) => checkRegisteredImage(event.currentTarget),
    onError: () => setFailed(true),
  };
  const illustration = showFallback || alt === fallbackLabel || registeredSource === categoryArt;

  return <>
    {sizes ? <Image src={src} alt={alt} fill sizes={sizes} unoptimized={!showFallback} {...events} />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={src} alt={alt} {...events} />}
    {illustration && <span>{fallbackLabel}</span>}
  </>;
}
