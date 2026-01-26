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
