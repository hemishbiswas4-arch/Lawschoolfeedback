// @/app/projects/new/page.tsx
"use client"
export const dynamic = "force-dynamic"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"

/* ================= PROJECT TYPE CONFIG ================= */

const PROJECT_TYPES = [
  // Academic Research
  { value: "research_paper", label: "Research Paper", description: "Academic research paper with comprehensive analysis and original research" },
  { value: "literature_review", label: "Literature Review", description: "Comprehensive review synthesizing existing scholarship and identifying gaps" },
  { value: "systematic_review", label: "Systematic Review", description: "Systematic review following methodological protocols" },
  { value: "empirical_study", label: "Empirical Study", description: "Research paper based on empirical data and analysis" },
  { value: "theoretical_paper", label: "Theoretical Paper", description: "Paper focused on theoretical frameworks and conceptual analysis" },
  
  // Legal Documents
  { value: "legal_brief", label: "Legal Brief", description: "Formal legal brief or memorandum for court proceedings" },
  { value: "motion_brief", label: "Motion Brief", description: "Brief supporting or opposing a motion" },
  { value: "appellate_brief", label: "Appellate Brief", description: "Brief for appellate court proceedings" },
  { value: "legal_memorandum", label: "Legal Memorandum", description: "Internal legal memorandum analyzing legal issues" },
  { value: "client_opinion", label: "Client Opinion Letter", description: "Legal opinion letter for client advice" },
  
  // Case Analysis
  { value: "case_analysis", label: "Case Analysis", description: "Detailed case law analysis and commentary" },
  { value: "case_note", label: "Case Note", description: "Brief analysis of a specific case" },
  { value: "case_comment", label: "Case Comment", description: "Critical commentary on a judicial decision" },
  { value: "comparative_case_study", label: "Comparative Case Study", description: "Comparative analysis across multiple cases or jurisdictions" },
  
  // Policy & Reform
  { value: "policy_analysis", label: "Policy Analysis", description: "Policy evaluation examining implications and alternatives" },
  { value: "law_reform_paper", label: "Law Reform Paper", description: "Paper proposing legal reforms with policy recommendations" },
  { value: "regulatory_analysis", label: "Regulatory Analysis", description: "Analysis of regulatory frameworks and compliance" },
  { value: "impact_assessment", label: "Impact Assessment", description: "Assessment of legal or policy impacts" },
  
  // Extended Academic Work
  { value: "thesis", label: "Thesis / Dissertation", description: "Extended academic work with deep analysis and original contributions" },
  { value: "dissertation", label: "Dissertation", description: "Doctoral-level extended research work" },
  { value: "masters_thesis", label: "Master's Thesis", description: "Master's level extended research work" },
  { value: "capstone_project", label: "Capstone Project", description: "Capstone project integrating coursework and research" },
  
  // Articles & Publications
  { value: "journal_article", label: "Journal Article", description: "Article for academic or legal journal publication" },
  { value: "law_review_article", label: "Law Review Article", description: "Article for law review publication" },
  { value: "opinion_piece", label: "Opinion Piece", description: "Opinion piece or editorial" },
  { value: "book_chapter", label: "Book Chapter", description: "Chapter for edited volume or monograph" },
  
  // Practice-Oriented
  { value: "practice_guide", label: "Practice Guide", description: "Guide for legal practitioners" },
  { value: "compliance_manual", label: "Compliance Manual", description: "Manual for regulatory compliance" },
  { value: "training_material", label: "Training Material", description: "Educational or training material" },
  
  // Other
  { value: "other", label: "Other", description: "Custom project type" },
]

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
        // Show more detailed error message
        const errorMessage = error.message || error.code || "Failed to create project"
        const errorDetails = error.details ? ` (${error.details})` : ""
        const errorHint = error.hint ? ` Hint: ${error.hint}` : ""
        setError(`Failed to create project: ${errorMessage}${errorDetails}${errorHint}`)
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
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "60px 20px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 700, marginBottom: "12px" }}>
          New Project
        </h1>

        <p style={{ fontSize: "14px", color: "#6b7280", marginBottom: "32px" }}>
          Create a project to begin building work from sources.
        </p>

        <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
          Project Type
        </label>

        <select
          value={projectType}
          onChange={(e) => setProjectType(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "20px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            fontSize: "14px",
            background: "#fff",
          }}
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
          <optgroup label="Legal Documents">
            {PROJECT_TYPES.filter(t => 
              ["legal_brief", "motion_brief", "appellate_brief", "legal_memorandum", "client_opinion"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Case Analysis">
            {PROJECT_TYPES.filter(t => 
              ["case_analysis", "case_note", "case_comment", "comparative_case_study"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Policy & Reform">
            {PROJECT_TYPES.filter(t => 
              ["policy_analysis", "law_reform_paper", "regulatory_analysis", "impact_assessment"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Extended Academic Work">
            {PROJECT_TYPES.filter(t => 
              ["thesis", "dissertation", "masters_thesis", "capstone_project"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Articles & Publications">
            {PROJECT_TYPES.filter(t => 
              ["journal_article", "law_review_article", "opinion_piece", "book_chapter"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Practice-Oriented">
            {PROJECT_TYPES.filter(t => 
              ["practice_guide", "compliance_manual", "training_material"].includes(t.value)
            ).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other">
            {PROJECT_TYPES.filter(t => t.value === "other").map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </optgroup>
        </select>

        <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "-16px", marginBottom: "20px" }}>
          {PROJECT_TYPES.find((t) => t.value === projectType)?.description}
        </div>

        <label style={{ fontSize: "13px", fontWeight: 600, display: "block", marginBottom: "8px" }}>
          Project Title
        </label>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Shareholder Rights in Hostile Takeovers"
          style={{
            width: "100%",
            padding: "12px",
            marginTop: "8px",
            marginBottom: "20px",
            borderRadius: "8px",
            border: "1px solid #d1d5db",
            fontSize: "14px",
          }}
        />

        {error && (
          <div style={{ color: "#b91c1c", fontSize: "13px", marginBottom: "12px" }}>
            {error}
          </div>
        )}

        <button
          onClick={createProject}
          disabled={loading || !title.trim()}
          style={{
            background: "#111",
            color: "#fff",
            padding: "12px 20px",
            borderRadius: "8px",
            border: "none",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            opacity: loading || !title.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "Creating…" : "Create Project"}
        </button>
      </div>
    </div>
  )
}
