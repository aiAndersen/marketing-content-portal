# Marketing Content Portal - Database & Natural Language Query System

A complete solution for querying SchooLinks marketing content using natural language search, powered by OpenAI and Supabase.

## 🎯 Overview

This system allows marketing reps to query the content database using natural language queries like:
- "Show me all customer stories from Nevada"
- "Find case studies about student engagement"
- "What content do we have about SchooLinks?"

## 🏗️ Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Database | Supabase (PostgreSQL) | Cloud-hosted |
| Frontend | React + Vite | `/frontend/` |
| Content Submission | Vanilla JS | `/content-submission/` |
| Backend API | Supabase REST + Vercel serverless | `/frontend/api/` |
| AI | OpenAI GPT models | Via `/api/openai` proxy |
| Hosting | Vercel | Auto-deploy from git |

## 🗄️ Database Connection

The project uses Supabase PostgreSQL with connection pooling.

### Connection Details
- **Host**: `aws-1-us-east-1.pooler.supabase.com`
- **Port**: `5432`
- **Database**: `postgres`
- **Project Ref**: `wbjkncpkucmtjusfczdy`

### Connection String Format
```
postgresql://postgres.wbjkncpkucmtjusfczdy:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres
```

### Running Migrations
```bash
# Set DATABASE_URL (already configured in .env.local)
source .env.local

# Run migration script
python scripts/run_qa_logging_migration.py
```

### Tables
- `marketing_content` - All content items
- `terminology_map` - Vocabulary mappings for search
- `ai_prompt_logs` - Query analytics and logging
- `ai_context` - Competitive intelligence and customer story enrichment
- `state_terminology` - State-specific acronyms (50 states)
- `log_analysis_reports` - Analysis output from log_analyzer.py

## 🚀 Quick Start

### Step 1: Set Up Supabase Database

1. Create a new project at https://supabase.com
2. Go to SQL Editor and run the script from `backend/schema.sql`
3. Copy your project URL and anon key from Settings > API

### Step 2: Import Your Data

1. Install Python dependencies:
   ```bash
   pip install -r scripts/requirements.txt
   ```

2. Set environment variables:
   ```bash
   export SUPABASE_URL="your-project-url"
   export SUPABASE_KEY="your-anon-key"
   ```

3. Run the import orchestrator:
   ```bash
   python scripts/import_orchestrator.py --dry-run  # Preview
   python scripts/import_orchestrator.py            # Full import
   ```

### Step 3: Deploy the Frontend

1. Install dependencies:
   ```bash
   cd frontend
   npm install
   ```

2. Create `.env` file:
   ```
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

3. Test locally:
   ```bash
   npm run dev
   ```

4. Deploy to Vercel:
   ```bash
   npm install -g vercel
   vercel
   ```

## 📊 Database Schema

### `marketing_content` (main table)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `type` | text | Blog, Video, Customer Story, 1-Pager, Ebook, etc. |
| `title` | text | Content title |
| `live_link` | text | Published URL |
| `updated_link` | text | Draft/updated URL |
| `platform` | text | Website, YouTube, HubSpot, etc. |
| `summary` | text | Content description |
| `enhanced_summary` | text | AI-generated enriched summary |
| `state` | text | US state abbreviation or "National" |
| `tags` | text | Comma-separated keywords |
| `keywords` | JSONB | Weighted keyword scores from enrichment |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Last update time |

Full-text search is enabled for efficient querying.

## 🔍 How Natural Language Queries Work

1. User types a query: "Show me customer stories from Nevada"
2. Query complexity is detected (simple/standard/advanced)
3. Appropriate OpenAI model is selected (gpt-4o-mini / gpt-5-mini / gpt-5.2)
4. State-specific terminology is injected when state codes are detected
5. Results are ranked by relevance and displayed

See [docs/AI_MODEL_ROUTING.md](./docs/AI_MODEL_ROUTING.md) for full details on model routing.

## 🔄 Keeping Data in Sync

Content is synced from multiple sources:

### Automated (via GitHub Actions)

| Schedule | Job |
|----------|-----|
| Daily 7 AM UTC | Deep content enrichment |
| Daily 8 AM UTC | Tag hygiene cleanup |
| Monday 9 AM UTC | Full database audit |
| Monday 10 AM UTC | Webflow + HubSpot import |

### On-Demand

```bash
# Import from all sources
python scripts/import_orchestrator.py -v

# Import from Webflow only
python scripts/import_webflow_resources.py

# Import from HubSpot
python scripts/import_hubspot_files.py
```

## 💰 Cost Breakdown

- **Supabase**: Free for 500MB database, 2GB bandwidth/month
- **Vercel**: Free for hobby projects, unlimited bandwidth
- **OpenAI**: ~$0.002–$0.02 per query depending on complexity

**Estimated monthly cost**: ~$5–20 depending on query and enrichment volume

## 🔒 Security

- Database credentials use environment variables
- API keys never exposed in frontend code (all proxied through `/api/openai`)
- Row Level Security (RLS) enabled in Supabase
- CORS configured for your domain only

See [SECURITY.md](./SECURITY.md) for full details.

## 🔄 Development Workflow

We use a three-tier deployment pipeline:

```
Local Dev → Staging → Production
    ↓          ↓          ↓
