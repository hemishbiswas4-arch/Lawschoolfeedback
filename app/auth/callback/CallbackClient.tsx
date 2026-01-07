"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

const NEXT_KEY = "auth:next-path"

export default function CallbackClient(): JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const finish = async () => {
      const code = searchParams.get("code")

      const storedNext =
        typeof window !== "undefined"
          ? localStorage.getItem(NEXT_KEY)
          : null

      const next =
        storedNext === "/projects" ? "/projects" : "/dashboard"

      if (typeof window !== "undefined") {
        localStorage.removeItem(NEXT_KEY)
      }

      const { data: existing } = await supabase.auth.getSession()
      if (existing.session) {
        router.replace(next)
        return
      }

      if (!code) {
        router.replace("/login")
        return
      }

      const { error } =
        await supabase.auth.exchangeCodeForSession(code)

      if (error) {
        console.error("OAuth exchange failed:", error)
        router.replace("/login")
        return
      }

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
