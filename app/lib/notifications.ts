import { supabase } from "../lib/supabaseClient"

/**
 * Create or re-trigger a notification.
 * All logic lives in DB (SECURITY DEFINER RPC).
 */
export async function createNotification(params: {
  userId: string
  actorId: string
  documentId: string
  documentType: string
  type: string
  message: string
  dedupeKey?: string | null
}): Promise<void> {
  const {
    userId,
    actorId,
    documentId,
    documentType,
    type,
    message,
    dedupeKey,
  } = params

  // never notify self
  if (userId === actorId) return

  await supabase
    .rpc("notify_user", {
      p_user_id: userId,
      p_actor_id: actorId,
      p_document_id: documentId,
      p_document_type: documentType,
      p_type: type,
      p_message: message,
      p_dedupe_key: dedupeKey ?? null,
    })
    .throwOnError()
}

/* ================= SEMANTIC HELPERS ================= */

export function notifyOwnerComment(params: {
  ownerId: string
  actorId: string
  documentId: string
  documentType: string
}): Promise<void> {
  return createNotification({
    userId: params.ownerId,
    actorId: params.actorId,
    documentId: params.documentId,
    documentType: params.documentType,
    type: "comment_added",
    message: "New comment on your document",
    dedupeKey: `comment:${params.documentId}`,
  })
}

export function notifyCollaboratorComment(params: {
  collaboratorId: string
  actorId: string
  documentId: string
  documentType: string
}): Promise<void> {
  return createNotification({
    userId: params.collaboratorId,
    actorId: params.actorId,
    documentId: params.documentId,
    documentType: params.documentType,
    type: "comment_added",
    message: "New comment on a document shared with you",
    dedupeKey: `comment:${params.documentId}`,
  })
}
