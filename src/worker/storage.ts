import type { Env } from './env';

// Photos go to R2 when a bucket is bound; otherwise they are stored in D1 so the
// forum works without enabling R2 (which requires a payment method on file).
export async function putObject(env: Env, key: string, data: ArrayBuffer, contentType: string): Promise<void> {
  if (env.UPLOADS) await env.UPLOADS.put(key, data, { httpMetadata: { contentType } });
  else await env.DB.prepare('INSERT OR REPLACE INTO blobs (key, content_type, data) VALUES (?, ?, ?)').bind(key, contentType, data).run();
}

export async function getObject(env: Env, key: string): Promise<{ body: ArrayBuffer | ReadableStream; contentType: string } | null> {
  if (env.UPLOADS) {
    const o = await env.UPLOADS.get(key);
    return o ? { body: o.body, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
  }
  const r = await env.DB.prepare('SELECT content_type, data FROM blobs WHERE key = ?').bind(key).first<{ content_type: string; data: number[] | ArrayBuffer }>();
  if (!r) return null;
  const body = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data).buffer;
  return { body, contentType: r.content_type };
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  if (env.UPLOADS) await env.UPLOADS.delete(key);
  else await env.DB.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
}
