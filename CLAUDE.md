# Marketing Content Portal - Claude Code Configuration

## Project Overview

This is the **SchooLinks Marketing Content Portal** - a database and natural language query system for marketing content. It enables marketing reps to:
- Query content using natural language (powered by OpenAI)
- Submit new content via an AI-assisted form
- Track content across states, types, and topics
- Generate weekly GTM reports for sales enablement

## Brand Guidelines

**CRITICAL**: Always spell the brand name as **"SchooLinks"** (capital S and L, no space)
- Correct: SchooLinks
- Wrong: SchoolLinks, Schoolinks, School Links, school links

This is intentional branding - do not "fix" it to "SchoolLinks".

## Architecture

| Layer | Technology | Location |
|-------|------------|----------|
| Database | Supabase (PostgreSQL) | Cloud-hosted |
| Frontend | React + Vite | `/frontend/` |
| Content Submission | Vanilla JS | `/content-submission/` |
| Backend API | Supabase REST + Vercel serverless | `/frontend/api/` |
| AI | OpenAI GPT models | Via `/api/openai` proxy |
| Hosting | Vercel | Auto-deploy from git |

## Key Directories

```
marketing-content-portal/
├── frontend/                    # React app (main portal)
│   ├── src/
│   │   ├── components/          # React components
│   │   └── services/            # API services (nlp.js, terminology.js)
│   └── api/                     # Vercel serverless functions
├── content-submission/          # Standalone vanilla JS app
│   ├── ai-assistant.js          # AI content parser
│   ├── app.js                   # Form handling + reports
│   └── index.html               # Entry point
├── scripts/                     # Python automation scripts
├── SchooLinks Baseline Context/ # AI context files
├── backend/                     # SQL migrations
└── supabase/migrations/         # Database migrations
```

## AI Services

### Model Routing Strategy
- `gpt-4o-mini` - Simple parsing, content submission (cost-efficient)
- `gpt-5-mini` - Standard NLP queries
- `gpt-5.2` - Complex queries, competitor analysis, sales questions

### Key AI Files
- `/frontend/src/services/nlp.js` - NLP service with model routing
- `/frontend/src/services/terminology.js` - Terminology brain mappings
- `/content-submission/ai-assistant.js` - Content parsing AI

### Context Files
- `/SchooLinks Baseline Context/SL_baseline_context_AIAgents.md` - Master context
- `/SchooLinks Baseline Context/State Specific Context/` - State legislation guides

## Content Submission Portal

The content submission portal (`/content-submission/`) is a **standalone vanilla JS app** (not React).

### Key Features
- Voice input via Web Speech API
- URL content extraction (YouTube, HubSpot PDFs, websites)
- AI-powered field parsing with confidence scores
- PDF text extraction with OCR fallback

### Important Functions
- `parseWithAI()` - Main AI parsing function
- `normalizeBrandName()` - Ensures correct "SchooLinks" spelling
- `normalizeAndDeduplicateTags()` - Filters redundant tags
- `fetchYouTubeTranscript()` - Extracts video transcripts

### Tagging Guidelines
The AI is instructed to:
- NOT include "SchooLinks" as a tag (redundant)
- NOT include state names (captured in state field)
- NOT include content types (captured in type field)
- NOT include generic terms (education, K-12, students)
- DO include specific features (KRI, PLP, WBL, Pulse)
- DO include personas (counselors, administrators)
- DO include specific topics (FAFSA, CCMR, internships)

## Database Schema

### Main Tables
- `marketing_content` - All content items
- `terminology_map` - Vocabulary mappings for search
- `ai_prompt_logs` - Query analytics
- `ai_context` - Competitive intelligence

### Key Fields in marketing_content
- `type` - Blog, Video, Customer Story, 1-Pager, Ebook, etc.
- `platform` - Website, YouTube, HubSpot, etc.
- `state` - US state abbreviation or "National"
- `tags` - Comma-separated keywords
- `summary` - Content description

