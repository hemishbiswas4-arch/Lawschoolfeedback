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
      <div style={{ marginBottom: "16px" }}>
        <Link
          href="/dashboard"
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            background: "#ffffff",
            color: "#374151",
            fontSize: "14px",
            fontWeight: 500,
            textDecoration: "none",
            border: "1px solid #e5e7eb",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#f9fafb"
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#ffffff"
          }}
        >
          ← Back to Dashboard
        </Link>
      </div>
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
