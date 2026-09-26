import { describe, expect, it, vi } from 'vitest';

const { sharp } = vi.hoisted(() => ({ sharp: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('sharp', () => ({ default: sharp }));
import { inspectAndSanitizeProductImage } from '../../src/server/admin/product-images';

describe('multipage image rejection', () => {
  it('rejects a WebP whose decoder metadata identifies multiple frames before decoding or storing', async () => {
    sharp.mockReturnValue({ metadata: async () => ({ format: 'webp', pages: 2, width: 2, height: 2 }) });
    await expect(inspectAndSanitizeProductImage('image/webp', 3, new Uint8Array([1, 2, 3])))
      .rejects.toMatchObject({ reason: 'animated' });
    expect(sharp).toHaveBeenCalledOnce();
  });
});
