import { NextResponse, type NextRequest } from 'next/server';
import { authError } from '@/server/auth/http';
import { buildAuthEmailMessage, isAllowedAuthEmailRecipient, verifyAuthEmailHookSignature } from '@/server/auth/email-hook';
import { sendAuthEmail } from '@/server/auth/smtp';

export const runtime = 'nodejs';

async function readLimitedBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch { return null; }
}

export async function POST(request: NextRequest) {
  const rawBody = await readLimitedBody(request);
  if (rawBody === null) return authError(400, 'BAD_REQUEST', 'リクエスト形式を確認してください。');
  if (!verifyAuthEmailHookSignature(rawBody, request.headers)) {
    return authError(401, 'UNAUTHORIZED', '署名を確認できませんでした。');
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch {
    return authError(400, 'BAD_REQUEST', 'リクエスト形式を確認してください。');
  }
  const message = buildAuthEmailMessage(payload);
  if (!message) {
    return authError(400, 'BAD_REQUEST', 'メール要求を処理できませんでした。');
  }
  if (!isAllowedAuthEmailRecipient(message.to)) {
    return authError(403, 'FORBIDDEN', 'この環境では送信できない宛先です。');
  }

  try {
    await sendAuthEmail(message);
  } catch {
    // Supabase Auth must not complete the operation when delivery has failed.
    // Its caller can use the existing resend flow after SMTP is available.
    return authError(503, 'UNAVAILABLE', 'メールを送信できませんでした。設定を確認して再送してください。');
  }

  // Supabase treats an empty 200 response as successful delivery.
  return new NextResponse(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
