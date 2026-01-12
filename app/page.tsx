"use client"

import Link from "next/link"

export default function Home() {
  const styles = {
    page: {
      minHeight: "100vh",
      backgroundColor: "#ffffff",
      fontFamily: "sans-serif",
      color: "#111",
      display: "flex",
      flexDirection: "column" as const,
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
    main: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px",
    },
    grid: {
      maxWidth: "1000px",
      width: "100%",
      display: "grid",
      gridTemplateColumns: "1.2fr 1fr",
      gap: "60px",
      alignItems: "center",
    },
    h1: {
      fontSize: "3.5rem",
      lineHeight: 1.1,
      marginBottom: "24px",
      fontWeight: 800,
      letterSpacing: "-0.03em",
      color: "#111",
    },
    subtext: {
      fontSize: "1.125rem",
      lineHeight: 1.6,
      color: "#4b5563",
      marginBottom: "32px",
      maxWidth: "90%",
    },
    buttonGroup: {
      display: "flex",
      gap: "12px",
      alignItems: "center",
    },
    primaryBtn: {
      background: "#111",
      color: "#ffffff",
      padding: "12px 24px",
      borderRadius: "8px",
      fontWeight: 500,
      textDecoration: "none",
      fontSize: "15px",
    },
    meta: {
      marginTop: "24px",
      fontSize: "13px",
      color: "#9ca3af",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    },
    betaTag: {
      backgroundColor: "#f3f4f6",
      color: "#4b5563",
      padding: "2px 6px",
      borderRadius: "4px",
      fontWeight: 600,
      fontSize: "11px",
      border: "1px solid #e5e7eb",
    },
    card: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "16px",
      padding: "32px",
    },
    cardText: {
      fontSize: "15px",
      lineHeight: 1.7,
      color: "#374151",
    },
    highlight: {
      color: "#111",
      fontWeight: 600,
    },
  }

  return (
    <div style={styles.page}>
      <nav style={styles.nav}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>P</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <Link
            href="/feedback"
            style={{ fontSize: "14px", fontWeight: 500, color: "#6b7280" }}
          >
            Feedback
          </Link>
          <Link
            href="/login"
            style={{ fontSize: "14px", fontWeight: 500, color: "#6b7280" }}
          >
            Log in
          </Link>
        </div>
      </nav>

      <main style={styles.main}>
        <div style={styles.grid}>
          <div>
            <h1 style={styles.h1}>
              One Pipeline. <br />
              Every Project.
            </h1>

            <p style={styles.subtext}>
              A unified workspace to create, structure, iterate, and manage
              complex academic projects — from conception to final submission.
            </p>

            <div style={styles.buttonGroup}>
              <Link href="/login?next=/projects" style={styles.primaryBtn}>
                Open Project Pipeline
              </Link>
            </div>

            <div style={styles.meta}>
              <span style={styles.betaTag}>BETA v0.1</span>
              <span>Structured academic workflows</span>
              <a
                href="/admin/feedback"
                style={{
                  fontSize: "12px",
                  color: "#9ca3af",
                  textDecoration: "underline",
                  marginLeft: "16px",
                }}
              >
                Admin
              </a>
            </div>
          </div>

          <div style={styles.card}>
            <p style={styles.cardText}>
              The pipeline enables{" "}
              <span style={styles.highlight}>
                structured project generation
              </span>
              , guided iteration, and source-aware drafting.
              <br />
              <br />
              Projects move through defined stages — planning, development,
              refinement — without fragmenting across tools or formats.
              <br />
              <br />
              <span
                style={{
                  fontSize: "13px",
                  color: "#9ca3af",
                  fontStyle: "italic",
                }}
              >
                Designed for high-rigor academic work.
              </span>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
