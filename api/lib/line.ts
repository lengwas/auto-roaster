import { createHmac } from 'crypto';

/** Verify LINE webhook signature (HMAC-SHA256). */
export function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

/** Download image content from LINE Content API. Returns raw Buffer. */
export async function downloadImage(messageId: string, accessToken: string): Promise<Buffer> {
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE downloadImage failed: ${res.status} ${res.statusText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/** Send a reply message to a LINE chat using the replyToken. */
export async function replyMessage(replyToken: string, text: string, accessToken: string): Promise<void> {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
  if (!res.ok) {
    console.error('LINE replyMessage failed:', res.status, await res.text());
  }
}
