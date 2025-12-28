// @/app/layout.tsx
"use client"

import { useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log("Auth event:", event, session)
      }
    )

    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
