"use client"

import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { usePathname } from "next/navigation"

/* ================= TYPES ================= */

type DocumentType =
  | "moot"
  | "negotiation"
  | "research"
  | "bibliography"
  | "assignment"
  | "draft"

type DocumentRow = {
  id: string
  title: string
  created_at: string
  owner_id: string
  document_type: DocumentType
}

type Collaborator = {
  id: string
  user_id: string
  role: "owner" | "viewer" | "commenter"
  email: string | null
}

type UserProfile = {
  id: string
  email: string
}

/* ================= CONSTANTS ================= */

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  moot: "Moot",
  negotiation: "Negotiation",
  research: "Research",
  bibliography: "Bibliography",
  assignment: "Assignment",
  draft: "Draft",
}

const DOCUMENT_TYPE_ORDER: (DocumentType | "all")[] = [
  "all",
  "moot",
  "negotiation",
  "research",
  "bibliography",
  "assignment",
  "draft",
]

/* ================= STYLES (Design System) ================= */

const styles = {
  page: { minHeight: "100vh", backgroundColor: "#f9fafb", fontFamily: "sans-serif", color: "#111" },
  container: { maxWidth: "1000px", margin: "0 auto", padding: "40px 20px" },
  
  // Header
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" },
  title: { fontSize: "24px", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" },
  headerActions: { display: "flex", gap: "12px" },
  
  // Buttons
  primaryBtn: { backgroundColor: "#111", color: "#fff", border: "none", padding: "10px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" },
  secondaryBtn: { backgroundColor: "#fff", color: "#374151", border: "1px solid #e5e7eb", padding: "10px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: 500, cursor: "pointer" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#6b7280" },
  
  // Tabs/Filters
  filterScroll: { display: "flex", gap: "8px", overflowX: "auto" as const, paddingBottom: "4px", marginBottom: "24px", borderBottom: "1px solid #e5e7eb" },
  filterTab: (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: "20px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    backgroundColor: active ? "#111" : "transparent",
    color: active ? "#fff" : "#6b7280",
    border: "none",
    transition: "all 0.2s"
  }),

  // Sections
  sectionTitle: { fontSize: "14px", fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: "16px", marginTop: "32px" },
  
  // Card/List
  listContainer: { backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "8px", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" },
  listItem: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f3f4f6", transition: "background 0.2s" },
  itemContent: { display: "flex", alignItems: "center", gap: "16px", flex: 1 },
  itemMeta: { display: "flex", flexDirection: "column" as const, gap: "4px" },
  itemTitle: { fontSize: "15px", fontWeight: 500, color: "#111", margin: 0, cursor: "pointer" },
  itemDate: { fontSize: "12px", color: "#9ca3af" },
  
  // Badges
  typeBadge: (type: string) => {
    const colors: Record<string, string> = {
      moot: "#dbeafe", negotiation: "#fef3c7", research: "#e0e7ff", 
      bibliography: "#fce7f3", assignment: "#d1fae5", draft: "#f3f4f6"
    }
    const textColors: Record<string, string> = {
      moot: "#1e40af", negotiation: "#92400e", research: "#3730a3", 
      bibliography: "#9d174d", assignment: "#065f46", draft: "#374151"
    }
    return {
      fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
      backgroundColor: colors[type] || "#f3f4f6",
      color: textColors[type] || "#374151",
      textTransform: "capitalize" as const
    }
  },
  
  // Modal
  modalOverlay: { position: "fixed" as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
  modalContent: { width: "450px", backgroundColor: "#fff", borderRadius: "12px", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" },
  input: { width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px", marginTop: "8px", boxSizing: "border-box" as const },
  select: { padding: "10px", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "14px", marginRight: "8px" },
  
  // Notification
  unreadDot: { width: "8px", height: "8px", backgroundColor: "#ef4444", borderRadius: "50%", display: "inline-block", marginRight: "8px" },
  markReadBtn: { fontSize: "11px", color: "#ef4444", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }
}

/* ================= PAGE ================= */

export default function DashboardPage() {
  const router = useRouter()
  const pathname = usePathname()


  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const [ownedDocs, setOwnedDocs] = useState<DocumentRow[]>([])
  const [sharedDocs, setSharedDocs] = useState<DocumentRow[]>([])

  const [activeFilter, setActiveFilter] =
    useState<DocumentType | "all">("all")

  /* ---- Manage Access ---- */
  const [activeDoc, setActiveDoc] = useState<DocumentRow | null>(null)
  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [collabLoading, setCollabLoading] = useState(false)

  const [allUsers, setAllUsers] = useState<UserProfile[]>([])
  const [userSearch, setUserSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedRole, setSelectedRole] =
    useState<"viewer" | "commenter">("viewer")
  const [shareLoading, setShareLoading] = useState(false)

  /* ---- DOCUMENT-SCOPED NOTIFICATIONS ---- */
  const [unreadByDoc, setUnreadByDoc] = useState<Record<string, boolean>>({})

  /* ================= INITIAL LOAD ================= */

  useEffect(() => {
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData.session?.user
      if (!user) {
        router.replace("/login")
        return
      }

      setCurrentUserId(user.id)

      /* ---- OWNED ---- */
      const { data: owned } = await supabase
        .from("documents")
        .select("id, title, created_at, owner_id, document_type")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })

      const ownedList = owned ?? []
      setOwnedDocs(ownedList)
      const ownedIds = ownedList.map((d) => d.id)

      /* ---- SHARED ---- */
      const { data: shareRows } = await supabase
        .from("document_shares")
        .select("document_id")
        .eq("shared_with", user.id)

      const sharedIds =
        shareRows
          ?.map((r) => r.document_id)
          .filter((id) => !ownedIds.includes(id)) ?? []

      if (sharedIds.length > 0) {
        const { data: shared } = await supabase
          .from("documents")
          .select("id, title, created_at, owner_id, document_type")
          .in("id", sharedIds)

        setSharedDocs(shared ?? [])
      } else {
        setSharedDocs([])
      }

      /* ---- USERS ---- */
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email")
        .order("email")

      setAllUsers(profiles ?? [])

      /* ---- UNREAD NOTIFICATIONS (DOCUMENT ONLY) ---- */
      const { data: notifs } = await supabase
        .from("notifications")
        .select("document_id")
        .eq("user_id", user.id)
        .eq("is_read", false)
        .in("notification_type", ["comment_added", "comment_reply"])
        .not("document_id", "is", null)


      const map: Record<string, boolean> = {}
      notifs?.forEach((n) => {
        if (n.document_id) map[n.document_id] = true
      })

      setUnreadByDoc(map)
      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    const refreshUnread = async () => {
      if (!currentUserId) return

      const { data: notifs } = await supabase
        .from("notifications")
        .select("document_id")
        .eq("user_id", currentUserId)
        .eq("is_read", false)
        .in("notification_type", ["comment_added", "comment_reply"])
        .not("document_id", "is", null)


      const map: Record<string, boolean> = {}
      notifs?.forEach((n) => {
        if (n.document_id) map[n.document_id] = true
      })

      setUnreadByDoc(map)
    }

    refreshUnread()
  }, [pathname, currentUserId])


  /* ================= FILTERING ================= */

  const filterDocs = (docs: DocumentRow[]) =>
    activeFilter === "all"
      ? docs
      : docs.filter((d) => d.document_type === activeFilter)

  const filteredOwnedDocs = useMemo(
    () => filterDocs(ownedDocs),
    [ownedDocs, activeFilter]
  )

  const filteredSharedDocs = useMemo(
    () => filterDocs(sharedDocs),
    [sharedDocs, activeFilter]
  )

  /* ================= COLLABORATORS ================= */

  const loadCollaborators = async (doc: DocumentRow) => {
    setActiveDoc(doc)
    setCollabLoading(true)
    setCollaborators([])
    setUserSearch("")
    setSelectedUserId("")

    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("id", doc.owner_id)
      .single()

    const ownerEntry: Collaborator = {
      id: `owner-${doc.owner_id}`,
      user_id: doc.owner_id,
      role: "owner",
      email: ownerProfile?.email ?? "Owner",
    }

    const { data: shares } = await supabase
      .from("document_shares")
      .select("id, role, shared_with")
      .eq("document_id", doc.id)

    const userIds = shares
      ?.map((s) => s.shared_with)
      .filter((id) => id !== doc.owner_id) ?? []

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds)

    const sharedEntries: Collaborator[] =
      shares
        ?.filter((s) => s.shared_with !== doc.owner_id)
        .map((s) => ({
          id: s.id,
          user_id: s.shared_with,
          role: s.role,
          email: profiles?.find((p) => p.id === s.shared_with)?.email ?? null,
        })) ?? []

    setCollaborators([ownerEntry, ...sharedEntries])
    setCollabLoading(false)
  }

  /* ================= SHARE / REVOKE ================= */

  const shareWithUser = async () => {
    if (!activeDoc || !selectedUserId || shareLoading) return
    setShareLoading(true)

    const { error } = await supabase.from("document_shares").insert({
      document_id: activeDoc.id,
      shared_with: selectedUserId,
      role: selectedRole,
    })

    if (!error) {
      setSelectedUserId("")
      setUserSearch("")
      await loadCollaborators(activeDoc)
    }

    setShareLoading(false)
  }

  const revokeAccess = async (collab: Collaborator) => {
    if (collab.role === "owner") return
    await supabase.from("document_shares").delete().eq("id", collab.id)
    setCollaborators((prev) => prev.filter((c) => c.id !== collab.id))
  }

  /* ================= OPEN DOC + CLEAR DOT ================= */

  const openDocument = async (doc: DocumentRow) => {
    if (currentUserId) {
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", currentUserId)
        .eq("document_id", doc.id)
        .in("notification_type", ["comment_added", "comment_reply"])
        .eq("is_read", false)
    }

    setUnreadByDoc((prev) => {
      const copy = { ...prev }
      delete copy[doc.id]
      return copy
    })

    router.push(`/doc/${doc.id}`)
  }

  /* ================= LOGOUT ================= */

  const logout = async () => {
    await supabase.auth.signOut()
    router.replace("/login")
  }

  /* ================= RENDER HELPERS ================= */

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#666' }}>
      Loading dashboard...
    </div>
  )

  const DocList = ({ docs }: { docs: DocumentRow[] }) => {
    if (docs.length === 0) {
      return (
        <div style={{ padding: "30px", textAlign: "center", color: "#6b7280", backgroundColor: "#fff", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
          No documents found.
        </div>
      )
    }
    return (
      <div style={styles.listContainer}>
        {docs.map((doc) => (
          <div key={doc.id} style={styles.listItem}>
            <div style={styles.itemContent}>
              <div 
                onClick={() => openDocument(doc)}
                style={{
                  width: "40px", 
                  height: "40px", 
                  backgroundColor: "#f3f4f6", 
                  borderRadius: "6px", 
                  display: "flex", 
                  alignItems: "center", 
                  justifyContent: "center",
                  cursor: "pointer"
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              </div>
              <div style={styles.itemMeta}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <h4 
                    onClick={() => openDocument(doc)}
                    style={styles.itemTitle}
                  >
                    {doc.title}
                  </h4>
                  <span style={styles.typeBadge(doc.document_type)}>
                    {DOCUMENT_TYPE_LABELS[doc.document_type]}
                  </span>
                  {unreadByDoc[doc.id] && (
                     <div title="Unread activity" style={styles.unreadDot}></div>
                  )}
                </div>
                <span style={styles.itemDate}>
                  Created {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {unreadByDoc[doc.id] && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!currentUserId) return
                    await supabase
                      .from("notifications")
                      .update({ is_read: true })
                      .eq("user_id", currentUserId)
                      .eq("document_id", doc.id)
                      .in("notification_type", ["comment_added", "comment_reply"])
                      .eq("is_read", false)

                    setUnreadByDoc((prev) => {
                      const copy = { ...prev }
                      delete copy[doc.id]
                      return copy
                    })
                  }}
                  style={styles.markReadBtn}
                >
                  Mark Read
                </button>
              )}
              
              <button
                style={styles.iconBtn}
                onClick={() => loadCollaborators(doc)}
                title="Manage Access"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              </button>
              
              <button
                 onClick={() => openDocument(doc)}
                 style={styles.iconBtn}
                 title="Open Document"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    )
  }

  /* ================= RENDER MAIN ================= */

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        
        {/* HEADER */}
        <div style={styles.header}>
          <h1 style={styles.title}>Dashboard</h1>
          <div style={styles.headerActions}>
            <button
              onClick={() => router.push("/upload")}
              style={styles.primaryBtn}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              New Document
            </button>
            <button onClick={logout} style={styles.secondaryBtn}>Logout</button>
          </div>
        </div>

        {/* FILTERS */}
        <div style={styles.filterScroll}>
          {DOCUMENT_TYPE_ORDER.map((t) => (
            <button
              key={t}
              onClick={() => setActiveFilter(t)}
              style={styles.filterTab(activeFilter === t)}
            >
              {t === "all" ? "All Documents" : DOCUMENT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* OWNED DOCUMENTS */}
        <div style={styles.sectionTitle}>My Documents</div>
        <DocList docs={filteredOwnedDocs} />

        {/* SHARED DOCUMENTS */}
        {filteredSharedDocs.length > 0 && (
          <>
             <div style={styles.sectionTitle}>Shared With Me</div>
             <DocList docs={filteredSharedDocs} />
          </>
        )}
      </div>

      {/* ACCESS MODAL */}
      {activeDoc && (
        <div style={styles.modalOverlay} onClick={() => setActiveDoc(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
               <h3 style={{ margin: 0, fontSize: "18px" }}>Share "{activeDoc.title}"</h3>
               <button onClick={() => setActiveDoc(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "20px" }}>&times;</button>
            </div>

            {/* SEARCH */}
            <div style={{ marginBottom: "20px", position: "relative" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>INVITE USER</div>
              <input
                placeholder="Search user email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={styles.input}
              />
              
              {userSearch && !selectedUserId && (
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "6px", boxShadow: "0 4px 10px rgba(0,0,0,0.1)", zIndex: 10, maxHeight: "200px", overflowY: "auto" }}>
                  {allUsers
                    .filter(
                      (u) =>
                        u.id !== currentUserId &&
                        !collaborators.some((c) => c.user_id === u.id) &&
                        u.email.toLowerCase().includes(userSearch.toLowerCase())
                    )
                    .map((u) => (
                      <div 
                        key={u.id}
                        onClick={() => {
                          setSelectedUserId(u.id)
                          setUserSearch(u.email)
                        }}
                        style={{ padding: "10px", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = "#f9fafb"}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = "white"}
                      >
                        {u.email}
                      </div>
                    ))}
                    {allUsers.filter(u => u.email.includes(userSearch)).length === 0 && (
                      <div style={{ padding: "10px", color: "#999", fontSize: "13px" }}>No users found</div>
                    )}
                </div>
              )}

              <div style={{ display: "flex", marginTop: "10px", gap: "8px" }}>
                <select
                  value={selectedRole}
                  onChange={(e) =>
                    setSelectedRole(e.target.value as "viewer" | "commenter")
                  }
                  style={{ ...styles.select, flex: 1 }}
                >
                  <option value="viewer">Viewer (Read only)</option>
                  <option value="commenter">Commenter</option>
                </select>

                <button
                  onClick={shareWithUser}
                  disabled={!selectedUserId || shareLoading}
                  style={{ ...styles.primaryBtn, opacity: (!selectedUserId || shareLoading) ? 0.5 : 1 }}
                >
                  {shareLoading ? "Inviting..." : "Invite"}
                </button>
              </div>
            </div>

            <div style={{ height: "1px", backgroundColor: "#e5e7eb", margin: "20px 0" }}></div>

            {/* LIST */}
            <div>
              <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "12px" }}>WHO HAS ACCESS</div>
              {collabLoading ? (
                <p style={{ color: "#666", fontSize: "14px" }}>Loading...</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {collaborators.map((c) => (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                         <div style={{ width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: "bold" }}>
                           {c.email?.charAt(0).toUpperCase()}
                         </div>
                         <div>
                           <div style={{ color: "#111" }}>{c.email}</div>
                           <div style={{ fontSize: "11px", color: "#6b7280" }}>{c.role === "owner" ? "Owner" : c.role}</div>
                         </div>
                      </div>
                      
                      {c.role !== "owner" && (
                        <button
                          onClick={() => revokeAccess(c)}
                          style={{ color: "#ef4444", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}