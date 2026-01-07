// @/app/projects/page.tsx
// @/app/projects/page.tsx
"use client"

export const dynamic = "force-dynamic"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"

/* ================= TYPES ================= */

type ProjectRow = {
  id: string
  title: string
  created_at: string
}

/* ================= PAGE ================= */

export default function ProjectsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<ProjectRow[]>([])

  /* ================= LOAD ================= */

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.auth.getSession()
      const user = data.session?.user

      if (!user) {
        router.replace("/login")
        return
      }

      const { data: projectsData, error } = await supabase
        .from("projects")
        .select("id, title, created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })

      if (error) {
        console.error("PROJECTS ❌ fetch failed", error)
        setProjects([])
      } else {
        setProjects(projectsData ?? [])
      }

      setLoading(false)
    }

    load()
  }, [router])

  /* ================= STATES ================= */

  if (loading) {
    return (
      <div style={{ padding: "80px", color: "#666" }}>
        Loading projects…
      </div>
    )
  }

  /* ================= STYLES ================= */

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#f9fafb",
      fontFamily: "sans-serif",
      padding: "80px",
    },
    header: {
      marginBottom: "32px",
    },
    title: {
      fontSize: "28px",
      fontWeight: 700,
      marginBottom: "8px",
    },
    subtitle: {
      fontSize: "14px",
      color: "#6b7280",
    },
    primaryBtn: {
      display: "inline-block",
      background: "#111",
      color: "#fff",
      padding: "10px 18px",
      borderRadius: "8px",
      fontSize: "14px",
      fontWeight: 500,
      textDecoration: "none",
      marginBottom: "32px",
    },
    card: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "20px",
      maxWidth: "720px",
    },
    projectItem: {
      padding: "12px 0",
      borderBottom: "1px solid #f3f4f6",
    },
    projectTitle: {
      fontSize: "15px",
      fontWeight: 500,
    },
    projectDate: {
      fontSize: "12px",
      color: "#9ca3af",
    },
    empty: {
      fontSize: "14px",
      color: "#6b7280",
    },
  }

  /* ================= RENDER ================= */

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Projects</h1>
        <p style={styles.subtitle}>
          Build research and written work directly from sources.
        </p>
      </div>

      <Link href="/projects/new" style={styles.primaryBtn}>
        New Project
      </Link>

      <div style={styles.card}>
        {projects.length === 0 ? (
          <div style={styles.empty}>
            No projects yet. Create one to start building from sources.
          </div>
        ) : (
          projects.map((p) => (
            <div key={p.id} style={styles.projectItem}>
              <Link
                href={`/projects/${p.id}`}
                style={{ textDecoration: "none", color: "#111" }}
              >
                <div style={styles.projectTitle}>{p.title}</div>
                <div style={styles.projectDate}>
                  Created {new Date(p.created_at).toLocaleDateString()}
                </div>
              </Link>
            </div>
          ))
        )}
      </div>
    </div>
  )
}