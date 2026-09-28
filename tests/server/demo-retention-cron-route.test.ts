import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ createCartServiceClient: vi.fn(), claimDemoDeletion: vi.fn(), processDemoDeletion: vi.fn() }));
// @ts-expect-error Vitest treats the server-only marker as a virtual module.
vi.mock('server-only', () => ({}), { virtual: true });
vi.mock('../../src/server/cart/service-client', () => ({ createCartServiceClient: mocks.createCartServiceClient }));
vi.mock('../../src/server/account/demo-retention', () => ({ claimDemoDeletion: mocks.claimDemoDeletion, processDemoDeletion: mocks.processDemoDeletion }));

import { POST } from '../../src/app/api/internal/delete-expired-demos/route';

const secret = 'a'.repeat(40);
const userId = '00000000-0000-4000-8000-000000000522';
function request(body: string, timestamp = String(Math.floor(Date.now()/1000)), signed = true) {
  const signature = createHmac('sha256', secret).update(timestamp).update('\n').update(body).digest('hex');
  return new NextRequest('http://localhost:3000/api/internal/delete-expired-demos', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-job-timestamp': timestamp,
      'x-internal-job-signature': signed ? signature : '0'.repeat(64) }, body,
  });
}

describe('signed demo retention Cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.T22_INTERNAL_JOB_SECRET = secret;
    mocks.createCartServiceClient.mockReturnValue({});
    mocks.claimDemoDeletion.mockResolvedValue([userId]);
    mocks.processDemoDeletion.mockResolvedValue('deleted');
  });
  afterEach(() => { delete process.env.T22_INTERNAL_JOB_SECRET; });

  it('rejects bad MAC and stale timestamps before service role access', async () => {
    expect((await POST(request('{"limit":1}', undefined, false))).status).toBe(401);
    expect((await POST(request('{"limit":1}', String(Math.floor(Date.now()/1000)-301)))).status).toBe(401);
    expect(mocks.createCartServiceClient).not.toHaveBeenCalled();
  });

  it('processes at most five signed candidates and reports deferred work without identifiers', async () => {
    mocks.processDemoDeletion.mockResolvedValueOnce('deferred');
    const response = await POST(request('{"limit":1}'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ checked: 1, deleted: 0, deferred: 1 });
    expect(mocks.claimDemoDeletion).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('rejects unconfigured secrets and malformed signed bodies', async () => {
    delete process.env.T22_INTERNAL_JOB_SECRET;
    expect((await POST(request('{"limit":1}'))).status).toBe(503);
    process.env.T22_INTERNAL_JOB_SECRET = secret;
    expect((await POST(request('{"limit":6}'))).status).toBe(400);
  });
});
