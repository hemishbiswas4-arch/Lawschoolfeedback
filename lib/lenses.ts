/* ================= LENS TYPES ================= */

export type LensSeverity = "note" | "issue" | "critical"

export type LensDefinition = {
  label: string
  payloadSchema: Record<string, "string">
}

/* ================= LENS REGISTRY ================= */

export const LENS_REGISTRY: Record<
  string,
  Record<string, LensDefinition>
> = {
  moot: {
    issue_framing: {
      label: "Issue Framing",
      payloadSchema: {
        issue: "string",
        problem: "string",
      },
    },
    authority: {
      label: "Authority / Precedent",
      payloadSchema: {
        authority: "string",
        problem: "string",
      },
    },
    application: {
      label: "Application to Facts",
      payloadSchema: {
        gap: "string",
      },
    },
    structure: {
      label: "Structure & Flow",
      payloadSchema: {
        section: "string",
        concern: "string",
      },
    },
  },

  negotiation: {
    interests_positions: {
      label: "Interests vs Positions",
      payloadSchema: {
        party: "string",
        issue: "string",
      },
    },
    batna: {
      label: "BATNA / WATNA",
      payloadSchema: {
        party: "string",
        assessment: "string",
      },
    },
    zopa: {
      label: "ZOPA & Anchoring",
      payloadSchema: {
        anchor: "string",
        risk: "string",
      },
    },
    concessions: {
      label: "Concession Strategy",
      payloadSchema: {
        flaw: "string",
      },
    },
  },

  research: {
    thesis: {
      label: "Thesis & Research Question",
      payloadSchema: {
        problem: "string",
      },
    },
    methodology: {
      label: "Methodology",
      payloadSchema: {
        mismatch: "string",
      },
    },
    literature: {
      label: "Literature Review",
      payloadSchema: {
        missing: "string",
      },
    },
    argument: {
      label: "Argument & Counter-Arguments",
      payloadSchema: {
        weakness: "string",
      },
    },
    citations: {
      label: "Citations & Sources",
      payloadSchema: {
        issue: "string",
      },
    },
  },

  bibliography: {
    relevance: {
      label: "Relevance",
      payloadSchema: {
        reason: "string",
      },
    },
    authority_quality: {
      label: "Authority Quality",
      payloadSchema: {
        concern: "string",
      },
    },
    citation_format: {
      label: "Citation Format",
      payloadSchema: {
        error: "string",
      },
    },
  },

  assignment: {
    question_engagement: {
      label: "Question Engagement",
      payloadSchema: {
        issue: "string",
      },
    },
    structure: {
      label: "Structure & Coherence",
      payloadSchema: {
        concern: "string",
      },
    },
    reasoning: {
      label: "Legal Reasoning",
      payloadSchema: {
        flaw: "string",
      },
    },
    authorities: {
      label: "Use of Authorities",
      payloadSchema: {
        issue: "string",
      },
    },
  },

  draft: {},
}
