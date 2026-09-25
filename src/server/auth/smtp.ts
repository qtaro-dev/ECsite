import 'server-only';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import type { AuthEmailMessage } from './email-hook';

type SmtpSettings = {
  host: string;
  port: number;
  tls_mode: 'implicit' | 'starttls' | 'none';
  sender_address: string;
  sender_name: string;
  username: string | null;
  smtp_password: string;
};

function requiredEnvironment(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (!value) throw new Error('SMTP configuration is unavailable');
  return value;
}

async function getActiveSmtpSettings(): Promise<SmtpSettings> {
  const supabase = createClient(
    requiredEnvironment('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
  );
  const { data, error } = await supabase.rpc('get_active_smtp_delivery_settings');
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error('SMTP configuration is unavailable');
  const settings = data[0] as SmtpSettings;
  if (!settings.host || !settings.sender_address || !settings.smtp_password) throw new Error('SMTP configuration is unavailable');
  if (settings.tls_mode === 'none' && (process.env.VERCEL_ENV !== undefined || process.env.NODE_ENV === 'production')) {
    throw new Error('SMTP configuration is unavailable');
  }
  return settings;
}

export async function sendAuthEmail(message: AuthEmailMessage): Promise<void> {
  const settings = await getActiveSmtpSettings();
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.tls_mode === 'implicit',
    requireTLS: settings.tls_mode === 'starttls',
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(settings.username ? { auth: { user: settings.username, pass: settings.smtp_password } } : {}),
  });
  await transporter.sendMail({
    from: { name: settings.sender_name, address: settings.sender_address },
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}
