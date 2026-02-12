# Security Overview

## Marketing Content Portal & Content Submission Portal

**Last Updated:** February 11, 2026

---

## Executive Summary

Both the Marketing Content Portal and Content Submission Portal have been architected with security best practices to protect API credentials and sensitive data. All third-party API calls are proxied through server-side functions, ensuring credentials are never exposed to end users.

---

## API Key Protection

### Server-Side Proxy Architecture

All OpenAI API calls are routed through Vercel serverless functions, keeping API keys secure on the server side.

| Portal | Endpoint | Purpose |
|--------|----------|---------|
| Content Submission | `/api/openai` | AI-powered content parsing |
| Marketing Content | `/api/openai` | Natural language search, chat assistant |
| Marketing Content | `/api/whisper` | Voice-to-text transcription |

**How it works:**
1. Browser makes request to `/api/openai` (same-origin)
2. Serverless function reads API key from environment variable
3. Function makes authenticated request to OpenAI
4. Response is returned to browser
5. API key never leaves the server

### Environment Variable Management

All sensitive credentials are managed through Vercel's environment variable system:

- `OPENAI_API_KEY` - OpenAI API access (server-side only)
- `VITE_SUPABASE_URL` - Supabase project URL (public)
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key (public, RLS-protected)
- `SUPABASE_SERVICE_KEY` - Supabase service role key (server-side only, Vercel env)

**Note:** Supabase anonymous keys are designed to be public. Security is enforced through Row Level Security (RLS) policies on the database. The service role key bypasses RLS and must only be used server-side (Vercel serverless functions).

---

## Data Protection

### Supabase Row Level Security (RLS)

All database tables have RLS enabled with appropriate policies:

| Table | SELECT | INSERT/UPDATE/DELETE | Notes |
|-------|--------|---------------------|-------|
| `marketing_content` | Public (anon) | `service_role` only | Public marketing data; scripts use `DATABASE_URL` (bypasses RLS) |
| `ai_context` | Public (anon) | `service_role` only | AI knowledge base; scripts use `DATABASE_URL` |
| `ai_prompt_logs` | Authenticated only | Public INSERT (logging) | Anonymous users can log search queries |
| `terminology_map` | Public (active only) | Authenticated only | Admin/script vocabulary mappings |
| `log_analysis_reports` | Public | Authenticated INSERT, `service_role` UPDATE | Analysis reports from scripts |

**Views** (`content_type_summary`, `content_by_state`, `content_by_platform`) use `security_invoker = true` to respect the caller's RLS policies.

### No Sensitive Data in Client Code

- API keys are never bundled into JavaScript
- Configuration files with secrets are gitignored
- Build processes pull credentials from environment variables

---

## Source Code Security

### Git Protection

The following files are excluded from version control:

```
# Environment files
.env
.env.local
.env*.local

# Generated config with potential secrets
config.js

# Build artifacts
dist/
```

### No Hardcoded Secrets

- All API keys are stored in Vercel environment variables
- Local development uses `.env.local` (gitignored)
- Build scripts validate required environment variables

---

## Infrastructure Security

### Vercel Platform Security

- All traffic served over HTTPS
- Automatic SSL certificate management
- DDoS protection included
- SOC 2 Type 2 compliant hosting

### Deployment Protection

- Preview deployments require Vercel authentication
- Production deployments are public-facing
- All deployments are immutable (no runtime modifications)

---

## Compliance Checklist

| Requirement | Status |
|-------------|--------|
| API keys not exposed in browser | ✅ Implemented |
| HTTPS enforcement | ✅ Automatic via Vercel |
| Environment variable management | ✅ Vercel dashboard |
| Secrets not in git repository | ✅ .gitignore configured |
| Database access control | ✅ Supabase RLS |
| Audit logging | ✅ Vercel & Supabase logs |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │ Content Portal  │    │ Marketing Content Portal        │ │
│  └────────┬────────┘    └────────────────┬────────────────┘ │
└───────────┼──────────────────────────────┼──────────────────┘
            │                              │
            │ /api/openai                  │ /api/openai
            │ (no API key)                 │ /api/whisper
            ▼                              ▼
┌───────────────────────────────────────────────────────────────┐
│                  Vercel Serverless Functions                   │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  process.env.OPENAI_API_KEY  (secure, never exposed)    │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                │ Authorization: Bearer sk-...
                                ▼
                    ┌───────────────────────┐
                    │   OpenAI API          │
                    │   api.openai.com      │
                    └───────────────────────┘
```

---

## Incident Response

If you suspect a security issue:

1. **API Key Compromise:** Rotate immediately in OpenAI dashboard and update Vercel environment variables
2. **Unauthorized Access:** Review Vercel and Supabase audit logs
3. **Data Breach:** Contact security team and review RLS policies

---

## Contact

For security questions or to report vulnerabilities, contact the development team.
