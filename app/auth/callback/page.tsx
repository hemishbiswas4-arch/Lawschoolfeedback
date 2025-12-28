"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

export default function Page() {
  const router = useRouter()

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession()

      if (data.session?.user) {
        router.replace("/dashboard")
      } else {
        router.replace("/login")
      }
    }

    run()
  }, [router])

  return (
    <div style={{ padding: "2rem" }}>
      <p>Signing you in…</p>
    </div>
  )
}
