-- =======================================================
-- CREATE FEEDBACK TABLE
-- =======================================================
-- This script creates a table to store user feedback
-- for the law-feedback application
-- =======================================================

-- Create feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email VARCHAR(255),
    feedback_text TEXT NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    feedback_type VARCHAR(50) DEFAULT 'general', -- general, bug, feature, ui, performance
    user_agent TEXT,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on created_at for efficient queries
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback(created_at DESC);

-- Create index on feedback_type for filtering
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback(feedback_type);

-- Create index on rating for analytics
CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(rating);

-- Add RLS (Row Level Security) policies if needed
-- For now, we'll allow anonymous feedback submissions
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert feedback (anonymous feedback)
CREATE POLICY "Anyone can submit feedback" ON feedback
    FOR INSERT
    WITH CHECK (true);

-- Allow authenticated users to read their own feedback
-- (For now, we'll allow reading all feedback for admin purposes)
CREATE POLICY "Authenticated users can read feedback" ON feedback
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_feedback_updated_at
    BEFORE UPDATE ON feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();