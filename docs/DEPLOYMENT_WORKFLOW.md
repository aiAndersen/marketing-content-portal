# Deployment Workflow

## Overview

All changes must follow this workflow:

```
Local Development → Staging → Production
```

**Never push directly to main.** All changes must be tested on staging first.

---

## Workflow Steps

### 1. Local Development

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Make changes and test locally
npm run dev

# Verify changes work as expected
# Test in browser at http://localhost:5173
```

### 2. Commit Changes

```bash
# Stage specific files (avoid git add -A)
git add src/components/YourFile.jsx

# Commit with descriptive message
git commit -m "feat: description of changes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

### 3. Push to Staging

```bash
# Push to staging branch
git checkout staging
git merge feature/your-feature-name
git push origin staging
```

**Wait for Vercel to deploy.** Check the staging URL:
- Marketing Content Portal: https://marketing-content-portal-staging.vercel.app
- Content Submission Portal: https://content-submission-staging.vercel.app

### 4. Test on Staging

- [ ] Core functionality works
- [ ] No console errors
- [ ] AI responses are correct
- [ ] Model routing works (check console for `[Model Selection]` logs)
- [ ] State context loads (check console for `[Chat] Loaded state context`)
- [ ] Mobile responsive (if applicable)

### 5. Merge to Production

Only after staging is verified:

```bash
git checkout main
git merge staging
git push origin main
```

Vercel will auto-deploy to production URLs.

---

## Branch Structure

| Branch | Purpose | URL |
|--------|---------|-----|
| `feature/*` | Development | Local only |
| `staging` | Testing | staging.vercel.app |
| `main` | Production | vercel.app |

---

## Hotfix Workflow

For critical bugs in production:

```bash
# Create hotfix from main
git checkout main
git checkout -b hotfix/critical-bug

# Fix the issue
# ... make changes ...

# Commit
git commit -m "fix: critical bug description"

# Deploy to staging first
git checkout staging
git merge hotfix/critical-bug
git push origin staging

# TEST ON STAGING

# Then deploy to production
git checkout main
git merge hotfix/critical-bug
git push origin main
```

---

## Database Migrations

Database changes require extra care:

1. **Create migration file** in `supabase/migrations/`
2. **Test locally** with Supabase CLI or local DB
3. **Run on staging** via Supabase Dashboard (SQL Editor)
4. **Verify staging** works with new schema
5. **Run on production** only after staging verification

---

## Environment Variables

- Local: `.env.local` (gitignored)
- Staging: Vercel Dashboard → Project Settings → Environment Variables → Preview
- Production: Vercel Dashboard → Project Settings → Environment Variables → Production

**Never commit `.env` files or hardcode secrets.**

---

## Checklist Before Merging to Main

- [ ] Tested locally
- [ ] Pushed to staging
- [ ] Tested on staging
- [ ] No console errors
- [ ] Performance acceptable
- [ ] Database migrations applied (if any)
- [ ] Documentation updated (if needed)

---

## Common Commands

```bash
# Start local development
npm run dev

# Build for production
npm run build

# Push to staging
git push origin staging

# Merge staging to main
git checkout main && git merge staging && git push origin main

# Import state context to database
python scripts/import_state_context.py --include-baseline

# View deployment logs
vercel logs
```

---

*Last Updated: February 2, 2026*
