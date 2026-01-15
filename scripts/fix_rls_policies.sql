-- =======================================================
-- FIX RLS POLICIES FOR UPLOAD FUNCTIONALITY
-- Run this in Supabase SQL Editor to fix upload issues (just to push)
-- =======================================================

-- Enable RLS on the tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies that might conflict
DROP POLICY IF EXISTS "Users can view their own projects" ON projects;
DROP POLICY IF EXISTS "Users can create projects" ON projects;
DROP POLICY IF EXISTS "Users can update their projects" ON projects;
DROP POLICY IF EXISTS "Users can delete their projects" ON projects;

DROP POLICY IF EXISTS "Users can view sources in their projects" ON project_sources;
DROP POLICY IF EXISTS "Users can create sources in their projects" ON project_sources;
DROP POLICY IF EXISTS "Users can update sources in their projects" ON project_sources;
DROP POLICY IF EXISTS "Users can delete sources in their projects" ON project_sources;

DROP POLICY IF EXISTS "Users can view chunks in their projects" ON source_chunks;
DROP POLICY IF EXISTS "Users can create chunks in their projects" ON source_chunks;
DROP POLICY IF EXISTS "Users can update chunks in their projects" ON source_chunks;
DROP POLICY IF EXISTS "Users can delete chunks in their projects" ON source_chunks;

-- =======================================================
-- PROJECTS TABLE POLICIES
-- =======================================================

-- Allow users to view projects they own
CREATE POLICY "projects_select_policy" ON projects
    FOR SELECT USING (auth.uid() = owner_id);

-- Allow users to insert projects they own
CREATE POLICY "projects_insert_policy" ON projects
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Allow users to update projects they own
CREATE POLICY "projects_update_policy" ON projects
    FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Allow users to delete projects they own
CREATE POLICY "projects_delete_policy" ON projects
    FOR DELETE USING (auth.uid() = owner_id);

-- =======================================================
-- PROJECT_SOURCES TABLE POLICIES
-- =======================================================

-- Allow users to view sources from projects they own
CREATE POLICY "project_sources_select_policy" ON project_sources
    FOR SELECT USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to insert sources into projects they own
CREATE POLICY "project_sources_insert_policy" ON project_sources
    FOR INSERT WITH CHECK (
        uploaded_by = auth.uid() AND
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to update sources in projects they own
CREATE POLICY "project_sources_update_policy" ON project_sources
    FOR UPDATE USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to delete sources from projects they own
CREATE POLICY "project_sources_delete_policy" ON project_sources
    FOR DELETE USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- =======================================================
-- SOURCE_CHUNKS TABLE POLICIES
-- =======================================================

-- Allow users to view chunks from sources in projects they own
CREATE POLICY "source_chunks_select_policy" ON source_chunks
    FOR SELECT USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to insert chunks for sources in projects they own
CREATE POLICY "source_chunks_insert_policy" ON source_chunks
    FOR INSERT WITH CHECK (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to update chunks in projects they own
CREATE POLICY "source_chunks_update_policy" ON source_chunks
    FOR UPDATE USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- Allow users to delete chunks from projects they own
CREATE POLICY "source_chunks_delete_policy" ON source_chunks
    FOR DELETE USING (
        project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        )
    );

-- =======================================================
-- VERIFICATION QUERIES
-- =======================================================

-- Check that RLS is enabled
SELECT
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN ('projects', 'project_sources', 'source_chunks');

-- List all policies
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;