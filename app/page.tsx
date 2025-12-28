"use client"

import Link from "next/link"

export default function Home() {
  
  /* ================= STYLES ================= */
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
    // Left Column
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
      transition: "opacity 0.2s",
    },
    secondaryBtn: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      color: "#374151",
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
    // Right Column
    card: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "16px",
      padding: "32px",
      boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)",
    },
    cardText: {
      fontSize: "15px",
      lineHeight: 1.7,
      color: "#374151",
    },
    highlight: {
      color: "#111",
      fontWeight: 600,
    }
  }

  return (
    <div style={styles.page}>
      
      {/* NAVBAR */}
      <nav style={styles.nav}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>P</div>
        </div>
        <Link href="/login" style={{ fontSize: "14px", fontWeight: 500, textDecoration: "none", color: "#6b7280" }}>
          Log in
        </Link>
      </nav>

      {/* MAIN CONTENT */}
      <main style={styles.main}>
        <div style={styles.grid}>
          
          {/* LEFT: Hero Content */}
          <div>
            <h1 style={styles.h1}>
              Law School <br />
              Feedback <span style={{ color: "#9ca3af" }}>Reimagined.</span>
            </h1>

            <p style={styles.subtext}>
              A centralized platform for university work — moots, negotiation plans, research papers, and drafts. Move beyond email chains.
            </p>

            <div style={styles.buttonGroup}>
              <Link href="/login" style={styles.primaryBtn}>
                Get Started
              </Link>
              <Link href="/dashboard" style={styles.secondaryBtn}>
                Dashboard
              </Link>
            </div>

            <div style={styles.meta}>
              <span style={styles.betaTag}>BETA v0.1</span>
              <span>University use only</span>
            </div>
          </div>

          {/* RIGHT: Feature Card */}
          <div style={styles.card}>
            {/* Decorative Icon */}
            <div style={{ marginBottom: "20px", width: "40px", height: "40px", borderRadius: "50%", backgroundColor: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #f3f4f6" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </div>

            <p style={styles.cardText}>
              This tool is designed to <span style={styles.highlight}>reduce document sharing over email</span> and messaging platforms.
              <br /><br />
              Feedback is anchored directly to the PDF and can be categorised by work type (e.g., <span style={{ textDecoration: "underline", textDecorationColor: "#d1d5db" }}>moots</span>, <span style={{ textDecoration: "underline", textDecorationColor: "#d1d5db" }}>negotiations</span>).
              <br /><br />
              <span style={{ fontSize: "13px", color: "#9ca3af", fontStyle: "italic" }}>
                The system is currently in active beta and may change based on use and feedback.
              </span>
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}