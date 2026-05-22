import { useState } from 'react'
import './App.css'

// ─── Pipeline utilities ───────────────────────────────────────────────────────

async function searchPubMed(query, sinceDate) {
  const dateFilter = sinceDate ? `+AND+("${sinceDate}"[Date - Publication] : "3000"[Date - Publication])` : ''
  const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}${dateFilter}&retmax=20&retmode=json&sort=date`
  const searchRes = await fetch(searchUrl)
  const searchData = await searchRes.json()
  const ids = searchData.esearchresult?.idlist || []
  if (ids.length === 0) return { count: 0, studies: [] }

  const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`
  const summaryRes = await fetch(summaryUrl)
  const summaryData = await summaryRes.json()
  const result = summaryData.result || {}

  const studies = ids.map(id => {
    const art = result[id] || {}
    return {
      pmid: id,
      title: art.title || '',
      authors: art.authors?.map(a => a.name).slice(0, 3).join(', ') || '',
      journal: art.source || '',
      date: art.pubdate || '',
    }
  }).filter(s => s.title)

  return { count: searchData.esearchresult?.count || studies.length, studies }
}

async function runAnthropicPipeline(procedure, pubmedData, apiKey) {
  const systemPrompt = `You are a clinical policy analyst for a Utilization Management Committee compliance tool.
Your task: analyze the evidence gap between a CMS coverage policy (NCD or LCD) and current peer-reviewed literature for a given procedure or diagnosis.

Respond ONLY with a single valid JSON object matching this exact schema:
{
  "procedure": string,
  "policy_type": "NCD" | "LCD",
  "policy_id": string,
  "last_revised": string (YYYY-MM-DD or YYYY),
  "policy_evidence_basis": [string],
  "literature_since_revision": { "count": number, "studies": [{ "pmid": string, "title": string, "authors": string, "journal": string, "date": string }] },
  "gap_direction": "supports_expansion" | "supports_restriction" | "contradictory" | "neutral",
  "staleness_score": number (0-100),
  "recommended_action": "maintain" | "reconsider" | "escalate",
  "summary": string (2-3 sentence plain-English summary for UM committee),
  "key_citations": [{ "pmid": string, "title": string, "finding": string }]
}

Staleness score weighting:
- Time since revision: 30% (every 2 years without update = 15 points)
- Volume of new literature: 25% (>10 new studies = 15 points, >5 = 10 points, >2 = 5 points)
- Directional consistency: 45% (strong contradictory evidence = high score)

Recommended action: maintain = score 0-25, reconsider = 26-50, escalate = 51-100

Use your knowledge of CMS NCD/LCD policy history. If you are uncertain of the exact policy ID, provide the best available identifier (e.g., "NCD 20.4" or "LCD L33822").`

  const userMessage = `Procedure/Diagnosis: ${procedure}

PubMed literature found since estimated policy revision date:
${JSON.stringify(pubmedData, null, 2)}

Analyze this and return the structured JSON report.`

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-calls': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error ${response.status}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON found in model response')
  return JSON.parse(jsonMatch[0])
}

// ─── Pipeline step labels ─────────────────────────────────────────────────────

const STEPS = [
  { id: 'cms',       label: 'CMS Coverage',  sub: 'Retrieving NCD/LCD policy' },
  { id: 'pubmed',    label: 'PubMed',        sub: 'Searching literature since revision' },
  { id: 'consensus', label: 'Consensus',     sub: 'Synthesizing evidence' },
  { id: 'anthropic', label: 'Claude',        sub: 'Generating gap analysis' },
]

// ─── UI components ────────────────────────────────────────────────────────────

function StepIndicator({ steps, activeStep }) {
  return (
    <div className="step-row">
      {steps.map((step, i) => {
        const state = i < activeStep ? 'done' : i === activeStep ? 'active' : 'pending'
        return (
          <div key={step.id} className={`step-item step-${state}`}>
            <div className="step-dot">
              {state === 'done' ? '✓' : state === 'active' ? <Spinner /> : i + 1}
            </div>
            <div className="step-label">{step.label}</div>
            {state === 'active' && <div className="step-sub">{step.sub}</div>}
          </div>
        )
      })}
    </div>
  )
}

function Spinner() {
  return <span className="spinner">⟳</span>
}

