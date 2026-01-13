-- =======================================================
-- CREATE USAGE LOGS TABLE
-- =======================================================
-- This script creates a table to track user usage metrics
-- for the law-feedback application
-- =======================================================

-- Create usage_logs table
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL, -- Reference to auth.users.id
    user_email VARCHAR(255) NOT NULL,
    feature VARCHAR(100) NOT NULL, -- e.g., 'reasoning_generate', 'reasoning_retrieve'
    project_id UUID, -- Optional: link to project if applicable
    usage_count INTEGER DEFAULT 1,
    first_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure unique combination of user and feature
    UNIQUE(user_id, feature)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_feature ON usage_logs(feature);
CREATE INDEX IF NOT EXISTS idx_usage_logs_last_used_at ON usage_logs(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_project_id ON usage_logs(project_id);

-- Add RLS (Row Level Security) policies
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own usage logs
CREATE POLICY "Users can read their own usage logs" ON usage_logs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Allow service role to insert/update usage logs (for API logging)
CREATE POLICY "Service role can manage usage logs" ON usage_logs
    FOR ALL
    USING (auth.role() = 'service_role');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_usage_logs_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_usage_logs_updated_at
    BEFORE UPDATE ON usage_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_usage_logs_updated_at_column();

-- Function to increment usage count or create new log entry
CREATE OR REPLACE FUNCTION increment_usage_log(
    p_user_id UUID,
    p_user_email VARCHAR(255),
    p_feature VARCHAR(100),
    p_project_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO usage_logs (user_id, user_email, feature, project_id, usage_count, first_used_at, last_used_at)
    VALUES (p_user_id, p_user_email, p_feature, p_project_id, 1, NOW(), NOW())
    ON CONFLICT (user_id, feature)
    DO UPDATE SET
        usage_count = usage_logs.usage_count + 1,
        last_used_at = NOW(),
        project_id = COALESCE(EXCLUDED.project_id, usage_logs.project_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;