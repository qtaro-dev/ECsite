// Storefront product art is displayed at 1280px or smaller. These bounds keep
// useful zoom/crop headroom while limiting a full RGBA decode to about 96 MiB.
export const ADMIN_PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ADMIN_PRODUCT_IMAGE_MAX_SIDE = 8_000;
export const ADMIN_PRODUCT_IMAGE_MAX_PIXELS = 24_000_000;
