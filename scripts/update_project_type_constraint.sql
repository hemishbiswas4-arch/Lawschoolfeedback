-- =======================================================
-- UPDATE PROJECT TYPE CONSTRAINT
-- =======================================================
-- This script updates the projects_project_type_check constraint
-- to include all project types defined in the frontend
-- =======================================================

-- First, drop the existing constraint
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_type_check;

-- Then, add the new constraint with all allowed project types
ALTER TABLE projects ADD CONSTRAINT projects_project_type_check
CHECK (project_type IN (
  -- Academic Research
  'research_paper',
  'literature_review',
  'systematic_review',
  'empirical_study',
  'theoretical_paper',

  -- Case Analysis
  'case_analysis',
  'case_note',
  'case_comment',

  -- Articles & Publications
  'journal_article',
  'law_review_article',
  'book_chapter'
));

-- Verify the constraint was created successfully
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'projects_project_type_check';
