/**
 * Audit logging for security-sensitive auth events.
 */

import type { AuthDb } from './db';

export type AuthEvent =
  | 'signup'
  | 'login'
  | 'logout'
  | 'verify'
  | 'verify_resend'
  | 'failed_login'
  | 'state_mismatch'
  | 'turnstile_fail'
  | 'rate_limit'
  | 'bookmark_add'
  | 'bookmark_remove'
  | 'bookmark_move'
  | 'collection_create'
  | 'collection_rename'
  | 'collection_delete'
  | 'progress_mark_read';

export interface AuditContext {
  userId?: string;
  event: AuthEvent;
  provider?: string;
  ip?: string;
  ua?: string;
}

/**
 * Write an audit event. Best-effort — never throws.
 */
export async function logAuthEvent(db: AuthDb, ctx: AuditContext): Promise<void> {
  try {
    const now = Date.now();
    await db.prepare(
      'INSERT INTO auth_events (user_id, event, provider, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(ctx.userId ?? null, ctx.event, ctx.provider ?? null, ctx.ip ?? null, ctx.ua ?? null, now).run();
  } catch {
    // Best-effort — don't fail the request
  }
}
