// Storefront product art is displayed at 1280px or smaller. These bounds keep
// useful zoom/crop headroom while limiting a full RGBA decode to about 96 MiB.
// Vercel Functions reject request bodies above 4.5 MB. Keep a separate limit
// for the multipart envelope so image bytes plus fields fit with headroom.
export const ADMIN_PRODUCT_IMAGE_MAX_BYTES = 4_000_000;
export const ADMIN_PRODUCT_MULTIPART_MAX_BYTES = 4_300_000;
export const ADMIN_PRODUCT_IMAGE_MAX_SIDE = 8_000;
export const ADMIN_PRODUCT_IMAGE_MAX_PIXELS = 24_000_000;
