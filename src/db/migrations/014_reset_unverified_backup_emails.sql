-- 014: Backup emails set before 2026-10 were never verified (typed in, no ownership proof).
-- Clear them so users re-link via Google OAuth. Run the incident-check queries in
-- SECURITY_FIX_PROMPT.md "Human steps" BEFORE running this, because it removes evidence.
UPDATE users SET backup_email = NULL, backup_email_verified_at = NULL WHERE backup_email IS NOT NULL;

