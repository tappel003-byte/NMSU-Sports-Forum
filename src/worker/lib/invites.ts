import type { Env, SessionUser } from '../env';
import { getSetting, run } from '../db';
import { emailEnabled, sendEmail } from '../email';
import { DAY, linkToken, now, sha256 } from '../util';

export interface InviteOptions { email?: string; lockEmail?: boolean; name?: string; note?: string; days: number; maxUses: number }

/** Members may invite friends unless an admin switches it off (on by default). */
export async function memberInvitesOn(env: Env): Promise<boolean> {
  return (await getSetting(env, 'member_invites')) !== '0';
}

/** Creates an invitation and returns its link (shown once; only the hash is stored). Emails it when an email service is set up. */
export async function createInvite(env: Env, origin: string, user: SessionUser, o: InviteOptions) {
  const token = linkToken();
  const t = now();
  // Phone numbers are never sent here: texting happens on the inviter's own phone.
  const note = [o.name, o.note].filter(Boolean).join(' — ') || (o.email ? `Emailed to ${o.email}` : null);
  await run(env, 'INSERT INTO invites (token_hash, created_by, email, note, max_uses, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    await sha256(token), user.id, o.email && o.lockEmail ? o.email : null, note, o.maxUses, t + o.days * DAY, t);
  const link = `${origin}/join/${token}`;
  let emailed = false;
  if (o.email && emailEnabled(env)) {
    emailed = await sendEmail(env, o.email, "You're invited to NMSU Sports Forum",
      `${o.name ? `Hi ${o.name},\n\n` : ''}${user.display_name || user.username} invited you to join NMSU Sports Forum, a community for Aggie fans.\n\nCreate your account here (link works once and expires in ${o.days} days):\n${link}\n\nNMSU Sports Forum is an independent fan community, not affiliated with New Mexico State University.`);
  }
  return { link, emailed, note, emailEnabled: emailEnabled(env), days: o.days };
}