npm run dev   staging    main branch
              branch
```

| Environment | Branch | URL |
|-------------|--------|-----|
| Local | any | `localhost:5173` |
| Staging | `staging` | `marekting-content-portal-git-staging-schoolinks-projects.vercel.app` |
| Production | `main` | `marekting-content-portal.vercel.app` |

**Note:** The Vercel project name is `marekting-content-portal` (intentional typo in project name — do not "fix" it).

### Quick Start for Developers

```bash
# Clone and set up
git clone https://github.com/aiAndersen/marketing-content-portal.git
cd marketing-content-portal

# Start from staging branch
git checkout staging

# Create feature branch
git checkout -b feature/your-feature

# Install and run locally
cd frontend && npm install && npm run dev

# After changes, push to staging for testing
git checkout staging
git merge feature/your-feature
git push origin staging  # → Auto-deploys to staging

# Promote to production
git checkout main
git merge staging
git push origin main  # → Auto-deploys to production
```

See [VERCEL-SETUP.md](./VERCEL-SETUP.md) for detailed Vercel configuration and troubleshooting.

## 📱 Features

- ✅ Natural language search with multi-model AI routing
- ✅ Filter by content type, state, platform
- ✅ Full-text search across all fields
- ✅ Export results to CSV
- ✅ Direct links to content
- ✅ Mobile-responsive design
- ✅ Content submission portal (standalone app at `/content-submission/`)
- ✅ AI-assisted form with voice input and URL extraction
- ✅ Weekly GTM report generation
- ✅ Automated content enrichment pipeline

## 🤖 AI Self-Improvement Agent

The portal includes a self-improvement agent that continuously improves the Content Submission AI Assistant.

### Quick Start

```bash
# Set environment variables
export OPENAI_API_KEY="your-openai-key"
export DATABASE_URL="your-database-url"

# Run full analysis
python3 scripts/submission_agent_improver.py
```

### Available Commands

| Command | Description |
|---------|-------------|
| `python3 scripts/submission_agent_improver.py` | Full analysis report |
| `--fix-tags` | Fix redundant tags (preview) |
| `--fix-tags --apply` | Fix redundant tags (apply changes) |
| `--fix-spelling --apply` | Fix brand misspellings |
| `--analyze-prompt` | AI-powered SYSTEM_PROMPT analysis |
| `--suggest-terms` | AI-powered terminology suggestions |
| `--all --apply` | Run all fixes |

### What It Fixes

1. **Redundant Tags** - Removes brand name, state, content type from tags
2. **Brand Misspellings** - Fixes "SchoolLinks" → "SchooLinks"
3. **SYSTEM_PROMPT Quality** - AI analysis of prompt effectiveness
4. **Terminology Gaps** - Suggests new search term mappings

## 📚 File Structure

```
marketing-content-portal/
├── README.md
├── CLAUDE.md                       # Claude Code configuration + agent skills
├── SECURITY.md                     # Security architecture
├── VERCEL-SETUP.md                 # Vercel deployment config
├── PROJECT_SUMMARY.md              # Executive summary
├── frontend/                       # React app (main portal)
│   ├── src/
│   │   ├── components/             # React components
│   │   └── services/               # nlp.js, terminology.js
│   └── api/                        # Vercel serverless functions
│       ├── openai.js               # OpenAI proxy
│       ├── whisper.js              # Voice transcription
│       ├── hubspot-deals.js        # HubSpot integration
│       └── webflow-webhook.js      # Webflow CMS sync
├── content-submission/             # Standalone vanilla JS app
│   ├── ai-assistant.js             # AI content parser
│   ├── app.js                      # Form handling + GTM reports
│   └── index.html                  # Entry point
├── scripts/                        # Python automation (41 scripts)
│   ├── import_orchestrator.py      # Unified import workflow
│   ├── maintenance_orchestrator.py # Full maintenance cycle
│   ├── enrich_deep.py              # Deep enrichment pipeline
│   ├── audit_content_tags.py       # Database audit
│   ├── log_analyzer.py             # Search log analysis
│   ├── health_monitor.py           # System health monitoring
│   └── requirements.txt
├── docs/                           # Documentation
│   ├── AI_MODEL_ROUTING.md         # Model selection strategy
│   ├── USER_GUIDE.md               # End-user search guide
│   ├── DEPLOYMENT.md               # Deployment guide
│   ├── ENRICHMENT_GUIDE.md         # Content enrichment process
│   └── Competitive_Positioning_Analysis.md
├── backend/                        # SQL migrations
├── supabase/migrations/            # Database migrations
└── SchooLinks Baseline Context/    # AI context files
    ├── SL_baseline_context_AIAgents.md
    └── State Specific Context/     # State legislation guides
```

## 🤝 Support

For issues or questions:
1. Check the documentation in the `docs/` folder
2. Review [CLAUDE.md](./CLAUDE.md) for agent skills and automation
3. Review Supabase docs: https://supabase.com/docs
4. Review Vercel docs: https://vercel.com/docs

## 📄 License

MIT License - feel free to modify and use for your organization

---

Built with ❤️ for efficient SchooLinks marketing content discovery
