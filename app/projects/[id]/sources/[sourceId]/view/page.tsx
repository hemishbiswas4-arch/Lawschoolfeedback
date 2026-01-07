// @/app/projects/[id]/sources/[sourceId]/view/page.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import * as pdfjs from "pdfjs-dist"

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js"

export default function SourceViewerPage() {
  const { sourceId } = useParams<{ sourceId: string }>()
  const search = useSearchParams()
  const pageNumber = Number(search.get("page")) || 1

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/sources/${sourceId}/pdf`)
      const { url } = await res.json()

      const pdf = await pdfjs.getDocument(url).promise
      const page = await pdf.getPage(pageNumber)

      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({ canvasContext: ctx, viewport }).promise
      setLoading(false)
    }

    load()
  }, [sourceId, pageNumber])

  return (
    <div style={{ padding: "20px" }}>
      {loading && <p>Loading PDF…</p>}
      <canvas ref={canvasRef} />
    </div>
  )
}
