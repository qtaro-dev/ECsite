/** Builds the same-origin proxy URL for a public product image path. */
export function productImageUrl(path: string): string {
  if (/^placeholders\/prebuilt-pc\/[a-z0-9-]+\.svg$/.test(path)) return '/images/prebuilt-pc-placeholder.svg';
  return `/api/product-images/${path.split('/').map(encodeURIComponent).join('/')}`;
}
