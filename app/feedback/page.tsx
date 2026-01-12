"use client"

import { useState } from "react"
import Link from "next/link"

/* ================= COMPONENT ================= */

export default function FeedbackPage() {
  const [formData, setFormData] = useState({
    email: "",
    feedback_text: "",
    rating: 0,
    feedback_type: "general"
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState("")

  const styles = {
    page: {
      minHeight: "100vh",
      backgroundColor: "#ffffff",
      fontFamily: "sans-serif",
      color: "#111",
    },
    nav: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "20px 40px",
      borderBottom: "1px solid #f3f4f6",
    },
    logo: {
      fontWeight: 800,
      fontSize: "20px",
      letterSpacing: "-0.03em",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    logoIcon: {
      width: "28px",
      height: "28px",
      backgroundColor: "#111",
      borderRadius: "6px",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "16px",
      fontWeight: "bold",
    },
    container: {
      maxWidth: "600px",
      margin: "0 auto",
      padding: "60px 40px",
    },
    title: {
      fontSize: "32px",
      fontWeight: 800,
      marginBottom: "8px",
      color: "#111",
    },
    subtitle: {
      fontSize: "16px",
      color: "#6b7280",
      marginBottom: "40px",
      lineHeight: 1.6,
    },
    form: {
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "12px",
      padding: "32px",
    },
    formGroup: {
      marginBottom: "24px",
    },
    label: {
      display: "block",
      fontSize: "14px",
      fontWeight: 600,
      color: "#374151",
      marginBottom: "8px",
    },
    input: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "inherit",
      backgroundColor: "#fff",
    },
    textarea: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "inherit",
      backgroundColor: "#fff",
      minHeight: "120px",
    },
    select: {
      width: "100%",
      padding: "12px 16px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "inherit",
      backgroundColor: "#fff",
    },
    ratingContainer: {
      display: "flex",
      gap: "8px",
      alignItems: "center",
    },
    star: {
      fontSize: "24px",
      cursor: "pointer",
      color: "#d1d5db",
      transition: "color 0.2s",
    },
    starActive: {
      color: "#fbbf24",
    },
    button: {
      backgroundColor: "#111",
      color: "#fff",
      padding: "12px 24px",
      borderRadius: "8px",
      border: "none",
      fontSize: "14px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "background-color 0.2s",
      width: "100%",
    },
    buttonDisabled: {
      backgroundColor: "#9ca3af",
      cursor: "not-allowed",
    },
    successMessage: {
      backgroundColor: "#d1fae5",
      color: "#065f46",
      padding: "16px",
      borderRadius: "8px",
      marginBottom: "24px",
      border: "1px solid #a7f3d0",
    },
    errorMessage: {
      backgroundColor: "#fee2e2",
      color: "#991b1b",
      padding: "16px",
      borderRadius: "8px",
      marginBottom: "24px",
      border: "1px solid #fca5a5",
    },
    backLink: {
      display: "inline-flex",
      alignItems: "center",
      color: "#6b7280",
      textDecoration: "none",
      fontSize: "14px",
      fontWeight: 500,
      marginBottom: "20px",
    },
    required: {
      color: "#dc2626",
      marginLeft: "4px",
    },
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleRatingClick = (rating: number) => {
    setFormData(prev => ({
      ...prev,
      rating: prev.rating === rating ? 0 : rating
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitStatus("idle")
    setErrorMessage("")

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          rating: formData.rating || undefined, // Don't send 0 rating
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSubmitStatus("success")
        setFormData({
          email: "",
          feedback_text: "",
          rating: 0,
          feedback_type: "general"
        })
      } else {
        setSubmitStatus("error")
        setErrorMessage(data.error || "Failed to submit feedback")
      }
    } catch (error) {
      setSubmitStatus("error")
      setErrorMessage("Network error. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <Link href="/" style={styles.logo}>
          <div style={styles.logoIcon}>P</div>
        </Link>
        <Link
          href="/login"
          style={{ fontSize: "14px", fontWeight: 500, color: "#6b7280" }}
        >
          Log in
        </Link>
      </nav>

      <div style={styles.container}>
        <Link href="/" style={styles.backLink}>
          ← Back to Home
        </Link>

        <h1 style={styles.title}>Share Your Feedback</h1>
        <p style={styles.subtitle}>
          Help us improve the Project Pipeline. Your feedback is valuable and helps shape the future of academic workflows.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          {submitStatus === "success" && (
            <div style={styles.successMessage}>
              <strong>Thank you!</strong> Your feedback has been submitted successfully.
            </div>
          )}

          {submitStatus === "error" && (
            <div style={styles.errorMessage}>
              <strong>Error:</strong> {errorMessage}
            </div>
          )}

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Email (optional)
            </label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              placeholder="your.email@example.com"
              style={styles.input}
            />
            <div style={{ fontSize: "12px", color: "#9ca3af", marginTop: "4px" }}>
              We'll only use this to follow up if needed
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Feedback Type
            </label>
            <select
              name="feedback_type"
              value={formData.feedback_type}
              onChange={handleInputChange}
              style={styles.select}
            >
              <option value="general">General Feedback</option>
              <option value="bug">Bug Report</option>
              <option value="feature">Feature Request</option>
              <option value="ui">User Interface</option>
              <option value="performance">Performance</option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Rating (optional)
            </label>
            <div style={styles.ratingContainer}>
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  onClick={() => handleRatingClick(star)}
                  style={{
                    ...styles.star,
                    ...(formData.rating >= star ? styles.starActive : {})
                  }}
                >
                  ★
                </span>
              ))}
              <span style={{ fontSize: "14px", color: "#9ca3af", marginLeft: "8px" }}>
                {formData.rating > 0 ? `${formData.rating} star${formData.rating > 1 ? 's' : ''}` : 'Click to rate'}
              </span>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              Your Feedback
              <span style={styles.required}>*</span>
            </label>
            <textarea
              name="feedback_text"
              value={formData.feedback_text}
              onChange={handleInputChange}
              placeholder="Tell us what you think, what works well, what could be improved..."
              required
              style={styles.textarea}
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !formData.feedback_text.trim()}
            style={{
              ...styles.button,
              ...(isSubmitting || !formData.feedback_text.trim() ? styles.buttonDisabled : {})
            }}
          >
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </form>
      </div>
    </div>
  )
}