## Common Tasks

### Adding AI Features
1. Check `/frontend/src/services/nlp.js` for patterns
2. Use `SCHOOLINKS_CONTEXT` for product knowledge
3. Route through `/api/openai` for API key security
4. Select appropriate model by complexity

### Running Content Submission Locally
```bash
# Open directly in browser (no build needed)
open content-submission/index.html
```

### Python Scripts
```bash
cd scripts
pip install -r requirements.txt
python import_webflow_resources.py  # Import from Webflow
python log_analyzer.py --days 7     # Analyze search patterns
python ai_context_manager.py list   # View AI context
```

### Database Migrations
1. Create SQL file in `/backend/` or `/supabase/migrations/`
2. Create runner script in `/scripts/`
3. Test on staging first

## Environment Variables

### Frontend (Vite)
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

### Backend/Scripts
- `OPENAI_API_KEY` - OpenAI API key (server-side only)
- `DATABASE_URL` - Direct PostgreSQL connection string
- `HUBSPOT_API_KEY` - HubSpot Private App token (server-side only, used by `/api/hubspot-deals` serverless function)

### Managing Vercel Environment Variables (use CLI)

**Correct Vercel project name: `marekting-content-portal`** (schoolinks-projects scope)
- Production URL: https://marekting-content-portal.vercel.app
- Staging URL alias: https://marekting-content-portal-git-staging-schoolinks-projects.vercel.app
- NOTE: There is also an old `marketing-content-portal` project — that is NOT the active one

```bash
# Ensure repo is linked to the correct project
vercel link --project marekting-content-portal --scope schoolinks-projects --yes

# List all env vars
vercel env ls

# Add a variable to staging/preview
echo "value" | vercel env add VAR_NAME preview

# Add a variable to production
echo "value" | vercel env add VAR_NAME production

# Add to both
echo "value" | vercel env add VAR_NAME preview production

# Remove a variable
vercel env rm VAR_NAME preview

# Pull all env vars to local .env.local
vercel env pull

# Redeploy latest staging build (after adding env var)
vercel redeploy <deployment-url> --no-wait
```
> Always use the Vercel CLI (not the dashboard) to manage env vars so changes are repeatable and documented here.

## ⚠️ Deployment Rules — STRICTLY ENFORCED

**NEVER push to `main` branch without explicit user approval.**

- All work happens on the `staging` branch
- Use `git push origin staging` only
- Only push to `main` when the user explicitly says "push to main", "deploy to production", or similar
- Merging staging → main requires the user to say so directly
- Violating this caused a production incident — do not repeat it

Correct staging push:
```bash
git push origin staging
```

NEVER run these without explicit user instruction:
```bash
git push origin main     # ← FORBIDDEN without approval
git checkout main && git merge staging && git push origin main  # ← FORBIDDEN
```

## Gotchas

1. **Content submission is vanilla JS** - No imports/exports, no React
2. **API keys must never be in frontend** - Use `/api/openai` proxy
3. **Brand spelling is "SchooLinks"** - Not "SchoolLinks"
4. **Video Clip vs Video** - Clips are short snippets (YouTube Shorts)
5. **1-Pager includes** - Fact sheets, flyers, brochures, infographics
6. **Terminology service has fallback mappings** - Works without database
7. **gpt-5.x models**: Use `max_completion_tokens` NOT `max_tokens`; do NOT pass `temperature` — the `/api/openai` proxy handles this, but nlp.js must not pass conflicting params

## Self-Improvement Agent

The project includes a powerful self-improvement agent that continuously improves the Content Submission AI Assistant.

### Location
`/scripts/submission_agent_improver.py`

