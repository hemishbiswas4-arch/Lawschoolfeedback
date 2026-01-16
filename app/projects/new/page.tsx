"use client"
export const dynamic = "force-dynamic"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import Link from "next/link"

/* ================= PROJECT TYPE CONFIG ================= */
/* 
 * NOTE: If you add new project types here, you MUST also update the database constraint
 * by running scripts/update_project_type_constraint.sql in your Supabase database.
 * 
 * The constraint projects_project_type_check must include all values defined here.
 */

const PROJECT_TYPES = [
  // Academic Research
  { value: "research_paper", label: "Research Paper", description: "Academic research paper with comprehensive analysis and original research" },
  { value: "literature_review", label: "Literature Review", description: "Comprehensive review synthesizing existing scholarship and identifying gaps" },
  { value: "systematic_review", label: "Systematic Review", description: "Systematic review following methodological protocols" },
  { value: "empirical_study", label: "Empirical Study", description: "Research paper based on empirical data and analysis" },
  { value: "theoretical_paper", label: "Theoretical Paper", description: "Paper focused on theoretical frameworks and conceptual analysis" },

  // Case Analysis
  { value: "case_analysis", label: "Case Analysis", description: "Detailed case law analysis and commentary" },
  { value: "case_note", label: "Case Note", description: "Brief analysis of a specific case" },
  { value: "case_comment", label: "Case Comment", description: "Critical commentary on a judicial decision" },

  // Articles & Publications
  { value: "journal_article", label: "Journal Article", description: "Article for academic or legal journal publication" },
  { value: "law_review_article", label: "Law Review Article", description: "Article for law review publication" },
  { value: "book_chapter", label: "Book Chapter", description: "Chapter for edited volume or monograph" },
]

/* ================= DESIGN SYSTEM ================= */

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    fontFamily: "sans-serif",
    color: "#111"
  },
  container: {
    maxWidth: "800px",
    margin: "0 auto",
    padding: "40px 20px"
  },

  // Header
  header: {
    textAlign: "center" as const,
    marginBottom: "40px"
  },
  title: {
    fontSize: "32px",
    fontWeight: 700,
    margin: "0 0 12px 0",
    letterSpacing: "-0.02em",
    color: "#111"
  },
  subtitle: {
    fontSize: "16px",
    color: "#6b7280",
    margin: 0,
    maxWidth: "600px",
    marginLeft: "auto",
    marginRight: "auto"
  },

  // Form Container
  formCard: {
    backgroundColor: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: "16px",
    padding: "40px",
    boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
    marginBottom: "24px"
  },

  // Form Fields
  formGroup: {
    marginBottom: "24px"
  },
  label: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
    marginBottom: "8px",
    display: "block"
  },

  // Select/Input Styling
  select: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    backgroundColor: "#fff",
    color: "#374151",
    cursor: "pointer",
    transition: "all 0.2s",
    boxSizing: "border-box" as const
  },

  input: {
    width: "100%",
    padding: "14px 16px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    backgroundColor: "#fff",
    color: "#374151",
    boxSizing: "border-box" as const,
    transition: "all 0.2s"
  },

  // Description
  description: {
    fontSize: "13px",
    color: "#6b7280",
    marginTop: "8px",
    lineHeight: "1.4"
  },

  // Error
  error: {
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "8px",
    padding: "12px 16px",
    marginBottom: "20px",
    fontSize: "14px",
    color: "#dc2626"
  },

  // Actions
  actions: {
    display: "flex",
    gap: "12px",
    alignItems: "center"
  },

  primaryBtn: {
    backgroundColor: "#111",
    color: "#fff",
    border: "none",
    padding: "14px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
  },

  secondaryBtn: {
    backgroundColor: "#fff",
    color: "#6b7280",
    border: "1px solid #e5e7eb",
    padding: "14px 24px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s"
  },

  // Loading state
  loading: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: '100vh',
    color: '#6b7280',
    fontSize: '14px'
  }
}

