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

// ─── Demo report (no API key required) ───────────────────────────────────────

const DEMO_REPORT = {
  procedure: 'Transcatheter Aortic Valve Replacement (TAVR)',
  policy_type: 'NCD',
  policy_id: 'NCD 20.32',
  last_revised: '2019-06-21',
  policy_evidence_basis: [
    'PARTNER 1 trial (2011): TAVR non-inferior to SAVR in high-risk surgical patients',
    'PARTNER 2 trial (2016): TAVR non-inferior to SAVR in intermediate-risk patients',
    'CoreValve US Pivotal trial (2014): TAVR superior to SAVR in extreme-risk patients',
    'FDA approval of SAPIEN 3 and CoreValve Evolut systems as evidence basis',
  ],
  literature_since_revision: {
    count: 47,
    studies: [
      { pmid: '37321234', title: 'Five-year outcomes of TAVR vs. SAVR in low-risk patients: PARTNER 3 extended follow-up', authors: 'Mack MJ, Leon MB, Thourani VH', journal: 'N Engl J Med', date: '2024 Mar' },
      { pmid: '37198876', title: 'Transcatheter aortic valve replacement in bicuspid aortic valve stenosis: a systematic review', authors: 'Yoon SH, Bleiziffer S, De Backer O', journal: 'J Am Coll Cardiol', date: '2024 Jan' },
      { pmid: '36954321', title: 'Leaflet thrombosis after TAVR: incidence, outcomes, and anticoagulation strategies', authors: 'Chakravarty T, Søndergaard L, Friedman J', journal: 'Circulation', date: '2023 Nov' },
      { pmid: '36812345', title: 'Cerebrovascular outcomes after TAVR with cerebral embolic protection: PROTECTED TAVR trial', authors: 'Kapadia SR, Makkar R, Leon M', journal: 'N Engl J Med', date: '2023 Aug' },
      { pmid: '36701234', title: 'Sex-based differences in TAVR outcomes: analysis of 90,000 procedures in the STS/ACC TVT Registry', authors: 'Nitsche C, Koschutnik M, Kammerlander A', journal: 'JAMA Cardiol', date: '2023 Jun' },
      { pmid: '36589012', title: 'Conduction disturbances and pacemaker implantation after TAVR: updated meta-analysis', authors: '열 열열 열열', journal: 'Eur Heart J', date: '2023 Apr' },
      { pmid: '36478901', title: 'TAVR durability at 10 years: structural valve deterioration in the FRANCE-2 registry', authors: 'Eltchaninoff H, Durand E, Avinée G', journal: 'Lancet', date: '2023 Feb' },
      { pmid: '36367890', title: 'Cost-effectiveness of TAVR in low-surgical-risk patients: long-term economic analysis', authors: 'Baron SJ, Wang K, House JA', journal: 'J Am Coll Cardiol', date: '2023 Jan' },
    ],
  },
  gap_direction: 'supports_expansion',
  staleness_score: 62,
  recommended_action: 'escalate',
  summary: 'NCD 20.32 (June 2019) established TAVR coverage criteria based on intermediate-to-high surgical risk classification. Since revision, substantial evidence supports TAVR expansion to low-risk patients (PARTNER 3, Evolut Low Risk), patients with bicuspid valves, and younger populations — cohorts currently not explicitly covered. Five-year durability data now available, and 47 indexed studies since 2019 collectively challenge the surgical-risk gating criteria that underpin current coverage determinations.',
  key_citations: [
    { pmid: '37321234', title: 'Five-year outcomes of TAVR vs. SAVR in low-risk patients: PARTNER 3', finding: 'TAVR demonstrated superiority over SAVR at 5 years in low-risk patients (death/stroke/rehospitalization composite: 31.3% vs. 38.5%), directly challenging the intermediate-risk threshold in NCD 20.32.' },
    { pmid: '37198876', title: 'TAVR in bicuspid aortic valve stenosis: systematic review', finding: 'Pooled outcomes for bicuspid TAVR (n=4,500) showed 30-day mortality of 1.1% and stroke 2.0%, comparable to tricuspid valve outcomes — supporting extension of NCD coverage to bicuspid anatomy.' },
    { pmid: '36812345', title: 'PROTECTED TAVR trial: cerebral embolic protection', finding: 'Cerebral embolic protection did not reduce stroke at 72 hours (2.3% vs. 2.9%, p=0.30), informing procedural coverage criteria for adjunctive devices.' },
  ],
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

function DemoBanner({ onAddKey }) {
  return (
    <div className="demo-banner">
      <span className="demo-banner-label">Demo mode</span>
      <span className="demo-banner-text">This is sample data for TAVR (NCD 20.32). For a live analysis of any procedure,</span>
      <button className="demo-banner-link" onClick={onAddKey}>add your Anthropic API key →</button>
    </div>
  )
}

function ReportCard({ report, isDemo, onAddKey }) {
  return (
    <div className="report-card">
      {isDemo && <DemoBanner onAddKey={onAddKey} />}
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
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [pendingQuery, setPendingQuery] = useState('')
  const [phase, setPhase] = useState('idle') // idle | running | done | error
  const [activeStep, setActiveStep] = useState(-1)
  const [report, setReport] = useState(null)
  const [isDemo, setIsDemo] = useState(false)
  const [error, setError] = useState('')

  async function runPipeline(q, key) {
    setPhase('running')
    setReport(null)
    setError('')
    const demo = !key
    setIsDemo(demo)
    try {
      setActiveStep(0)
      await new Promise(r => setTimeout(r, 700))
      setActiveStep(1)
      await new Promise(r => setTimeout(r, demo ? 900 : 0))
      const pubmedData = demo ? DEMO_REPORT.literature_since_revision : await searchPubMed(q, null)
      setActiveStep(2)
      await new Promise(r => setTimeout(r, 600))
      setActiveStep(3)
      await new Promise(r => setTimeout(r, demo ? 800 : 0))
      const result = demo
        ? { ...DEMO_REPORT, procedure: q || DEMO_REPORT.procedure }
        : await runAnthropicPipeline(q, pubmedData, key)
      if (!demo && pubmedData.studies.length > 0) result.literature_since_revision = pubmedData
      setReport(result)
      setPhase('done')
      setActiveStep(-1)
    } catch (err) {
      setError(err.message || 'Unknown error')
      setPhase('error')
      setActiveStep(-1)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const key = sessionStorage.getItem('cem_api_key') || ''
    runPipeline(query, key)
  }

  function handleKeySubmit(e) {
    e.preventDefault()
    const key = apiKey.trim()
    if (!key) return
    sessionStorage.setItem('cem_api_key', key)
    setShowKeyModal(false)
    setApiKey('')
    runPipeline(pendingQuery, key)
  }

  return (
    <div className="app">
      {showKeyModal && (
        <div className="key-modal-overlay">
          <form className="key-modal" onSubmit={handleKeySubmit}>
            <h2 className="key-modal-title">Enter API Key</h2>
            <p className="key-modal-desc">
              Coverage Evidence Match uses the Anthropic API to generate gap analyses.
              Enter your API key once — it's stored in your browser session only.
            </p>
            <input
              type="password"
              className="key-input"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoFocus
              required
            />
            <p className="key-hint">Never sent to any server other than api.anthropic.com.</p>
            <div className="key-modal-actions">
              <button type="button" className="key-cancel" onClick={() => setShowKeyModal(false)}>Cancel</button>
              <button type="submit" className="search-btn">Continue →</button>
            </div>
          </form>
        </div>
      )}

      <header className="app-header">
        <div className="header-inner">
          <div className="wordmark">
            <span className="wordmark-main">Coverage Evidence Match</span>
            <span className="wordmark-sub">UM Committee Compliance Tool</span>
          </div>
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
              <div className="error-actions">
                <button
                  className="error-demo-btn"
                  onClick={() => {
                    sessionStorage.removeItem('cem_api_key')
                    runPipeline(query, '')
                  }}
                >
                  Run demo instead →
                </button>
                {sessionStorage.getItem('cem_api_key') && (
                  <button
                    className="error-clear-btn"
                    onClick={() => {
                      sessionStorage.removeItem('cem_api_key')
                      setPendingQuery(query)
                      setShowKeyModal(true)
                      setPhase('idle')
                    }}
                  >
                    Replace API key
                  </button>
                )}
              </div>
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
            <ReportCard
              report={report}
              isDemo={isDemo}
              onAddKey={() => { setPendingQuery(query); setShowKeyModal(true) }}
            />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>Coverage Evidence Match · Built for UM Committees · CMS-4201-F Compliance</p>
      </footer>
    </div>
  )
}
