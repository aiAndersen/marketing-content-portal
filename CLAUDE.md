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

## Gotchas

1. **Content submission is vanilla JS** - No imports/exports, no React
2. **API keys must never be in frontend** - Use `/api/openai` proxy
3. **Brand spelling is "SchooLinks"** - Not "SchoolLinks"
4. **Video Clip vs Video** - Clips are short snippets (YouTube Shorts)
5. **1-Pager includes** - Fact sheets, flyers, brochures, infographics
6. **Terminology service has fallback mappings** - Works without database

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
