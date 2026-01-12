# Admin Feedback Setup

## Database Setup

Run the SQL script to create the feedback table:

```sql
-- Execute this in your Supabase SQL editor
-- File: scripts/create_feedback_table.sql
```

## Access Admin Panel

1. Visit `/admin/feedback` in your browser
2. Enter the password: `hadesfudge`
3. You'll be authenticated and can view all feedback

## Features

- **Password Protection**: Simple password authentication with session persistence
- **Statistics Dashboard**: View total feedback, average ratings, and category breakdowns
- **Filtering & Sorting**: Filter by feedback type, rating status, and sort by various criteria
- **Pagination**: Load feedback in batches for better performance
- **Detailed View**: See full feedback text, user metadata, and timestamps

## Security Notes

- Password is hardcoded in the API route for simplicity
- Uses localStorage for session persistence (cleared on logout)
- All admin API calls require password authentication
- Feedback data is protected by RLS policies in the database

## API Endpoints

- `GET /api/admin/feedback` - Fetch feedback data (requires password authentication)
  - Query parameters: `password`, `limit`, `offset`, `type`, `has_rating`, `sort`, `order`