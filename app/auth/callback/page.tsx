import { Suspense } from "react"
import CallbackClient from "./CallbackClient"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <Suspense fallback={<p style={{ padding: "2rem" }}>Finalising sign-in…</p>}>
      <CallbackClient />
    </Suspense>
  )
}
