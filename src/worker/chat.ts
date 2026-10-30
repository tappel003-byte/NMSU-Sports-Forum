import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

interface Member { id: number; username: string; display_name: string | null; role: string }

// One Durable Object per chat room fans messages out to connected members over
// hibernating WebSockets (no cost while idle). Messages are persisted in D1 so the
// full chat is archived permanently and linked to its game.
export class ChatRoom extends DurableObject<Env> {
  private lastSent = new Map<number, number[]>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') ?? '';
    if (url.pathname === '/broadcast') {
      this.broadcast(await request.text());
      return new Response('ok');
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const member = JSON.parse(request.headers.get('x-member') ?? 'null') as Member | null;
    if (!member) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ member, room });
    this.sendPresence();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const { member, room } = ws.deserializeAttachment() as { member: Member; room: string };
    let msg: { type: string; body?: string; id?: number };
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
    // Thread rooms only push "new post" signals to readers; nobody sends into them.
    if (room.startsWith('thread-')) return;
    if (msg.type === 'send') {
      const body = (msg.body ?? '').trim().slice(0, 1000);
      if (!body) return;
      const status = await this.env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(member.id).first<{ status: string }>();
      if (status?.status !== 'active') { ws.close(4003, 'Account not active'); return; }
      // Burst limit: 8 messages per 10 seconds per member.
      const t = Date.now();
      const recent = (this.lastSent.get(member.id) ?? []).filter((x) => t - x < 10_000);
      if (recent.length >= 8) { ws.send(JSON.stringify({ type: 'error', message: 'Slow down a little.' })); return; }
      recent.push(t);
      this.lastSent.set(member.id, recent);
      const r = await this.env.DB.prepare('INSERT INTO chat_messages (room, user_id, body, created_at) VALUES (?, ?, ?, ?)').bind(room, member.id, body, t).run();
      this.broadcast(JSON.stringify({ type: 'message', message: { id: r.meta.last_row_id, user_id: member.id, username: member.username, display_name: member.display_name, body, created_at: t } }));
      return;
    }
    if (msg.type === 'delete' && msg.id && member.role === 'admin') {
      await this.env.DB.prepare('UPDATE chat_messages SET deleted = 1, deleted_by = ? WHERE id = ? AND room = ?').bind(member.id, msg.id, room).run();
      await this.env.DB.prepare('INSERT INTO mod_log (actor_id, action, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(member.id, 'remove_chat', 'chat_message', msg.id, Date.now()).run();
      this.broadcast(JSON.stringify({ type: 'deleted', id: msg.id }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code === 1005 ? 1000 : code, 'closing'); } catch { /* already closed */ }
    this.sendPresence();
  }

  async webSocketError(): Promise<void> {
    this.sendPresence();
  }

  private broadcast(data: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(data); } catch { /* socket gone */ }
    }
  }

  private sendPresence(): void {
    const seen = new Map<number, { id: number; username: string }>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as { member: Member } | null;
      if (a) seen.set(a.member.id, { id: a.member.id, username: a.member.username });
    }
    this.broadcast(JSON.stringify({ type: 'presence', members: [...seen.values()] }));
  }
}
