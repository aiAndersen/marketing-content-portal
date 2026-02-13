# Marketing Content Enrichment Guide

How the Marketing Content Portal enriches content with AI-generated metadata, extracted text, and structured keywords to power the AI search assistant.

## Pipeline Overview

```
DATA SOURCES                         ENRICHMENT                        DATABASE

Webflow CMS ──────┐                                                    marketing_content
HubSpot Files ────┤                  ┌── enrich_content.py ──────┐     ├── enhanced_summary
YouTube ──────────┤  ──> import ──>  ├── enrich_youtube.py ──────┤     ├── auto_tags
Google Drive ─────┤                  ├── enrich_deep.py (GPT-5.2)┤ ──> ├── keywords (JSONB)
Excel/Manual ─────┘                  ├── enrich_hubspot_pdfs.py ─┤     ├── extracted_text
                                     └── enrich_video_states.py ─┘     └── deep_enriched_at
```

## Script Inventory

### Import Scripts (bring content into the database)

| Script | Source | What It Does | Auth |
|--------|--------|-------------|------|
| `import_webflow_resources.py` | Webflow CMS | Imports published resources (Blog, Video, Ebook, etc.) | Webflow API token |
| `import_webflow_landing_pages.py` | Webflow | Imports state pages, competitor pages, feature pages | Webflow API token |
| `import_hubspot_files.py` | HubSpot File Manager | Imports PDFs and documents, auto-detects content type | HubSpot Private App token |
| `import_from_excel.py` | Excel spreadsheet | Bulk import from "Marketing Content Portal" spreadsheet | None |
| `import_google_drive.py` | Google Drive | Scans shared folders, extracts Google Docs/PDFs/DOCX | Service account |

### Enrichment Scripts (add AI metadata to existing records)

| Script | Model | What It Generates | Rate |
|--------|-------|------------------|------|
| `enrich_content.py` | gpt-4o-mini | enhanced_summary, auto_tags, extracted_text | 1s delay |
| `enrich_content_parallel.py` | gpt-4o-mini | Same as above but multi-threaded (5 workers) | 1s delay |
| `enrich_youtube.py` | gpt-4o-mini | Transcript extraction + summary/tags/competitors | 0.5s delay |
| `enrich_video_tags.py` | gpt-4o-mini | Title-based tags for videos without transcripts | 0.5s delay |
| `enrich_video_states.py` | gpt-4o-mini | State inference from content (pattern + AI) | 0.5s delay |
| `enrich_hubspot_pdfs.py` | gpt-4o-mini | PDF text extraction + tags/summary | 1s delay |
| `enrich_from_webflow.py` | N/A | Pulls Webflow CMS body content, no AI | 0.2s delay |
| `enrich_comprehensive.py` | N/A | Multi-source: Webflow, YouTube retry, competitors | varies |
| **`enrich_deep.py`** | **gpt-5.2** | **Weighted keywords (JSONB), rich summary, quality assessment** | **2s delay** |
| `enrich_pdf_text.py` | gpt-4o-mini | Re-extracts real PDF text from ungated_link for records with bad extracted_text | 1s delay |

### Data Cleanup Scripts (fix data quality issues)

| Script | What It Does |
|--------|-------------|
| `fix_tag_format.py` | Converts PostgreSQL array tags `{a, "b"}` to clean comma-separated `a, b` |

### Analysis Scripts (analyze search patterns)

| Script | Model | What It Does |
|--------|-------|-------------|
| `log_analyzer.py` | gpt-4o-mini | Analyzes prompt logs, identifies issues, suggests terms |
| `query_popularity_report.py` | gpt-4o-mini + **gpt-5.2** | Popularity ranking, content gaps, AI content recommendations |

## Database Columns

### Core Content Fields
| Column | Type | Source |
|--------|------|--------|
| `title` | TEXT | Import scripts |
| `type` | TEXT | Import scripts (Blog, Video, 1-Pager, Ebook, etc.) |
| `summary` | TEXT | Import scripts (original) |
| `state` | TEXT | Import scripts / enrich_video_states.py |
| `tags` | TEXT | Import scripts + enrichment (comma-separated) |
| `live_link` | TEXT | Import scripts |
| `ungated_link` | TEXT | Import scripts (direct PDF links) |

### Enrichment Fields
| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `enhanced_summary` | TEXT | All enrich scripts | AI-generated 2-5 sentence summary |
| `auto_tags` | TEXT | All enrich scripts | AI-generated tags (comma-separated) |
| `extracted_text` | TEXT | All enrich scripts | First 5000 chars of extracted content |
| `content_analyzed_at` | TIMESTAMP | All enrich scripts | When basic enrichment was done |
| `extraction_error` | TEXT | All enrich scripts | Error message if extraction failed |
| `keywords` | JSONB | `enrich_deep.py` | Weighted keywords: `[{"keyword": "FAFSA", "weight": 0.95, "category": "topic"}]` |
| `deep_enriched_at` | TIMESTAMP | `enrich_deep.py` | When deep enrichment was done |

## What Works Well

- **YouTube transcripts** (~70% success): Most videos have auto-generated captions. Handles multiple URL formats and language fallback.
- **PDF text extraction** (text-based PDFs): PyPDF2 reliably extracts text from standard text-based PDFs up to 15 pages.
- **Webflow CMS pull**: Direct API access to the `body` HTML field, reliable and fast.
- **Web page scraping**: Standard HTML pages scrape well with BeautifulSoup (scripts/styles/nav removed).
- **AI tag generation** (gpt-4o-mini): Fast, cheap, accurate when given extracted content. Selective tagging avoids false positives.
- **State inference**: Pattern matching catches ~60% of cases, AI handles the rest with confidence scoring.
- **Deep enrichment** (gpt-5.2): Produces richer, weighted keywords with categories for better search matching.

