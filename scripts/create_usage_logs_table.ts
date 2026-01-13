import dotenv from "dotenv"
import { createClient } from "@supabase/supabase-js"

dotenv.config({ path: ".env.local" })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function createUsageLogsTable() {
  try {
    console.log("Creating usage_logs table...")

    // Create the table using Supabase's SQL execution
    // Since we can't execute raw SQL easily, let's try inserting a test record to see if table exists
    // If it fails, we'll assume table needs to be created manually

    console.log("Note: Please run the following SQL manually in your Supabase SQL editor:")
    console.log("")

    const fs = require('fs')
    const sqlContent = fs.readFileSync('./scripts/create_usage_logs_table.sql', 'utf8')
    console.log(sqlContent)

    console.log("")
    console.log("After running the SQL, this script will verify the table exists.")

    // Try to select from the table to verify it exists
    const { data, error } = await supabase
      .from('usage_logs')
      .select('*')
      .limit(1)

    if (error) {
      console.log('Table does not exist yet. Please run the SQL above in Supabase SQL editor.')
      return
    }

    console.log('Usage logs table already exists and is accessible!')

  } catch (error) {
    console.error('Error:', error)
  }
}

createUsageLogsTable()