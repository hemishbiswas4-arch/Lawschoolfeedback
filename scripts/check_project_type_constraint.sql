-- =======================================================
-- CHECK CURRENT PROJECT TYPE CONSTRAINT
-- =======================================================
-- This script shows what project types are currently allowed
-- by the database constraint
-- =======================================================

-- Show the constraint definition
SELECT 
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'projects_project_type_check';

-- Extract just the allowed values (if constraint exists)
-- This query will show the CHECK constraint expression
SELECT 
  conname,
  pg_get_constraintdef(oid) as constraint_def
FROM pg_constraint
WHERE conrelid = 'projects'::regclass 
  AND conname = 'projects_project_type_check';

-- Alternative: Try to parse the constraint to list values
-- Note: This is a simplified extraction - the actual constraint
-- might be more complex
SELECT 
  conname,
  CASE 
    WHEN pg_get_constraintdef(oid) LIKE '%IN%' THEN 
      'Constraint uses IN clause - check the full definition above'
    ELSE 
      pg_get_constraintdef(oid)
  END as constraint_info
FROM pg_constraint
WHERE conrelid = 'projects'::regclass 
  AND conname = 'projects_project_type_check';
