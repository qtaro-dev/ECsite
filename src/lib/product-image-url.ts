/** Builds the same-origin proxy URL for a public product image path. */
export function productImageUrl(path: string): string {
  return `/api/product-images/${path.split('/').map(encodeURIComponent).join('/')}`;
}