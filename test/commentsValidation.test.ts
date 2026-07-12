import { describe, it, expect } from 'vitest';
import {
  validateCommentBody,
  moderateSubmission,
  MAX_BODY,
  MIN_BODY,
  MAX_NAME,
  MIN_NAME,
  MIN_FILL_MS,
  MAX_JSON_BYTES,
} from '../src/lib/commentsValidation';

describe('validateCommentBody', () => {
  const base = {
    pageType: 'lecture',
    subject: 'NLP',
    lecture: 'Lecture_01',
    displayName: 'Ada',
    body: 'This was very helpful, thank you!',
  };

  it('accepts a valid lecture comment', () => {
    const v = validateCommentBody(base);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.subject).toBe('NLP');
      expect(v.lecture).toBe('Lecture_01');
      expect(v.displayName).toBe('Ada');
    }
  });

  it('accepts a valid subject comment without lecture', () => {
    const v = validateCommentBody({ ...base, pageType: 'subject', lecture: undefined });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.lecture).toBeNull();
  });

  it('rejects invalid pageType', () => {
    const v = validateCommentBody({ ...base, pageType: 'video' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(400);
  });

  it('requires lecture for lecture pages', () => {
    const v = validateCommentBody({ ...base, lecture: '' });
    expect(v.ok).toBe(false);
  });

  it('rejects missing subject', () => {
    const v = validateCommentBody({ ...base, subject: '   ' });
    expect(v.ok).toBe(false);
  });

  it('rejects display name shorter than MIN_NAME', () => {
    const v = validateCommentBody({ ...base, displayName: 'A' });
    expect(v.ok).toBe(false);
  });

  it('rejects display name longer than MAX_NAME', () => {
    const v = validateCommentBody({ ...base, displayName: 'x'.repeat(MAX_NAME + 1) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(400);
  });

  it('rejects body shorter than MIN_BODY', () => {
    const v = validateCommentBody({ ...base, body: 'ab' });
    expect(v.ok).toBe(false);
  });

  it('rejects body longer than MAX_BODY', () => {
    const v = validateCommentBody({ ...base, body: 'x'.repeat(MAX_BODY + 1) });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.status).toBe(400);
  });

  it('rejects HTML in body', () => {
    const v = validateCommentBody({ ...base, body: 'nice <script>alert(1)</script> thanks' });
    expect(v.ok).toBe(false);
  });

  it('rejects more than one link', () => {
    const v = validateCommentBody({ ...base, body: 'see https://a.com and https://b.com' });
    expect(v.ok).toBe(false);
  });

  it('allows exactly one link', () => {
    const v = validateCommentBody({ ...base, body: 'see https://a.com for more' });
    expect(v.ok).toBe(true);
  });

  it('strips control characters via sanitize', () => {
    const v = validateCommentBody({ ...base, body: 'clean\u0000text' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.body).toBe('cleantext');
  });
});

describe('moderateSubmission', () => {
  it('rejects profanity (do not store)', () => {
    const m = moderateSubmission('Ada', 'you ass');
    expect(m.rejected).toBe(true);
    expect(m.status).toBe('pending');
  });

  it('holds spam as pending (not rejected)', () => {
    const m = moderateSubmission('Ada', 'buy now aaaaaaaaaaaaaaaaaaaaa https://spam.com');
    expect(m.rejected).toBe(false);
    expect(m.status).toBe('pending');
  });

  it('publishes clean text', () => {
    const m = moderateSubmission('Ada', 'This was a clear explanation of HMMs.');
    expect(m.rejected).toBe(false);
    expect(m.status).toBe('published');
  });
});

describe('constants', () => {
  it('exposes expected limits', () => {
    expect(MIN_BODY).toBe(3);
    expect(MAX_BODY).toBe(1500);
    expect(MIN_NAME).toBe(2);
    expect(MAX_NAME).toBe(40);
    expect(MIN_FILL_MS).toBe(2000);
    expect(MAX_JSON_BYTES).toBe(16 * 1024);
  });
});
