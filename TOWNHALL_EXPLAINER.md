# SchooLinks Marketing Content Portal — App Explainer

> This document is intended to be fed to an AI agent to help prepare a town hall
> presentation for a mixed audience: engineers, sales, customer success, and executives.
> Adjust tone and depth per section as needed for your audience.

---

## What Is This App?

The **SchooLinks Marketing Content Portal** is an internal tool that gives every marketing
rep, sales rep, and customer success manager instant access to SchooLinks' entire library
of marketing content — blogs, videos, customer stories, 1-pagers, ebooks, and more.

Instead of digging through shared drives, Slack threads, or HubSpot folders to find the
right piece of content, a rep can type a plain-English question and get the right answer
in seconds.

**Example queries:**
- *"Customer stories from Texas about college readiness"*
- *"Videos I can send a school counselor in Virginia"*
- *"One-pagers comparing us to Xello"*
- *"costumer storys from texs"* ← yes, typos work too

---

## Who Uses It?

| Role | How they use it |
|------|----------------|
| **Sales reps** | Find the right content to send a prospect before or after a demo |
| **Customer success** | Pull state-specific resources for onboarding and QBRs |
| **Marketing** | See what content exists, identify gaps, submit new content |
| **Executives** | Review the weekly GTM report for content pipeline visibility |

---

## What Can It Do? (The Five Views)

### 1. Content Search
Natural language search across the entire content library. Type anything — the app
understands typos, synonyms, and intent. Results are ranked by relevance and filterable
by content type, state, and platform.

### 2. Chat Assistant
A conversational AI interface. Ask follow-up questions, get recommendations with
explanations, and have a back-and-forth dialogue about what content to use and why.
Voice input (speak your question) is also supported via microphone.

### 3. Weekly GTM Report
Auto-generated weekly summary of new and updated content, organized for Go-To-Market
meetings. Can be downloaded or copied directly into a slide deck or email.

### 4. Content Feed
A visual card-based browser of recent content with thumbnails — similar to a social
media feed but for internal marketing assets.

### 5. Database Viewer
A raw table view for power users and marketing ops — filter, sort, and inspect every
field of every content record.

---

## How Does the Search Actually Work?

This is the most important thing to understand, especially regarding AI cost.

### Step 1 — AI parses your query (once, cheaply)
When you hit Search, your query goes to OpenAI **one time**. The AI reads your sentence
and extracts structured parameters:
- What terms are you searching for? (`["college readiness", "counselor"]`)
- What content types? (`["Video", "1-Pager"]`)
- What state? (`["TX"]`)
- What's the intent? (finding content, comparing competitors, answering a question)

This single API call costs a fraction of a cent. It uses a small, fast model (`gpt-5-mini`)
for most queries.

### Step 2 — The database does the heavy lifting (free)
The extracted terms are sent as a standard database query to **Supabase** (PostgreSQL).
The database searches across title, summary, tags, extracted text, and video transcripts
using SQL `LIKE` matching. No AI is involved in this step. It's just a database query —
fast and free.

### Step 3 — AI re-ranks the results (once, cheaply)
The raw database results come back. OpenAI is called **one more time** to re-order them
by relevance to your original question. This ensures the most useful results surface first.

### Why this matters for cost
- AI is called **at most twice per search** — regardless of how many results come back
- Fetching 500 results does not cost more than fetching 5 results
- The expensive work (reading and understanding your language) happens once, upfront
- The database (not AI) handles the bulk retrieval — databases are designed for that

### For complex queries
For competitor analysis or complex sales questions, the app automatically routes to a
more powerful model (`gpt-5.2`). For simple parsing tasks, it uses the cheapest model
(`gpt-4o-mini`). This routing is automatic and transparent to the user.

---

## How Is Content Added?

There is a separate **Content Submission Portal** where marketing can add new pieces:

1. Paste a URL (YouTube video, HubSpot PDF, blog post, etc.)
2. The app automatically extracts the content — reads the page, fetches the video
   transcript, extracts text from PDFs
3. AI pre-fills all the metadata fields: title, summary, tags, content type, state
4. A human reviews and submits

This means the content library stays current without manual data entry.

---

## What Data Does It Store?

Every piece of content in the database has:
- **Title, URL, type, platform, state**
- **Summary** — human-written or AI-generated description
- **Tags** — specific topics, features, personas (e.g., `FAFSA`, `counselors`, `KRI`)
- **Extracted text** — the full text pulled from the page or PDF
- **Transcript** — full spoken transcript for YouTube videos (new)
- **Keywords** — AI-generated weighted relevance scores for search

The database is hosted on **Supabase** (managed PostgreSQL in the cloud). All AI calls
go through a secure server-side proxy — API keys are never exposed to the browser.

---

## What's New: YouTube Transcript Search

Previously, searching for a topic only matched against a video's title, tags, and summary.
If a presenter said something in a video but it wasn't in the description, you couldn't
find it.

Now, full video transcripts are stored in the database. Searching for *"FAFSA completion
rates"* will surface a video where the presenter discusses that topic at length — even if
those words aren't in the title or tags.

This makes video content as searchable as written content.

---

## Automation Running in the Background

The portal runs automated maintenance jobs that keep the content library healthy:

| What it does | When |
|---|---|
| Health check — monitors search quality | Every day, 5:30 AM |
| Analyzes failed/zero-result searches | Every day, 6 AM |
| Enriches new content with AI summaries | Every day, 7 AM |
| Cleans up duplicate/bad tags | Every day, 8 AM |
| Full content audit | Every Monday, 9 AM |
| Imports new content from Webflow/HubSpot | Every Monday, 10 AM |

These jobs run automatically — no human action required.

---

## Technology Stack (for engineers)

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + Vite (deployed on Vercel) | The UI |
| Database | Supabase (PostgreSQL) | Content storage and search |
| AI | OpenAI (gpt-4o-mini / gpt-5-mini / gpt-5.2) | NLP, ranking, chat |
| Voice input | OpenAI Whisper | Speech-to-text in chat |
| Content ingestion | Python scripts | Automated imports and enrichment |
| Hosting | Vercel | Frontend + serverless API routes |

---

## Key Design Decisions

**AI is used surgically, not everywhere.** The database does the heavy lifting. AI is
invoked only where human language understanding adds real value: parsing queries,
re-ranking results, and generating conversational answers.

**API keys never touch the browser.** All OpenAI calls go through a server-side proxy
(`/api/openai`). Users cannot extract or abuse the API key from the browser.

**Models are matched to task complexity.** Simple tasks use cheap models. Complex
competitive analysis uses the most capable model. This keeps costs low without
sacrificing quality where it matters.

**Content submission is AI-assisted, not AI-automated.** A human always reviews before
anything is published to the database. The AI fills in fields; a person confirms them.

---

## Questions This Document Can Help You Answer

- What does this tool do and who is it for?
- How does the AI search work without burning through our OpenAI budget?
- Why can't I just use a shared Google Drive folder? (Answer: you can't ask a Drive folder
  *"show me customer stories for a Texas counselor audience"* and get ranked, filtered results)
- How does new content get into the system?
- What happens if AI goes down? (The database search still works; AI re-ranking is
  a best-effort enhancement, not a hard dependency)
- Is our data secure? (Yes — the database is private, API keys are server-side only)
