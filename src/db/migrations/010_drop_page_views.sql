-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 010: Drop page_views
--
-- The page-view counter (public count + admin analytics) has been removed from
-- the site. This drops the backing table and all stored counts.
--
-- Run: wrangler d1 execute bitsnotes_auth --file=src/db/migrations/010_drop_page_views.sql --remote
-- ═══════════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS page_views;
