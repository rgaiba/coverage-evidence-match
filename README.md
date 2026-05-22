# Coverage Evidence Match

**Audit-ready evidence gap analysis for UM Committees.**

A SaaS compliance tool that analyzes the gap between CMS coverage policies (NCD/LCD) and current peer-reviewed literature — structured for physician-led Utilization Management Committees operating under the 2024 Medicare Advantage Final Rule (CMS-4201-F).

**Live:** [rgaiba.github.io/coverage-evidence-match](https://rgaiba.github.io/coverage-evidence-match)

---

## What it does

Enter a procedure or diagnosis. The tool runs a four-stage pipeline:

1. **CMS Coverage** — Identifies the governing NCD or LCD, policy ID, last revision date, and evidence basis
2. **PubMed** — Retrieves peer-reviewed literature published since the policy revision date via NCBI E-utilities
3. **Consensus** — Synthesizes directional evidence (supports expansion / restriction / contradictory / neutral)
4. **Claude** — Generates the structured gap analysis report via `claude-sonnet-4-20250514`

Output is a structured report card with:
- Policy summary and evidence basis
- Literature since revision (linked to PubMed)
- Gap direction badge
- Staleness Score (0–100, color-coded bar)
- Recommended Action badge: Maintain / Reconsider / Escalate
- Key citations with findings

---

## Setup

```bash
npm install
npm run dev
```

You'll need an Anthropic API key. Click **API Key** in the header to enter it — stored in session only.

## Deploy

Push to `main` — GitHub Actions builds and deploys automatically via Pages.

Manual deploy:
```bash
npm run deploy
```

---

## Stack

- React 19 + Vite 8
- Tailwind CSS v4
- NCBI E-utilities (PubMed, public API)
- Anthropic Messages API (`claude-sonnet-4-20250514`)
- GitHub Pages

---

*For UM Committee use only. Not clinical advice.*
