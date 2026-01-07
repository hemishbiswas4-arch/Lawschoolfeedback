// @/app/auth/callback/page.tsx
"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

export default function Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ranRef = useRef(false)

  useEffect(() => {
    // 🛑 Prevent double execution
    if (ranRef.current) return
    ranRef.current = true

    const finish = async () => {
      const code = searchParams.get("code")
      const next =
        searchParams.get("next") === "/projects"
          ? "/projects"
          : "/dashboard"

      // If already signed in, just route
      const { data: existing } = await supabase.auth.getSession()
      if (existing.session) {
        router.replace(next)
        return
      }

      if (!code) {
        router.replace("/login")
        return
      }

      // ✅ Exchange OAuth code ONCE
      const { error } = await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        console.error("OAuth exchange failed:", error)
        router.replace("/login")
        return
      }

      // ✅ Strip code from URL BEFORE navigation
      window.history.replaceState({}, "", "/auth/callback")

      router.replace(next)
    }

    finish()
  }, [router, searchParams])

  return (
    <div style={{ padding: "2rem" }}>
      <p>Finalising sign-in…</p>
    </div>
  )
}