### Quick Start
```bash
# Full analysis report
python3 scripts/submission_agent_improver.py

# Fix redundant tags (preview)
python3 scripts/submission_agent_improver.py --fix-tags

# Fix redundant tags (apply)
python3 scripts/submission_agent_improver.py --fix-tags --apply

# Fix brand misspellings
python3 scripts/submission_agent_improver.py --fix-spelling --apply

# AI-powered prompt analysis
python3 scripts/submission_agent_improver.py --analyze-prompt

# AI-powered terminology suggestions
python3 scripts/submission_agent_improver.py --suggest-terms

# Run all fixes
python3 scripts/submission_agent_improver.py --all --apply
```

### Features
1. **Tag Quality Analysis** - Finds redundant tags (brand, state, type, generic terms)
2. **Brand Spelling Audit** - Detects "SchoolLinks" misspellings in content
3. **AI Prompt Analysis** - Uses OpenAI to analyze SYSTEM_PROMPT quality
4. **Terminology Suggestions** - AI-powered term mapping recommendations

### When to Run
- After bulk content imports
- Weekly maintenance
- When search quality degrades
- Before major releases

### Environment Requirements
```bash
export OPENAI_API_KEY="your-key"
export DATABASE_URL="postgresql://..."
```

## Local Development

### Running Content Submission Locally
```bash
# Start local server
cd content-submission
python3 -m http.server 5175

# Access at http://localhost:5175
```

### Local OpenAI API Key
For local development, the content submission app falls back to `LOCAL_DEV_CONFIG.openaiKey` in `config.js` when the Vercel proxy is unavailable.

## Testing Checklist

- [ ] Content submission parses YouTube URLs correctly
- [ ] HubSpot PDFs extract text and determine type
- [ ] Tags don't include brand name, state, or type
- [ ] Brand name displays as "SchooLinks" everywhere
- [ ] AI queries route to appropriate model
- [ ] Local dev fallback works with LOCAL_DEV_CONFIG

## Agent Skills & Agents

Reusable skills and multi-step agents for database maintenance, enrichment, and operations.
Full documentation: https://github.com/aiAndersen/ai-agent-skills

### Skills (Single-Script Runners)

Skills are single-command invocations. Each runs one script with specific flags.

#### /audit-db
**Comprehensive database audit for tagging opportunities**
```bash
python scripts/audit_content_tags.py -v --output /tmp/audit_report.json
```
Reports: missing tags, missing keywords, missing summaries, unenriched content, state coverage gaps. Uses gpt-5.2 for AI analysis of flagged content sample.
- Options: `--limit N` (AI sample size), `--dry-run`, `--skip-ai`, `--output FILE`
- Schedule: Weekly (Monday 9 AM UTC) via `weekly-audit.yml`
- Cost: ~$0.20/run

#### /enrich
**Deep enrichment pipeline on unenriched content**
```bash
python scripts/enrich_deep.py --limit 20 -v
```
Extracts text from URLs and uses gpt-5.2 to generate weighted JSONB keywords, enhanced summaries, auto-tags, and quality assessments.
- Options: `--limit N`, `--force` (re-process all), `--model MODEL`, `--dry-run`
- Schedule: Daily (7 AM UTC) via `daily-enrichment.yml`
- Cost: ~$0.04/record, ~$0.80 for 20 records

#### /fix-tags
**Tag hygiene across all content**
```bash
python scripts/submission_agent_improver.py --fix-tags --fix-spelling --apply
python scripts/fix_tag_format.py
```
Removes redundant tags, fixes brand misspellings, converts array format tags.
- Schedule: Daily (8 AM UTC) via `daily-hygiene.yml`
- Cost: Free (rule-based)

#### /analyze-logs
**Search log analysis for quality issues**
```bash
python scripts/log_analyzer.py --days 7 --auto-suggest-terms -v
```
Analyzes `ai_prompt_logs` for zero-result queries, terminology gaps, and patterns.
- Options: `--days N`, `--start DATE`, `--end DATE`, `--dry-run`, `--output FILE`
- Schedule: Daily (6 AM UTC) via `log-analysis.yml`
- Cost: ~$0.01/run