export default function NewProjectPage() {
  const router = useRouter()
  const [title, setTitle] = useState("")
  const [projectType, setProjectType] = useState(PROJECT_TYPES[0].value)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createProject = async () => {
    if (!title.trim()) return

    setLoading(true)
    setError(null)

    try {
      const { data: session } = await supabase.auth.getSession()
      const user = session.session?.user

      if (!user) {
        setError("Please log in to create a project")
        setLoading(false)
        router.replace("/login")
        return
      }

      // Validate project type exists in our config
      const validProjectType = PROJECT_TYPES.find(t => t.value === projectType)
      if (!validProjectType) {
        setError(`Invalid project type selected. Please refresh the page and try again.`)
        setLoading(false)
        return
      }

      console.log("Creating project with:", {
        owner_id: user.id,
        title: title.trim(),
        project_type: projectType,
      })

      const { data, error } = await supabase
        .from("projects")
        .insert({
          owner_id: user.id,
          title: title.trim(),
          project_type: projectType,
        })
        .select()
        .single()

      if (error) {
        console.error("Project creation error:", error)

        // Check if it's a constraint violation for project_type
        if (error.code === "23514" || error.message?.includes("projects_project_type_check")) {
          const projectTypeLabel = PROJECT_TYPES.find(t => t.value === projectType)?.label || projectType
          setError(
            `The project type "${projectTypeLabel}" (${projectType}) is not currently supported by the database constraint. ` +
            `This happens when the database hasn't been updated with the latest project types. ` +
            `Please run the migration script: scripts/update_project_type_constraint.sql in your Supabase database, ` +
            `or select a different project type for now.`
          )
        } else {
          // Show more detailed error message for other errors
          const errorMessage = error.message || error.code || "Failed to create project"
          const errorDetails = error.details ? ` (${error.details})` : ""
          const errorHint = error.hint ? ` Hint: ${error.hint}` : ""
          setError(`Failed to create project: ${errorMessage}${errorDetails}${errorHint}`)
        }
        setLoading(false)
        return
      }

      if (!data) {
        setError("Failed to create project: No data returned")
        setLoading(false)
        return
      }

      console.log("Project created successfully:", data.id)
      router.push(`/projects/${data.id}`)
    } catch (err: any) {
      console.error("Unexpected error creating project:", err)
      setError(`Unexpected error: ${err?.message || "Unknown error"}`)
      setLoading(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        {/* Header */}
        <div style={styles.header}>
          <h1 style={styles.title}>Create New Project</h1>
          <p style={styles.subtitle}>
            Start building your research or legal work by selecting a project type and giving it a title.
          </p>
        </div>

        {/* Form */}
        <div style={styles.formCard}>
          {/* Project Type */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "6px" }}>
                <path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10"/>
              </svg>
              Project Type
            </label>

            <select
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              style={styles.select}
              onFocus={(e) => e.target.style.borderColor = "#3b82f6"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
            >
              <optgroup label="Academic Research">
                {PROJECT_TYPES.filter(t =>
                  ["research_paper", "literature_review", "systematic_review", "empirical_study", "theoretical_paper"].includes(t.value)
                ).map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Case Analysis">
                {PROJECT_TYPES.filter(t =>
                  ["case_analysis", "case_note", "case_comment"].includes(t.value)
                ).map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Articles & Publications">
                {PROJECT_TYPES.filter(t =>
                  ["journal_article", "law_review_article", "book_chapter"].includes(t.value)
                ).map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </optgroup>
            </select>

            <div style={styles.description}>
              {PROJECT_TYPES.find((t) => t.value === projectType)?.description}
            </div>
          </div>

          {/* Project Title */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "6px" }}>
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Project Title
            </label>

            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Shareholder Rights in Hostile Takeovers"
              style={styles.input}
              onFocus={(e) => e.target.style.borderColor = "#3b82f6"}
              onBlur={(e) => e.target.style.borderColor = "#d1d5db"}
            />

            <div style={styles.description}>
              Choose a descriptive title that reflects your project's focus and scope.
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div style={styles.error}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "8px", marginTop: "-2px" }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            <button
              onClick={createProject}
              disabled={loading || !title.trim()}
              style={{
                ...styles.primaryBtn,
                opacity: loading || !title.trim() ? 0.6 : 1,
                cursor: loading || !title.trim() ? "not-allowed" : "pointer"
              }}
              onMouseEnter={(e) => {
                if (!loading && title.trim()) {
                  e.currentTarget.style.transform = "translateY(-1px)"
                  e.currentTarget.style.boxShadow = "0 4px 8px rgba(0,0,0,0.12)"
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)"
                e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)"
              }}
            >
              {loading ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25"/>
                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Creating Project…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Create Project
                </>
              )}
            </button>

            <Link href="/projects" style={styles.secondaryBtn}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12,19 5,12 12,5"/>
              </svg>
              Back to Projects
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
