-- =======================================================
-- CLEAR ALL DATA - Complete Database Reset
-- =======================================================
-- WARNING: This will delete ALL data from the application
-- Run these commands in order to respect foreign key constraints
-- =======================================================

-- 1. Delete source chunks (references project_sources)
DELETE FROM source_chunks;

-- 2. Delete project sources (references projects)
DELETE FROM project_sources;

-- 3. Delete projects
DELETE FROM projects;

-- 4. Delete document shares (references documents)
DELETE FROM document_shares;

-- 5. Delete notifications (may reference documents/projects)
DELETE FROM notifications;

-- 6. Delete documents
DELETE FROM documents;

-- 7. Delete document comments (if exists)
DELETE FROM document_comments;

-- =======================================================
-- VERIFICATION QUERIES (run after deletion to confirm)
-- =======================================================

-- Check remaining counts
SELECT 
  'projects' as table_name, COUNT(*) as count FROM projects
UNION ALL
SELECT 'project_sources', COUNT(*) FROM project_sources
UNION ALL
SELECT 'source_chunks', COUNT(*) FROM source_chunks
UNION ALL
SELECT 'documents', COUNT(*) FROM documents
UNION ALL
SELECT 'document_shares', COUNT(*) FROM document_shares
UNION ALL
SELECT 'notifications', COUNT(*) FROM notifications;

-- =======================================================
-- ALTERNATIVE: If you want to keep user accounts but clear all data
-- =======================================================

-- This version keeps auth.users and profiles intact
-- Just uncomment and use instead:

/*
-- 1. Delete source chunks
DELETE FROM source_chunks;

-- 2. Delete project sources  
DELETE FROM project_sources;

-- 3. Delete projects
DELETE FROM projects;

-- 4. Delete document shares
DELETE FROM document_shares;

-- 5. Delete notifications
DELETE FROM notifications;

-- 6. Delete documents
DELETE FROM documents;

-- 7. Delete document comments
DELETE FROM document_comments;
*/

-- =======================================================
-- STORAGE CLEANUP (if you also want to clear storage buckets)
-- =======================================================
-- Note: Storage cleanup must be done via Supabase Dashboard or API
-- SQL cannot directly delete storage files
--
-- To clear storage buckets:
-- 1. Go to Supabase Dashboard > Storage
-- 2. Delete files from "sources" bucket
-- 3. Delete files from "document uploads" bucket
-- =======================================================
