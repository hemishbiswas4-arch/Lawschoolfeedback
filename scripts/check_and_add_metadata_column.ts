// =======================================================
// CHECK AND ADD METADATA_JSON COLUMN
// =======================================================
// Script to check if metadata_json column exists and add it if needed
// Run with: npx tsx scripts/check_and_add_metadata_column.ts
// =======================================================

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkAndAddMetadataColumn() {
  console.log("🔍 Checking if metadata_json column exists...")

  try {
    // Try to select from the table with metadata_json to see if it exists
    const { error } = await supabaseAdmin
      .from("source_chunks")
      .select("id, metadata_json")
      .limit(1)

    if (error && (error.message?.includes("metadata_json") || error.code === 'PGRST204')) {
      console.log("❌ metadata_json column not found, adding it...")

      // Column doesn't exist, let's add it
      const { error: alterError } = await supabaseAdmin.rpc('exec_sql', {
        sql: `
          ALTER TABLE source_chunks
          ADD COLUMN IF NOT EXISTS metadata_json JSONB;

          COMMENT ON COLUMN source_chunks.metadata_json IS 'Extracted metadata for improved legal document retrieval (case citations, statute references, section headers, etc.)';
        `
      })

      if (alterError) {
        console.error("❌ Failed to add metadata_json column:", alterError)
        console.log("💡 Please run the SQL migration manually in your Supabase SQL editor:")
        console.log(`
ALTER TABLE source_chunks
ADD COLUMN IF NOT EXISTS metadata_json JSONB;

COMMENT ON COLUMN source_chunks.metadata_json IS 'Extracted metadata for improved legal document retrieval (case citations, statute references, section headers, etc.)';
        `)
        process.exit(1)
      }

      console.log("✅ metadata_json column added successfully!")
    } else {
      console.log("✅ metadata_json column already exists")
    }

    // Verify the column exists
    const { data, error: verifyError } = await supabaseAdmin
      .from("source_chunks")
      .select("id, metadata_json")
      .limit(1)

    if (verifyError) {
      console.error("❌ Verification failed:", verifyError)
    } else {
      console.log("✅ Column verification successful")
    }

  } catch (err) {
    console.error("❌ Unexpected error:", err)
    process.exit(1)
  }
}

checkAndAddMetadataColumn()