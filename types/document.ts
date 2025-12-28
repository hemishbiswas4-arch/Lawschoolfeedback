// types/document.ts
export type DocumentRole = "owner" | "editor" | "commenter" | "viewer"

export type DocumentAccess = {
  id: string
  title: string
  created_at: string
  owner_id: string
  role: DocumentRole
}
