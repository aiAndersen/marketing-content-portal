# Deployment Guide

Complete step-by-step guide to deploy your Marketing Content Portal with natural language search.

## Overview

This deployment guide will help you:
1. Set up a free Supabase database
2. Import your 636 marketing content items
3. Deploy a web interface with natural language query capabilities
4. Configure automatic data sync

**Total Time**: 30-45 minutes  
**Cost**: $0 (all using free tiers)

---

## Part 1: Database Setup (Supabase)

### Step 1.1: Create Supabase Account

1. Go to https://supabase.com
2. Click "Start your project"
3. Sign up with GitHub, Google, or email
4. Verify your email

### Step 1.2: Create a New Project

1. Click "New Project"
2. Fill in:
   - **Name**: `marketing-content-portal`
   - **Database Password**: (generate a strong password and save it)
   - **Region**: Choose closest to you
   - **Plan**: Free tier (500MB database, plenty for your needs)
3. Click "Create new project"
4. Wait 2-3 minutes for setup

### Step 1.3: Run Database Schema

1. In your Supabase dashboard, click "SQL Editor" in the left sidebar
2. Click "New query"
3. Copy the entire contents of `backend/schema.sql`
4. Paste into the SQL editor
5. Click "Run" (bottom right)
6. You should see "Success. No rows returned"

### Step 1.4: Get Your API Credentials

