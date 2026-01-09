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
  
  -- Legal Documents
  'legal_brief',
  'motion_brief',
  'appellate_brief',
  'legal_memorandum',
  'client_opinion',
  
  -- Case Analysis
  'case_analysis',
  'case_note',
  'case_comment',
  'comparative_case_study',
  
  -- Policy & Reform
  'policy_analysis',
  'law_reform_paper',
  'regulatory_analysis',
  'impact_assessment',
  
  -- Extended Academic Work
  'thesis',
  'dissertation',
  'masters_thesis',
  'capstone_project',
  
  -- Articles & Publications
  'journal_article',
  'law_review_article',
  'opinion_piece',
  'book_chapter',
  
  -- Practice-Oriented
  'practice_guide',
  'compliance_manual',
  'training_material',
  
  -- Other
  'other'
));

-- Verify the constraint was created successfully
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'projects_project_type_check';
