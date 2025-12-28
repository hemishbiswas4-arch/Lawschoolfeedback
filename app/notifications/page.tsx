"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import Link from "next/link"

type Notification = {
  id: string
  message: string
  document_id: string | null
  is_read: boolean
  created_at: string
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setNotifications(data ?? []))
  }, [])

  const markAsRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)

    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, is_read: true } : n
      )
    )
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "600px" }}>
      <h1>Notifications</h1>

      {notifications.length === 0 && <p>No notifications.</p>}

      <ul>
        {notifications.map((n) => (
          <li key={n.id} style={{ marginBottom: "1rem" }}>
            <div style={{ fontWeight: n.is_read ? "normal" : "bold" }}>
              {n.message}
            </div>

            {n.document_id && (
              <Link href={`/doc/${n.document_id}`}>
                View document
              </Link>
            )}

            {!n.is_read && (
              <button
                onClick={() => markAsRead(n.id)}
                style={{ marginLeft: "0.5rem" }}
              >
                Mark read
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
