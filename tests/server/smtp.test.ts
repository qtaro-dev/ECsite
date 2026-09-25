import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, createTransport, sendMail } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { sendAuthEmail } from '@/server/auth/smtp';

describe('SMTP delivery adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'preview');
    createClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({
      data: [{
        host: 'smtp.example.test', port: 587, tls_mode: 'starttls',
        sender_address: 'store@example.test', sender_name: 'Store',
        username: 'smtp-user', smtp_password: 'vault-secret-test-value',
      }], error: null,
    }) });
    createTransport.mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ messageId: 'not-logged' });
  });

  it('loads the active secret through the server RPC and awaits TLS protected SMTP delivery', async () => {
    await sendAuthEmail({ to: 'member@example.test', subject: '確認', text: '本文' });
    expect(createClient).toHaveBeenCalledWith('https://project.supabase.co', 'server-only-test-key', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    expect(createClient.mock.results[0].value.rpc).toHaveBeenCalledWith('get_active_smtp_delivery_settings');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.test', port: 587, secure: false, requireTLS: true,
      auth: { user: 'smtp-user', pass: 'vault-secret-test-value' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    }));
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: 'Store', address: 'store@example.test' },
      to: 'member@example.test', subject: '確認', text: '本文',
    });
  });

  it('fails closed when the protected RPC is missing or returns no active setting', async () => {
    createClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) });
    await expect(sendAuthEmail({ to: 'member@example.test', subject: '確認', text: '本文' }))
      .rejects.toThrow('SMTP configuration is unavailable');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('rejects non-TLS SMTP on hosted environments and propagates send failures for retry', async () => {
    createClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({
      data: [{ host: 'smtp.example.test', port: 25, tls_mode: 'none', sender_address: 'store@example.test',
        sender_name: 'Store', username: null, smtp_password: 'vault-secret-test-value' }], error: null,
    }) });
    await expect(sendAuthEmail({ to: 'member@example.test', subject: '確認', text: '本文' }))
      .rejects.toThrow('SMTP configuration is unavailable');
    expect(createTransport).not.toHaveBeenCalled();

    createClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({
      data: [{ host: 'smtp.example.test', port: 465, tls_mode: 'implicit', sender_address: 'store@example.test',
        sender_name: 'Store', username: null, smtp_password: 'vault-secret-test-value' }], error: null,
    }) });
    sendMail.mockRejectedValueOnce(new Error('provider details must not be returned'));
    await expect(sendAuthEmail({ to: 'member@example.test', subject: '確認', text: '本文' }))
      .rejects.toThrow('provider details must not be returned');
  });
});
