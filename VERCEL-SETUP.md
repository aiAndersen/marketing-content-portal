# Vercel Deployment Configuration

> **IMPORTANT: Project Name Typo**
>
> The Vercel project name has a typo: **`marekting-content-portal`** (not "marketing")
>
> This was a mistake when initially setting up the project on Vercel. The typo exists in:
> - Vercel project name
> - Vercel URL: https://marekting-content-portal.vercel.app
> - All CLI commands referencing the project
>
> **Always use `marekting` (not `marketing`) when referencing this Vercel project.**

## Overview

This repository contains two separate Vercel projects:

| Project | Directory | Vercel URL |
|---------|-----------|------------|
| Marketing Content Portal | `frontend/` | https://marekting-content-portal.vercel.app |
| Content Submission Portal | `content-submission/` | https://content-submission.vercel.app |

## Critical Configuration

### Root Directory Setting

Each project must have its **Root Directory** configured in the Vercel dashboard:

- **marekting-content-portal**: Root Directory = `frontend`
- **content-submission**: Root Directory = `content-submission`

### Why This Matters

1. **Local `vercel --prod`** uses settings from `.vercel/` folder (works because it stores root directory locally)
2. **GitHub-triggered deploys** use Vercel dashboard settings (ignores local `.vercel/` folder)
3. The `.vercel/` folder is in `.gitignore` and doesn't sync to GitHub

If Root Directory is not set in the dashboard, GitHub deployments will fail with:
```
sh: line 1: cd: frontend: No such file or directory
```

## How to Configure

### Marketing Content Portal

1. Go to: https://vercel.com/schoolinks-projects/marekting-content-portal/settings/general
2. Set **Root Directory** to: `frontend`
3. Click **Save**
4. Redeploy

### Content Submission Portal

1. Go to: https://vercel.com/schoolinks-projects/content-submission/settings/general
2. Set **Root Directory** to: `content-submission`
3. Click **Save**
4. Redeploy

## Project Structure

```
marketing-content-portal/
├── frontend/                  # Marketing Content Portal (Vite + React)
│   ├── vercel.json           # Framework config for this app
│   ├── package.json
│   └── src/
├── content-submission/        # Submission Portal (separate app)
│   ├── vercel.json
│   ├── package.json
│   └── src/
├── VERCEL-SETUP.md           # This file
└── .gitignore
```

## vercel.json Files

Each app has its own `vercel.json` inside its directory:

**frontend/vercel.json:**
```json
{
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

**content-submission/vercel.json:**
```json
{
  "public": true
}
```

## Re-linking Projects Locally

If you need to re-link a project locally:

```bash
# For Marketing Content Portal
cd frontend
vercel link --yes --scope schoolinks-projects --project marekting-content-portal

# For Content Submission Portal
cd content-submission
vercel link --yes --scope schoolinks-projects --project content-submission
```

## Re-authentication

If Vercel CLI shows "No projects found" or authentication errors:

```bash
vercel login
```

Visit the URL provided and enter the code to authenticate.

## Vercel Project IDs

- **marekting-content-portal**: `prj_YVvShPDpw00hWpyIQmCOlRU4ePRz`
- **Team/Org ID**: `team_vP41S1hLfP118NhQk4yf1Hqc`

## Troubleshooting

### "cd: frontend: No such file or directory"
Root Directory not set in Vercel dashboard. See "How to Configure" above.

### "Git author must have access to the team"
Local deployment requires team access. Use GitHub push instead, or request access from team admin.

### Projects not showing in `vercel project ls`
Re-authenticate with `vercel login` and ensure correct scope with `--scope schoolinks-projects`.

---

## Development Environments

We use a **three-tier deployment pipeline**:

| Environment | Branch | Purpose | Auto-Deploy |
|-------------|--------|---------|-------------|
| **Local** | any | Development & debugging | Manual (`npm run dev`) |
| **Staging** | `staging` | Pre-production testing | Yes, on push |
| **Production** | `main` | Live user-facing apps | Yes, on push |

### Environment URLs

| Project | Staging URL | Production URL |
|---------|-------------|----------------|
| Marketing Content Portal | `staging-marketing.vercel.app`* | https://marekting-content-portal.vercel.app |
| Content Submission Portal | `staging-content-submission.vercel.app`* | https://content-submission.vercel.app |

*\*Staging URLs need to be configured in Vercel Dashboard (see below)*

---

## Git Workflow

```
feature-branch → staging → main
       ↓            ↓        ↓
   preview      staging   production