1. Click "Settings" (gear icon in left sidebar)
2. Click "API" under Project Settings
3. Copy these values (you'll need them):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: (long string starting with `eyJ...`)

---

## Part 2: Import Your Data

### Step 2.1: Install Python Dependencies

On your local machine or server:

```bash
cd marketing-content-portal/scripts
pip install -r requirements.txt
```

### Step 2.2: Set Environment Variables

```bash
# Replace with your actual values from Step 1.4
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key-here"
```

Or create a `.env` file:

```bash
echo 'SUPABASE_URL="https://your-project.supabase.co"' > .env
echo 'SUPABASE_KEY="your-anon-key-here"' >> .env
```

### Step 2.3: Run Import Script

```bash
# Import the data (will upload the Excel file from the project)
python import_from_excel.py --clear

# This will:
# - Read your Excel file
# - Clean and format the data
# - Upload 636 rows to Supabase
# - Take about 1-2 minutes
```

Expected output:
```
==========================================================
Marketing Content Portal - Data Import
==========================================================

[1/6] Connecting to Supabase...
✓ Connected successfully

[2/6] Reading Excel file...
✓ Loaded 636 rows from 'All Content - Data Lake' sheet

[3/6] Cleaning and preparing data...
✓ Data cleaned and prepared

[4/6] Data Summary:
  - Total rows: 636
  - Content types: 12
  ...

[6/6] Importing data to Supabase...
  ✓ Batch 1/7: 100 rows imported
  ✓ Batch 2/7: 100 rows imported
  ...

✓ Successfully imported: 636 rows
```

### Step 2.4: Verify Import

1. Go back to Supabase dashboard
2. Click "Table Editor" in left sidebar
3. Select "marketing_content" table
4. You should see all 636 rows

---

## Part 3: Deploy Frontend

### Step 3.1: Get an AI API Key (Optional but Recommended)

For natural language queries, you need ONE of these:

**Option A: Anthropic Claude (Recommended)**
1. Go to https://console.anthropic.com
2. Sign up and verify email
3. Go to "API Keys"
4. Create new key, copy it
5. You get $5 free credits (~500 queries)

**Option B: OpenAI GPT**
1. Go to https://platform.openai.com
2. Sign up and add billing (they give $5 free credit)
3. Go to API keys
4. Create new key, copy it

**Option C: Skip (Basic Search Only)**
- App will still work with keyword search
- No natural language understanding

### Step 3.2: Configure Frontend

```bash
cd marketing-content-portal/frontend

# Copy environment template
cp .env.example .env

# Edit .env file
nano .env  # or use your preferred editor
```

Fill in:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ANTHROPIC_API_KEY=your-claude-key  # or VITE_OPENAI_API_KEY
```

### Step 3.3: Install Dependencies

```bash
npm install
```

### Step 3.4: Test Locally

```bash
npm run dev
```

Open http://localhost:3000 in your browser. You should see your marketing portal!

Test queries:
- "Show me customer stories from Nevada"
- "Find all videos"
- "What content do we have about SchoolLinks?"

### Step 3.5: Deploy to Vercel (Free Hosting)

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel

# Follow prompts:
# - Link to existing project? No
# - Project name: marketing-content-portal
# - Directory: ./
# - Override settings? No

# Deploy to production
vercel --prod
```

Your site will be live at: `https://marketing-content-portal.vercel.app`

### Step 3.6: Set Environment Variables on Vercel

1. Go to https://vercel.com/dashboard
2. Select your project
3. Go to "Settings" → "Environment Variables"
4. Add each variable:
   - `VITE_SUPABASE_URL` - Supabase project URL (public)
   - `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (public)
   - `SUPABASE_SERVICE_KEY` - Supabase service role key (**server-side only**, required for write operations)
   - `SUPABASE_URL` - Supabase project URL (for serverless functions)
   - `OPENAI_API_KEY` - OpenAI API key (server-side only)
   - `VITE_ANTHROPIC_API_KEY` (or `VITE_OPENAI_API_KEY`) - for frontend AI search
5. Click "Save"
6. Redeploy: `vercel --prod`

**Important:** Both Vercel projects (frontend and content-submission) need `SUPABASE_SERVICE_KEY` and `SUPABASE_URL` set. You can also add env vars via CLI:
```bash
echo "your-service-role-key" | vercel env add SUPABASE_SERVICE_KEY production
echo "your-service-role-key" | vercel env add SUPABASE_SERVICE_KEY preview
echo "your-service-role-key" | vercel env add SUPABASE_SERVICE_KEY development
```

---

## Part 4: Keeping Data in Sync

### Option A: Manual Updates (Simplest)

Whenever you update your Google Sheet:

```bash
# Export to Excel, then run:
python scripts/import_from_excel.py --clear --excel-file /path/to/new/file.xlsx
```

### Option B: Scheduled Updates (Recommended)

Set up a GitHub Action to run daily:

1. Push your code to GitHub
2. Add GitHub Secrets:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
3. Create `.github/workflows/sync-data.yml`:

```yaml
name: Sync Marketing Content

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight
  workflow_dispatch:  # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          cd scripts
          pip install -r requirements.txt
      
      - name: Download latest sheet
        run: |
          # Add your Google Sheets export logic here
          # Or download from a shared location
      
      - name: Import to Supabase
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
        run: |
          python scripts/import_from_excel.py --clear
```

### Option C: Real-time Webhook (Advanced)

Create a Google Apps Script that pushes changes to Supabase immediately.
See `scripts/google_apps_script.js` for details.

---

## Part 5: Security & Access

### Database Security (RLS)

Row Level Security is enabled on all tables. The portal uses **anonymous access** (no login required) with the following posture:

- **Read access**: Public for all marketing content, views, and AI context
- **Write access**: Restricted to `service_role` key (used server-side only in Vercel serverless functions)
- **Python scripts**: Use `DATABASE_URL` (direct PostgreSQL), which bypasses RLS entirely

All write operations from the browser (content submission, webhooks) are routed through Vercel serverless proxies that use the `SUPABASE_SERVICE_KEY`:

| Proxy | Project | Purpose |
|-------|---------|---------|
| `/api/supabase-write` | content-submission | INSERT/UPDATE/DELETE on `marketing_content` |
| `/api/webflow-webhook` | frontend | Webflow CMS sync |

See [SECURITY.md](../SECURITY.md) for the full RLS policy matrix.

### Run Security Migration

If deploying from scratch, run the security migration after `schema.sql`:

```bash
# Via Supabase SQL Editor: paste contents of supabase/migrations/20260211_security_fixes.sql
# Or via psycopg2 if you have DATABASE_URL:
python -c "
import psycopg2
conn = psycopg2.connect('your-database-url')
conn.autocommit = True
with open('supabase/migrations/20260211_security_fixes.sql') as f:
    conn.cursor().execute(f.read())
conn.close()
"
```

### Share with Your Team

Simply share the Vercel URL — no login required:
```
https://marketing-content-portal.vercel.app
```

### Add Authentication (Optional)

If you want to restrict read access in the future:
1. Apply `backend/auth-migration.sql` to add Supabase Auth
2. Update RLS policies to require authentication for SELECT
3. See Supabase docs: https://supabase.com/docs/guides/auth

---

## Troubleshooting

### Import Script Fails

**Error**: "Missing Supabase environment variables"
- **Fix**: Make sure you exported the variables or created `.env` file

**Error**: "Permission denied"
- **Fix**: Check your anon key is correct and has proper permissions

### Frontend Won't Load

**Error**: "Missing environment variables"
- **Fix**: Check `.env` file exists and has all required variables

**Error**: "Network error"
- **Fix**: Check Supabase URL is correct and project is running

### Natural Language Queries Don't Work

- **Fix**: Make sure you added `VITE_ANTHROPIC_API_KEY` or `VITE_OPENAI_API_KEY`
- **Fix**: Check API key is valid and has credits
- **Workaround**: App will fallback to keyword search

### Data Not Showing

1. Check Supabase Table Editor - is data there?
2. Open browser console (F12) - any errors?
3. Check network tab - is API call succeeding?

---

## Cost Estimate

### Monthly Costs (assuming 100 queries/day)

- **Supabase**: $0 (free tier: 500MB database, 2GB bandwidth)
- **Vercel**: $0 (free tier: unlimited bandwidth for hobby projects)
- **Anthropic Claude**: ~$3/month (~3,000 queries with $5 credit)
- **OpenAI GPT**: ~$0.60/month (~3,000 queries)

**Total**: $0-3/month

### When You'll Need to Pay

- **Supabase**: When you exceed 500MB or need more than 2GB bandwidth
- **Vercel**: When you add team members (stays free for personal use)
- **AI APIs**: After free credits run out

---

## Next Steps

1. ✅ Share the URL with your marketing team
2. ✅ Train reps on how to use natural language queries
3. ✅ Set up automated data sync
4. ✅ Monitor usage in Supabase dashboard
5. ✅ Customize the UI (colors, logo, etc.)

## Support Resources

- **Supabase Docs**: https://supabase.com/docs
- **Vercel Docs**: https://vercel.com/docs
- **Claude API Docs**: https://docs.anthropic.com
- **React Docs**: https://react.dev

---

## Quick Reference Card

**Import Data**:
```bash
python scripts/import_from_excel.py --clear
```

**Run Locally**:
```bash
cd frontend && npm run dev
```

**Deploy**:
```bash
vercel --prod
```

**Check Stats**:
```sql
SELECT * FROM get_content_stats();
```

**Search Database**:
```sql
SELECT * FROM search_marketing_content('SchoolLinks Nevada');
```

---

Congratulations! Your Marketing Content Portal is now live! 🎉