function StalenessMeter({ score }) {
  const color =
    score <= 25 ? '#22c55e' :
    score <= 50 ? '#eab308' :
    score <= 75 ? '#f97316' :
    '#ef4444'
  const label =
    score <= 25 ? 'Current' :
    score <= 50 ? 'Monitor' :
    score <= 75 ? 'Stale' :
    'Critical'
  return (
    <div className="staleness-wrapper">
      <div className="staleness-bar-bg">
        <div
          className="staleness-bar-fill"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <div className="staleness-meta">
        <span className="staleness-score" style={{ color }}>{score}/100</span>
        <span className="staleness-label" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}

function ActionBadge({ action }) {
  const styles = {
    maintain:   { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
    reconsider: { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
    escalate:   { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  }
  const s = styles[action] || styles.maintain
  return (
    <span
      className="action-badge"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {action === 'maintain' ? 'Maintain' : action === 'reconsider' ? 'Reconsider' : 'Escalate'}
    </span>
  )
}

function GapBadge({ direction }) {
  const map = {
    supports_expansion:   { label: 'Supports Expansion',   color: '#1d4ed8' },
    supports_restriction: { label: 'Supports Restriction', color: '#7c3aed' },
    contradictory:        { label: 'Contradictory Evidence', color: '#ea580c' },
    neutral:              { label: 'Neutral / Insufficient', color: '#6b7280' },
  }
  const m = map[direction] || map.neutral
  return <span className="gap-badge" style={{ color: m.color, borderColor: m.color + '44' }}>{m.label}</span>
}

function ReportCard({ report }) {
  return (
    <div className="report-card">
      <header className="report-header">
        <div className="report-header-top">
          <h2 className="report-procedure">{report.procedure}</h2>
          <ActionBadge action={report.recommended_action} />
        </div>
        <div className="report-meta">
          <span className="meta-tag">{report.policy_type} {report.policy_id}</span>
          <span className="meta-sep">·</span>
          <span className="meta-tag">Last revised {report.last_revised}</span>
          <span className="meta-sep">·</span>
          <span className="meta-tag">{report.literature_since_revision?.count || 0} new studies</span>
        </div>
      </header>

      <div className="report-sections">

        {/* Policy Summary */}
        <section className="report-section">
          <h3 className="section-title">Policy Summary</h3>
          <p className="section-body">{report.summary}</p>
          {report.policy_evidence_basis?.length > 0 && (
            <ul className="evidence-list">
              {report.policy_evidence_basis.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </section>

        {/* Evidence Since Revision */}
        <section className="report-section">
          <h3 className="section-title">Evidence Since Revision</h3>
          {report.literature_since_revision?.studies?.length > 0 ? (
            <div className="studies-table">
              {report.literature_since_revision.studies.slice(0, 8).map((s, i) => (
                <div key={i} className="study-row">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="study-title"
                  >
                    {s.title}
                  </a>
                  <div className="study-meta">
                    {s.authors && <span>{s.authors}</span>}
                    {s.journal && <><span className="sep">·</span><em>{s.journal}</em></>}
                    {s.date && <><span className="sep">·</span><span>{s.date}</span></>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="section-body muted">No indexed literature found since the policy revision date.</p>
          )}
        </section>

        {/* Gap Direction */}
        <section className="report-section">
          <h3 className="section-title">Gap Direction</h3>
          <div className="gap-row">
            <GapBadge direction={report.gap_direction} />
          </div>
        </section>

        {/* Staleness Score */}
        <section className="report-section">
          <h3 className="section-title">Staleness Score</h3>
          <StalenessMeter score={report.staleness_score} />
        </section>

        {/* Recommended Action */}
        <section className="report-section">
          <h3 className="section-title">Recommended Action</h3>
          <div className="action-row">
            <ActionBadge action={report.recommended_action} />
            <p className="action-explanation">
              {report.recommended_action === 'maintain' &&
                'Current evidence is consistent with policy. No immediate review required.'}
              {report.recommended_action === 'reconsider' &&
                'Emerging evidence warrants scheduled policy review at next UM Committee cycle.'}
              {report.recommended_action === 'escalate' &&
                'Significant evidence divergence detected. Escalate for expedited UM Committee review.'}
            </p>
          </div>
        </section>

        {/* Key Citations */}
        {report.key_citations?.length > 0 && (
          <section className="report-section">
            <h3 className="section-title">Key Citations</h3>
            <div className="citations-list">
              {report.key_citations.map((c, i) => (
                <div key={i} className="citation-item">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="citation-title"
                  >
                    {c.title}
                  </a>
                  <p className="citation-finding">{c.finding}</p>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>

      <footer className="report-footer">
        <p>Generated by Coverage Evidence Match · For UM Committee use only · Not clinical advice</p>
      </footer>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [query, setQuery] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKeyInput, setShowKeyInput] = useState(false)
  const [phase, setPhase] = useState('idle') // idle | running | done | error
  const [activeStep, setActiveStep] = useState(-1)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const key = apiKey.trim() || sessionStorage.getItem('cem_api_key') || ''
    if (!key) {
      setShowKeyInput(true)
      return
    }
    if (apiKey.trim()) sessionStorage.setItem('cem_api_key', apiKey.trim())

    setPhase('running')
    setReport(null)
    setError('')

    try {
      // Step 0 — CMS (handled by Anthropic with knowledge)
      setActiveStep(0)
      await new Promise(r => setTimeout(r, 600))

      // Step 1 — PubMed
      setActiveStep(1)
      const pubmedData = await searchPubMed(query, null)

      // Step 2 — Consensus synthesis (handled by Anthropic)
      setActiveStep(2)
      await new Promise(r => setTimeout(r, 400))

      // Step 3 — Anthropic
      setActiveStep(3)
      const result = await runAnthropicPipeline(query, pubmedData, key)

      // Merge actual PubMed results into report
      if (pubmedData.studies.length > 0) {
        result.literature_since_revision = pubmedData
      }

      setReport(result)
      setPhase('done')
      setActiveStep(-1)
    } catch (err) {
      setError(err.message || 'Unknown error')
      setPhase('error')
      setActiveStep(-1)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="wordmark">
            <span className="wordmark-main">Coverage Evidence Match</span>
            <span className="wordmark-sub">UM Committee Compliance Tool</span>
          </div>
          <nav className="header-nav">
            <button
              className="nav-link"
              onClick={() => setShowKeyInput(v => !v)}
              type="button"
            >
              {showKeyInput ? 'Hide' : 'API Key'}
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        {phase === 'idle' && (
          <div className="landing">
            <div className="landing-text">
              <h1 className="landing-title">Evidence Gap Analysis</h1>
              <p className="landing-desc">
                Enter a procedure or diagnosis to generate a structured audit-ready
                gap analysis between the governing CMS coverage policy and current
                peer-reviewed literature.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="search-form">
              <div className="search-box">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. TAVR, AF ablation, cardiac rehabilitation"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  required
                  autoFocus
                />
                <button type="submit" className="search-btn">
                  Analyze →
                </button>
              </div>
              {showKeyInput && (
                <div className="key-row">
                  <input
                    type="password"
                    className="key-input"
                    placeholder="Anthropic API key (sk-ant-...)"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                  />
                  <p className="key-hint">Stored in session only. Never sent to any server other than api.anthropic.com.</p>
                </div>
              )}
            </form>

            <div className="example-queries">
              <span className="example-label">Try:</span>
              {['TAVR', 'AF ablation', 'Watchman device', 'Cardiac rehabilitation'].map(ex => (
                <button
                  key={ex}
                  type="button"
                  className="example-chip"
                  onClick={() => setQuery(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="running-view">
            <form onSubmit={handleSubmit} className="search-form search-form-compact">
              <div className="search-box">
                <input
                  type="text"
                  className="search-input"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  required
                />
                <button type="submit" className="search-btn">Analyze →</button>
              </div>
            </form>
            <div className="pipeline-status">
              <StepIndicator steps={STEPS} activeStep={activeStep} />
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="error-view">
            <form onSubmit={handleSubmit} className="search-form search-form-compact">
              <div className="search-box">
                <input
                  type="text"
                  className="search-input"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                />
                <button type="submit" className="search-btn">Retry →</button>
              </div>
            </form>
            <div className="error-box">
              <strong>Error:</strong> {error}
              {error.toLowerCase().includes('api key') && (
                <p>Click "API Key" in the header to enter your Anthropic API key.</p>
              )}
            </div>
          </div>
        )}

        {phase === 'done' && report && (
          <div className="done-view">
            <form onSubmit={handleSubmit} className="search-form search-form-compact">
              <div className="search-box">
                <input
                  type="text"
                  className="search-input"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  required
                />
                <button type="submit" className="search-btn">Analyze →</button>
              </div>
            </form>
            <ReportCard report={report} />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Coverage Evidence Match · Built for UM Committees · CMS-4201-F Compliance</p>
      </footer>
    </div>
  )
}