#### /content-gaps
**Content gap analysis based on search popularity**
```bash
python scripts/query_popularity_report.py --days 30 -v
```
Ranks queries by popularity, identifies high-demand topics with low content, generates AI executive summary.
- Options: `--days N`, `--output FILE`, `--csv FILE`, `--dry-run`
- Schedule: On-demand
- Cost: ~$0.50/run

#### /import-state-terminology
**Import state-specific KRI/PLP terminology from CSV into portal**
```bash
python scripts/import_state_terminology.py -v
```
Reads state-terminology CSV, upserts `state_terminology` table (50 states), and seeds `terminology_map` with state + feature entries (e.g., ECAP→AZ, HSBP→WA, CCMR→TX as state mappings; all PLP/KRI acronyms as feature mappings).
- Options: `--csv-path PATH` (default: ~/Desktop/inbound-generator/data/reports/state-pages/), `--force` (re-seed terminology_map), `--dry-run`
- Source CSV: `inbound-generator/data/reports/state-pages/state-terminology-YYYY-MM-DD.csv`
- Schedule: On-demand (when state-pages CSV is regenerated from inbound-generator)
- Cost: Free (DB inserts only)

#### /fetch-customer-stories
**Pull Customer Stories from Webflow API and save to CSV**
```bash
python scripts/fetch_webflow_customer_stories.py -v
```
Fetches all published Customer Story items from Webflow resources collection, extracts fields (name, slug, district, state, quote, video URL, PDF URL), matches to `marketing_content` records by URL/title, and saves a local CSV.
- Options: `--dry-run`, `--output PATH`, `--fields` (print raw Webflow field keys for debugging), `-v`
- Output: `~/Desktop/inbound-generator/data/reports/customer-stories/customer-stories-YYYY-MM-DD.csv`
- Run FIRST before `/enrich-customer-stories`
- Schedule: On-demand (when new customer stories are published to Webflow)
- Cost: Free (Webflow API reads only)

#### /enrich-customer-stories
**Enrich customer stories with AI-extracted quotes, proof points, and context**
```bash
python scripts/enrich_customer_stories.py -v
```
For each customer story: scrapes landing page, extracts YouTube transcript, reads PDF, synthesizes with gpt-5.2 to extract key quote, proof points, metrics, features used. Upserts `ai_context` (category=`customer_story`) and updates `marketing_content` with enhanced_summary + keywords.
- Options: `--dry-run`, `--limit N`, `--force` (re-enrich), `--story SLUG`, `--csv-path PATH` (from fetch script), `-v`
- Run after `/fetch-customer-stories` or standalone against DB records
- Schedule: On-demand (after new customer stories are published or edited)
- Cost: ~$0.05-0.10/story via gpt-5.2

### Agents (Multi-Step Orchestrators)

Agents are multi-step workflows that orchestrate multiple scripts, run checks, make decisions, and provide actionable output.

#### /deploy-check
**Pre-deployment safety validation agent** (6 steps)
```bash
python scripts/deploy_preflight.py --target staging -v
```
Steps: (1) Verify env vars across local, Vercel, GitHub (2) Build frontend and check for errors (3) Detect pending migrations (4) Database health snapshot (5) Git state validation (6) Go/no-go report.
- Options: `--target {staging,production}`, `--skip-build`, `--skip-vercel`, `--strict`, `--output FILE`, `--dry-run`
- Orchestrates: `npm run build`, `vercel env ls`, `gh secret list`, DB health queries
- Schedule: On-demand (run before every deploy)
- Workflow: `pre-deploy-check.yml` (triggers on PRs to main/staging)
- Cost: Free (no AI calls)

