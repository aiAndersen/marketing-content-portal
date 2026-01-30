# Marketing Content Portal - Database & Natural Language Query System

A complete solution to convert your Google Sheets marketing content into a queryable database with natural language search capabilities.

## 🎯 Overview

This system allows marketing reps to query your content database using natural language queries like:
- "Show me all customer stories from Nevada"
- "Find case studies about student engagement"
- "What content do we have about SchoolLinks?"

## 🏗️ Architecture

- **Database**: Supabase (PostgreSQL) - Free tier
- **Backend API**: Supabase auto-generated REST API
- **Frontend**: React with Vite - Hosted on Vercel/Netlify (Free)
- **NLP**: OpenAI GPT or Anthropic Claude API for natural language processing
- **Data Sync**: Python script to import from Google Sheets

## 📋 Prerequisites

1. **Supabase Account** (Free): https://supabase.com
2. **Vercel or Netlify Account** (Free): https://vercel.com or https://netlify.com
3. **API Key** (Choose one):
   - OpenAI API Key: https://platform.openai.com
   - Anthropic Claude API Key: https://console.anthropic.com

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
   export GOOGLE_SHEET_ID="1f8x1A16jJoi3_CM_F5hYeMs9WfxgRRIJhy9U95www7w"
   ```

3. Run the import script:
   ```bash
   python scripts/import_from_sheets.py
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
   VITE_ANTHROPIC_API_KEY=your-anthropic-key
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

The system creates a `marketing_content` table with:
- `id` (UUID, primary key)
- `type` (text) - Content type (Customer Story, Video, etc.)
- `title` (text) - Content title
- `live_link` (text) - Published URL
- `updated_link` (text) - Draft/updated URL
- `platform` (text) - Platform/source
- `summary` (text) - Full content summary
- `state` (text) - State/region
- `created_at` (timestamp)
- `updated_at` (timestamp)

Full-text search is enabled for efficient querying.

## 🔍 How Natural Language Queries Work

1. User types a question: "Show me customer stories from Nevada"
2. The LLM (Claude/GPT) converts it to SQL:
   ```sql
   SELECT * FROM marketing_content 
   WHERE type = 'Customer Story' 
   AND state = 'NV'
   ```
3. Query executes on Supabase
4. Results are formatted and displayed

## 🔄 Keeping Data in Sync

### Option 1: Manual Updates
Run the import script whenever you update the Google Sheet:
```bash
python scripts/import_from_sheets.py
```

### Option 2: Scheduled Updates
Set up a cron job or GitHub Action to run daily:
```yaml
# .github/workflows/sync-data.yml
name: Sync Data
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
```

### Option 3: Google Apps Script Webhook
Create a script that pushes changes to Supabase when the sheet is edited (see `scripts/google_apps_script.js`)

## 💰 Cost Breakdown

All services have generous free tiers:

- **Supabase**: Free for 500MB database, 2GB bandwidth/month
- **Vercel/Netlify**: Free for hobby projects, unlimited bandwidth
- **Anthropic Claude**: $5 free credits, then ~$0.01 per query
- **OpenAI GPT**: $5 free credits, then ~$0.002 per query

**Estimated monthly cost**: $0-10 depending on query volume

## 🔒 Security

- Database credentials use environment variables
- API keys never exposed in frontend code
- Row Level Security (RLS) can be enabled in Supabase
- CORS configured for your domain only

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
| Staging | `staging` | `staging-*.vercel.app` |
| Production | `main` | `*.vercel.app` |

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

- ✅ Natural language search
- ✅ Filter by content type, state, platform
- ✅ Full-text search across all fields
- ✅ Export results to CSV
- ✅ Direct links to content
- ✅ Mobile-responsive design
- ✅ Real-time updates

## 🛠️ Customization

### Adding New Columns
1. Update `backend/schema.sql`
2. Modify `scripts/import_from_sheets.py`
3. Update frontend components

### Changing the UI
All frontend code is in `frontend/src/`. The main components are:
- `App.jsx` - Main application
- `QueryInterface.jsx` - Natural language input
- `ResultsDisplay.jsx` - Results table

### Using Different LLM
Switch between Claude and OpenAI by changing the API endpoint in `frontend/src/services/nlp.js`

## 📚 File Structure

```
marketing-content-portal/
├── backend/
│   ├── schema.sql              # Database schema
│   └── setup-instructions.md   # Detailed Supabase setup
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   ├── services/
│   │   └── styles/
│   ├── package.json
│   └── vite.config.js
├── scripts/
│   ├── import_from_sheets.py   # Data import script
│   ├── requirements.txt        # Python dependencies
│   └── google_apps_script.js   # Optional: real-time sync
├── docs/
│   ├── API.md                  # API documentation
│   └── DEPLOYMENT.md           # Deployment guide
└── README.md                   # This file
```

## 🤝 Support

For issues or questions:
1. Check the documentation in the `docs/` folder
2. Review Supabase docs: https://supabase.com/docs
3. Check Vercel docs: https://vercel.com/docs

## 📄 License

MIT License - feel free to modify and use for your organization

---

Built with ❤️ for efficient marketing content discovery