```

### Working on Features

```bash
# 1. Create feature branch from staging
git checkout staging
git pull origin staging
git checkout -b feature/my-feature

# 2. Make your changes
# ... code ...

# 3. Commit changes
git add <files>
git commit -m "Add feature description"

# 4. Push feature branch (creates preview deployment)
git push origin feature/my-feature
# → Vercel auto-deploys to a preview URL
```

### Deploying to Staging

```bash
# 1. Merge feature into staging
git checkout staging
git pull origin staging
git merge feature/my-feature

# 2. Push to staging
git push origin staging
# → Auto-deploys to staging URLs

# 3. Test in staging environment
# Open staging URLs and validate changes
```

### Promoting to Production

```bash
# After staging is validated:
git checkout main
git pull origin main
git merge staging
git push origin main
# → Auto-deploys to production URLs
```

### Quick Fixes (Skip Staging)

For urgent hotfixes that need to go directly to production:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/urgent-fix
# ... make fix ...
git commit -m "Hotfix: description"
git checkout main
git merge hotfix/urgent-fix
git push origin main

# Then backport to staging:
git checkout staging
git merge main
git push origin staging
```

---

## Configuring Staging in Vercel Dashboard

### Step 1: Set Up Staging Domains

For each project, add a staging domain alias:

1. Go to Vercel Dashboard → Select Project
2. Navigate to **Settings** → **Domains**
3. Click **Add Domain**
4. Enter staging subdomain (e.g., `staging-marketing.vercel.app`)
5. Configure to deploy from `staging` branch

### Step 2: Branch to Domain Mapping

1. Go to **Settings** → **Git**
2. Under **Production Branch**, ensure `main` is set
3. Under **Preview Branches**, the `staging` branch will get a consistent URL

### Step 3: Environment Variables (Optional)

If staging needs different config than production:

1. Go to **Settings** → **Environment Variables**
2. Add variables and select **Preview** environment
3. These will only apply to non-production deployments

---

## Vercel Deployment Behavior

| Trigger | Result |
|---------|--------|
| Push to `main` | Production deployment |
| Push to `staging` | Staging deployment (preview) |
| Push to `feature/*` | Preview deployment (unique URL) |
| Pull Request | Preview deployment with PR comments |

### Preview vs Production Deployments

- **Preview deployments**: Temporary URLs, may have different env vars
- **Production deployments**: Stable URLs, production env vars
- **Staging**: A preview deployment with a stable domain alias

---

## For New Developers

### Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/aiAndersen/marketing-content-portal.git
   cd marketing-content-portal
   ```

2. **Set up local environment**
   ```bash
   # For Marketing Content Portal
   cd frontend
   npm install
   npm run dev  # → http://localhost:5173

   # For Content Submission Portal (in another terminal)
   cd content-submission
   npm install
   npm run dev  # Check package.json for port
   ```

3. **Create a feature branch**
   ```bash
   git checkout staging
   git checkout -b feature/your-feature-name
   ```

4. **Make changes and push**
   ```bash
   git add .
   git commit -m "Description of changes"
   git push origin feature/your-feature-name
   ```

5. **Get a preview URL**
   - Vercel auto-deploys your branch
   - Check GitHub PR or Vercel dashboard for the preview URL

6. **Merge to staging for team testing**
   - Open PR from your branch → `staging`
   - After approval, merge
   - Staging URLs update automatically

7. **Promote to production**
   - Once staging is validated, merge `staging` → `main`
   - Production URLs update automatically

### Key Commands Reference

```bash
# Check current branch
git branch

# Switch to staging
git checkout staging

# Pull latest changes
git pull origin staging

# See deployment status
vercel ls  # (if Vercel CLI is installed)

# View Vercel project in browser
vercel inspect <deployment-url>
```

### Environment Files

- `.env.local` - Local development (not committed)
- Vercel Dashboard - Production/Preview environment variables
- `scripts/.env` - Backend scripts (not committed)
