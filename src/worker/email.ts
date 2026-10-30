import type { Env } from './env';

/** Sends a plain-text email through Resend when configured. Returns false when email is not set up. */
export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) console.error('email send failed', res.status, await res.text());
  return res.ok;
}

export function emailEnabled(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
}
