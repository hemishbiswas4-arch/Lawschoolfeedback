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

/* ================= DESIGN SYSTEM ================= */

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: "sans-serif",
    color: "#111"
  },
  container: {
    maxWidth: "1000px",
    margin: "0 auto",
    padding: "40px 20px"
  },

  // Header
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "32px"
  },
  title: {
    fontSize: "28px",
    fontWeight: 700,
    margin: 0,
    letterSpacing: "-0.02em",
    color: "#111"
  },
  subtitle: {
    fontSize: "14px",
    color: "#6b7280",
    marginTop: "8px"
  },

  // Buttons
  primaryBtn: {
    backgroundColor: "#111",
    color: "#fff",
    border: "none",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    textDecoration: "none",
    transition: "all 0.2s",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
  },

  // Projects Grid
  projectsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "20px",
    marginTop: "24px"
  },

  // Project Cards
  projectCard: {
    backgroundColor: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "24px",
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    textDecoration: "none",
    color: "inherit",
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px"
  },

  projectIcon: {
    width: "48px",
    height: "48px",
    backgroundColor: "#f3f4f6",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#6b7280"
  },

  projectTitle: {
    fontSize: "16px",
    fontWeight: 600,
    margin: 0,
    color: "#111"
  },

  projectDate: {
    fontSize: "13px",
    color: "#9ca3af",
    margin: 0
  },

  // Empty State
  emptyState: {
    textAlign: "center" as const,
    padding: "60px 20px",
    color: "#6b7280",
    backgroundColor: "#fff",
    border: "2px dashed #e5e7eb",
    borderRadius: "12px",
    marginTop: "24px"
  },

  emptyIcon: {
    width: "64px",
    height: "64px",
    backgroundColor: "#f9fafb",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
    color: "#d1d5db"
  },

  emptyTitle: {
    fontSize: "18px",
    fontWeight: 600,
    margin: "0 0 8px 0",
    color: "#374151"
  },

  emptyText: {
    fontSize: "14px",
    margin: "0 0 20px 0",
    lineHeight: "1.5"
  },

  // Loading
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    color: '#6b7280',
    fontSize: '14px'
  }
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

  /* ================= RENDER HELPERS ================= */

  if (loading) {
    return (
      <div style={styles.loading}>
        Loading projects…
      </div>
    )
  }

  const ProjectCard = ({ project }: { project: ProjectRow }) => (
    <Link href={`/projects/${project.id}`} style={styles.projectCard}>
      <div
        style={styles.projectIcon}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#e5e7eb"
          e.currentTarget.style.color = "#374151"
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "#f3f4f6"
          e.currentTarget.style.color = "#6b7280"
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10"/>
        </svg>
      </div>

      <div>
        <h3 style={styles.projectTitle}>{project.title}</h3>
        <p style={styles.projectDate}>
          Created {new Date(project.created_at).toLocaleDateString()}
        </p>
      </div>
    </Link>
  )

  const EmptyState = () => (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10"/>
        </svg>
      </div>
      <h3 style={styles.emptyTitle}>No projects yet</h3>
      <p style={styles.emptyText}>
        Create your first project to start building research and written work directly from sources.
      </p>
      <Link href="/projects/new" style={styles.primaryBtn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        Create Project
      </Link>
    </div>
  )

  /* ================= RENDER ================= */

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h1 style={styles.title}>Projects</h1>
            <p style={styles.subtitle}>
              Build research and written work directly from sources.
            </p>
          </div>

          {projects.length > 0 && (
            <Link href="/projects/new" style={styles.primaryBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              New Project
            </Link>
          )}
        </div>

        {/* Projects */}
        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div style={styles.projectsGrid}>
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}