## What Doesn't Work

- **Scanned/image PDFs**: PyPDF2 cannot OCR images. These return empty text. Would need Tesseract or a cloud OCR service. (1 of 43 ebooks was a scanned PDF — "Hope Toolkit")
- **JavaScript-rendered pages**: BeautifulSoup only sees the initial HTML. SPAs and dynamic content won't be extracted. Would need Playwright/Selenium.
- **Authenticated pages**: Content behind login walls cannot be scraped. HubSpot landing pages with forms are partially accessible.
- **Videos without transcripts**: ~30% of YouTube videos have transcripts disabled. Falls back to title-based tagging (less accurate).
- **Rate limiting**: YouTube transcript API and OpenAI have rate limits. Large batch runs need appropriate delays.

## Known Issues (Resolved)

- **Webflow resource page wrapper text**: When `import_webflow_resources.py` imports ebooks/1-pagers, it scrapes the Webflow `/resource/` page (which just repeats the title) instead of downloading the actual PDF from `ungated_link`. Fixed by `enrich_pdf_text.py` which downloads and extracts real PDF content. (43 records affected, 42 fixed)
- **PostgreSQL array tag format**: Some import paths stored tags as `{a, "b", c}` instead of `a, b, c`. Fixed by `fix_tag_format.py`. (279 records affected, all fixed)
- **Missing sitemap pages**: The `import_webflow_landing_pages.py` script had stale URL patterns (used `/product/` instead of `/platform/`). Updated to match current SchooLinks.com sitemap. (16 pages added)

## API Connections

### Webflow CMS (v2 API)
- **Auth**: Bearer token (`WEBFLOW_API_TOKEN`)
- **What we get**: Published resources (title, body HTML, slug, type, topics)
- **Collections**: Resources (`6751db0aa481dcef9c9f387a`), Types, Topics
- **Enrichment potential**: Body content is rich HTML that can be parsed for summaries and tags

### HubSpot File Manager
- **Auth**: Private App token (`HUBSPOT_API_KEY`)
- **What we get**: PDF files, documents, images from File Manager
- **API**: `/files/v3/files` with pagination
- **Enrichment potential**: PDFs contain whitepapers, 1-pagers, case studies with extractable text

### YouTube Transcript API
- **Auth**: None required
- **What we get**: Auto-generated and manual captions/transcripts
- **Enrichment potential**: Full spoken content from videos, typically 2000-15000 chars per video

### Google Drive (NEW)
- **Auth**: Service account JSON key (`GOOGLE_SERVICE_ACCOUNT_KEY_PATH`)
- **What we get**: Google Docs, Sheets, PDFs, DOCX files from shared folders
- **Setup**: Create GCP project, enable Drive API, create service account, share folder
- **Enrichment potential**: Internal documents, drafts, content briefs, sales collateral

### OpenAI
- **Auth**: API key (`OPENAI_API_KEY`)
- **Models used**: gpt-4o-mini (basic enrichment), gpt-5.2 (deep enrichment + gap analysis)
- **Enrichment potential**: Summary generation, tag extraction, keyword weighting, content recommendations

## How to Enrich Further

### Re-run deep enrichment
```bash
# Process all content that hasn't been deeply enriched
python scripts/enrich_deep.py

# Re-process everything with latest model
python scripts/enrich_deep.py --force --model gpt-5.2

# Test with a small batch first
python scripts/enrich_deep.py --limit 5 --dry-run -v
```

### Add a new content source
1. Create `scripts/import_<source>.py` following the pattern in `import_hubspot_files.py`
2. Connect to the source API and list available content
3. Map fields to `marketing_content` columns (type, title, live_link, platform, etc.)
4. Insert with deduplication (check existing title/URL)
5. Run enrichment: `python scripts/enrich_deep.py --limit 20`

### Fix PDF text for ebooks/1-pagers
```bash
# Preview which records have bad extracted text
python scripts/enrich_pdf_text.py --dry-run -v

# Extract real PDF text + regenerate AI tags/summaries
python scripts/enrich_pdf_text.py --re-enrich

# Re-extract all PDFs (even ones that already have good text)
python scripts/enrich_pdf_text.py --force --re-enrich
```

### Fix tag format issues
```bash
# Preview records with curly-brace tags
python scripts/fix_tag_format.py --dry-run

# Clean up all affected records
python scripts/fix_tag_format.py
```

### Improve tag quality
- Edit the AI prompts in enrichment scripts to be more/less selective
- Add domain-specific context to the system prompt (SchooLinks products, personas, competitors)
- Use `--force` flag to re-enrich with updated prompts

### Run the full analysis pipeline
```bash
# 1. Run deep enrichment on new content
python scripts/enrich_deep.py

# 2. Run comprehensive analysis with AI recommendations
python scripts/query_popularity_report.py --days 30 --advanced -v

# 3. Check results in Admin Reports tab
# Navigate to localhost:3000/#admin -> Reports tab
```

## Cost Considerations

| Model | Cost per 1M tokens | Typical per record | Full run (~636 records) |
|-------|--------------------|--------------------|------------------------|
| gpt-4o-mini | $0.15 input / $0.60 output | ~$0.003 | ~$2 |
| gpt-5.2 | $2.00 input / $8.00 output | ~$0.04 | ~$25 |

**Tips:**
- Use `--limit` to test with small batches before full runs
- Use `--dry-run` to preview what would be processed
- Basic enrichment (gpt-4o-mini) is cheap enough to run frequently
- Deep enrichment (gpt-5.2) is best run periodically or on new content only
