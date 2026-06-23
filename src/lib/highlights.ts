/**
 * D1 queries for highlights and inline notes.
 */

import { uuidv7 } from './auth/crypto';
import type { AuthDb } from './auth/db';

export interface Highlight {
  id: string;
  user_id: string;
  subject: string;
  lecture: string;
  selector_path: string;
  start_offset: number;
  end_offset: number;
  note_body: string | null;
  color: string;
  created_at: number;
  updated_at: number;
}

// ─── Selector validation ────────────────────────────────────────────────────

const SELECTOR_PATTERN = /^#lecture-content\s*>\s*/;
const FORBIDDEN_PATTERNS = [/javascript:/i, /on\w+\s*=/i, /expression\s*\(/i];

export function validateSelector(selectorPath: string): boolean {
  if (!selectorPath || selectorPath.length > 1000) return false;
  if (!SELECTOR_PATTERN.test(selectorPath)) return false;
  if (FORBIDDEN_PATTERNS.some(p => p.test(selectorPath))) return false;
  return true;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function listHighlights(
  db: AuthDb,
  userId: string,
  subject: string,
  lecture: string,
): Promise<Highlight[]> {
  const result = await db.prepare(
    'SELECT * FROM highlights WHERE user_id = ? AND subject = ? AND lecture = ? ORDER BY start_offset',
  ).bind(userId, subject, lecture).all<Highlight>();
  return result.results ?? [];
}

export async function listAllHighlights(
  db: AuthDb,
  userId: string,
  subject: string,
): Promise<Highlight[]> {
  const result = await db.prepare(
    'SELECT * FROM highlights WHERE user_id = ? AND subject = ? ORDER BY lecture, start_offset',
  ).bind(userId, subject).all<Highlight>();
  return result.results ?? [];
}

export async function saveHighlight(
  db: AuthDb,
  userId: string,
  opts: {
    subject: string;
    lecture: string;
    selectorPath: string;
    startOffset: number;
    endOffset: number;
    noteBody?: string;
    color?: string;
  },
): Promise<Highlight> {
  if (!validateSelector(opts.selectorPath)) {
    throw new Error('Invalid selector path');
  }

  const id = uuidv7();
  const now = Date.now();
  const noteBody = opts.noteBody ? opts.noteBody.replace(/<[^>]*>/g, '').slice(0, 2000) : null;
  const color = (opts.color === 'blue' || opts.color === 'yellow') ? opts.color : 'yellow';

  await db.prepare(
    `INSERT INTO highlights (id, user_id, subject, lecture, selector_path, start_offset, end_offset, note_body, color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, userId, opts.subject, opts.lecture,
    opts.selectorPath, opts.startOffset, opts.endOffset,
    noteBody, color, now, now,
  ).run();

  return {
    id, user_id: userId, subject: opts.subject, lecture: opts.lecture,
    selector_path: opts.selectorPath, start_offset: opts.startOffset, end_offset: opts.endOffset,
    note_body: noteBody, color, created_at: now, updated_at: now,
  };
}

export async function removeHighlight(
  db: AuthDb,
  userId: string,
  highlightId: string,
): Promise<boolean> {
  const result = await db.prepare(
    'DELETE FROM highlights WHERE id = ? AND user_id = ?',
  ).bind(highlightId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function updateHighlightNote(
  db: AuthDb,
  userId: string,
  highlightId: string,
  noteBody: string,
): Promise<boolean> {
  const sanitized = noteBody.replace(/<[^>]*>/g, '').slice(0, 2000);
  const result = await db.prepare(
    'UPDATE highlights SET note_body = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  ).bind(sanitized, Date.now(), highlightId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}
