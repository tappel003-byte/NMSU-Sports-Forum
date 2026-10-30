import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  CHAT: DurableObjectNamespace;
  UPLOADS?: R2Bucket;
  SITE_NAME: string;
  MAIL_FROM: string;
  RESEND_API_KEY?: string;
  BOOTSTRAP_TOKEN?: string;
}

export interface SessionUser {
  id: number;
  username: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
  display_name: string | null;
  avatar_key: string | null;
  prefs: string;
  marked_read_at: number;
  created_at: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; sessionId: string } };
export type Ctx = Context<AppEnv>;
