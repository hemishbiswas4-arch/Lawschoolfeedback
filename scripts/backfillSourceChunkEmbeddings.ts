// =======================================================
// FILE: scripts/backfillSourceChunkEmbeddings.ts
// =======================================================

import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })

import { createClient } from "@supabase/supabase-js"
import { embedText } from "../lib/bedrockEmbed"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const BATCH_SIZE = 25
const SLEEP_MS = 300

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function backfill() {
  console.log("Starting embedding backfill…")

  while (true) {
    const { data: chunks, error } = await supabaseAdmin
      .from("source_chunks")
      .select(
        `
        id,
        text,
        project_sources!inner(status)
      `
      )
      .is("embedding", null)
      .eq("project_sources.status", "complete")
      .eq("embedding_error", false)
      .limit(BATCH_SIZE)

    if (error) {
      console.error("SELECT FAILED:", error)
      process.exit(1)
    }

    if (!chunks || chunks.length === 0) {
      console.log("✓ Backfill complete")
      break
    }

    for (const chunk of chunks) {
      try {
        console.log("Embedding chunk", chunk.id)

        const embedding = await embedText(chunk.text)

        const { error: updateError } = await supabaseAdmin
          .from("source_chunks")
          .update({ embedding })
          .eq("id", chunk.id)

        if (updateError) {
          console.error("UPDATE FAILED:", updateError)
          process.exit(1)
        }

        await sleep(SLEEP_MS)
      } catch (err) {
        console.error("EMBEDDING FAILED:", chunk.id, err)

        await supabaseAdmin
          .from("source_chunks")
          .update({ embedding_error: true })
          .eq("id", chunk.id)

        continue
      }
    }
  }
}

backfill()