#### /health-monitor
**System health and search quality monitoring agent** (6 steps)
```bash
python scripts/health_monitor.py --baseline-days 7 -v
```
Steps: (1) Query quality vs baseline (2) Content freshness + extraction errors (3) Pipeline execution status (4) Terminology health (5) AI anomaly detection (6) Alert-formatted output.
- Options: `--baseline-days N`, `--alert`, `--skip-ai`, `--threshold-zero-rate FLOAT`, `--output FILE`, `--dry-run`
- Orchestrates: DB queries against `ai_prompt_logs`, `marketing_content`, `log_analysis_reports`, `terminology_map`
- Schedule: Daily (5:30 AM UTC) via `daily-health-check.yml` — runs BEFORE all other jobs
- Cost: ~$0.01/run (gpt-4o-mini anomaly check)

#### /diagnose-search
**Search quality debugging agent** (6 steps)
```bash
python scripts/diagnose_search.py "your search query" -v
```
Steps: (1) Execute query against DB (2) Trace terminology mappings (3) Analyze keyword weight overlap (4) Find missed content (5) AI diagnosis with fix recommendations (6) Optional auto-fix terminology.
- Options: `QUERY` (positional), `--query-id UUID`, `--worst N`, `--auto-fix`, `--output FILE`, `--dry-run`
- Orchestrates: DB queries against `marketing_content`, `terminology_map`, `ai_prompt_logs`; AI diagnosis via gpt-5-mini
- Schedule: On-demand (use when search quality issues are reported)
- Cost: ~$0.02/query diagnosed

#### /import-all
**Unified content import orchestrator** (7 steps)
```bash
python scripts/import_orchestrator.py --enrich-limit 20 -v
```
Steps: (1) Pre-import snapshot (2) Test source connectivity (3) Run imports: Webflow, HubSpot, Google Drive (4) Cross-source deduplication (5) Enrich new records (6) Post-import audit (7) Delta report.
- Options: `--sources LIST`, `--skip-enrich`, `--skip-dedup`, `--enrich-limit N`, `--output FILE`, `--dry-run`
- Orchestrates: `import_webflow_resources.py`, `import_webflow_landing_pages.py`, `import_hubspot_files.py`, `import_google_drive.py`, `enrich_deep.py`, `dedup_content.py`, `audit_content_tags.py`
- Schedule: Weekly (Monday 10 AM UTC) via `weekly-import.yml`
- Cost: ~$0.80/run (mostly from enrichment of new records)

#### /full-maintenance
**Complete maintenance cycle orchestrator** (8 steps)
```bash
python scripts/maintenance_orchestrator.py --mode daily -v
```
Steps: (1) Pre-health check (gate) (2) Log analysis (3) Content enrichment (4) Tag hygiene (5) Content audit [weekly] (6) Content gaps [weekly] (7) Post-health check + delta (8) Maintenance report.
- Options: `--mode {daily,weekly,full}`, `--skip LIST`, `--enrich-limit N`, `--stop-on-error`, `--output FILE`, `--dry-run`
- Orchestrates: `health_monitor.py`, `log_analyzer.py`, `enrich_deep.py`, `submission_agent_improver.py`, `fix_tag_format.py`, `audit_content_tags.py`, `query_popularity_report.py`
- Schedule: On-demand (can replace individual workflows if desired)
- Cost: ~$1.00/daily, ~$1.70/weekly

### Automated Schedule

| Time (UTC) | Workflow | Agent/Skill | Frequency |
|------------|----------|-------------|-----------|
| 5:30 AM | `daily-health-check.yml` | `/health-monitor` | Daily |
| 6 AM | `log-analysis.yml` | `/analyze-logs` | Daily |
| 7 AM | `daily-enrichment.yml` | `/enrich` | Daily |
| 8 AM | `daily-hygiene.yml` | `/fix-tags` | Daily |
| 9 AM Mon | `weekly-audit.yml` | `/audit-db` | Weekly |
| 10 AM Mon | `weekly-import.yml` | `/import-all` | Weekly |
