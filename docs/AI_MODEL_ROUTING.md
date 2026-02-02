# AI Model Routing Logic

## Overview

The Marketing Content Portal uses a multi-model strategy to balance cost and quality for AI-powered search. Different query complexities are routed to appropriate OpenAI models.

---

## Model Configuration

| Model | Cost (per 1M tokens) | Use Case |
|-------|---------------------|----------|
| `gpt-4o-mini` | $0.15 / $0.60 | Simple parsing, basic queries |
| `gpt-5-mini` | $0.25 / $2.00 | Standard searches, topic understanding |
| `gpt-5.2` | $1.75 / $14.00 | Complex sales questions, comparisons |

---

## Routing Logic

### Simple Queries → `gpt-4o-mini`

**Criteria:**
- Less than 5 words
- No comparison/why language
- Matches simple patterns like:
  - "Show me webinars"
  - "Texas content"
  - "Videos from 2024"

**Examples:**
- "Show me all webinars"
- "Texas content"
- "Videos from 2024"
- "Case studies about high schools"

---

### Standard Queries → `gpt-5-mini`

**Criteria (any match triggers):**
- Topic/theme understanding: `about`, `explaining`, `regarding`
- Persona-specific: `for counselors`, `for superintendents`, `for admins`
- Outcome-focused: `improve`, `increase`, `track`, `measure`, `outcomes`
- Feature with context: `fafsa tracking`, `graduation completion`
- 6+ words in query

**Examples:**
- "Customer stories about improving graduation rates"
- "Content explaining FAFSA completion tracking"
- "Materials for superintendents about student outcomes"
- "Resources about career assessments for counselors"
- "Post-secondary planning tools for middle school"

---

### Advanced Queries → `gpt-5.2`

**Auto-route triggers (any match):**

| Indicator | Pattern | Example |
|-----------|---------|---------|
| Competitor names | `naviance`, `xello`, `ccgi`, `scoir`, `majorclarity`, `powerschool`, `kuder`, `youscience` | "How do we compare to Xello?" |
| Comparison language | `vs`, `versus`, `compared to`, `better than`, `difference`, `alternative` | "SchooLinks vs Naviance" |
| Why/How about SchooLinks | `why should`, `how does schoolinks`, `what makes` | "Why should districts choose SchooLinks?" |
| State legislation | `HB 773`, `SB 3`, `RIDE framework`, `CCMR`, `ICAP`, `ECAP`, `PGP`, `ILP`, `HSBP` | "Texas HB 773 compliance" |
| ROI with specifics | `roi/cost/savings` + `proof/evidence/data` | "ROI proof points for counselor time savings" |
| Multi-feature queries | `and/plus/with` + `tracking/compliance/engagement` | "FAFSA tracking and family engagement" |
| Sales objections | `objection`, `concern`, `pushback`, `migration`, `switch from` | "Address migration concerns from Naviance" |
| Evidence requests | `proof points`, `evidence`, `demonstrate` | "Show evidence for graduation rate improvements" |

**Examples:**
- "Compare SchooLinks vs Xello for Texas CCMR compliance with HB 773"
- "How do we address Naviance customers concerned about data migration?"
- "What evidence do we have for ROI claims about counselor time savings?"
- "Find content showing how SchooLinks handles ICAP requirements AND CTE tracking"
- "What's our positioning for districts currently using CCGI?"

---

## Prompt Logging

Complex queries (standard + advanced) are logged to the `ai_prompt_logs` table for:

1. **Pattern Analysis**: Identify common complex query patterns
2. **Agent Improvement**: Train smarter agents based on real queries
3. **Cost Optimization**: Understand model usage distribution
4. **Q&A Dataset Building**: Build FAQ/knowledge base from real questions

### Logged Data

| Field | Description |
|-------|-------------|
| `query` | The user's original query text |
| `complexity` | `simple`, `standard`, or `advanced` |
| `model_used` | The OpenAI model selected |
| `detected_states` | US state codes found in query |
| `query_type` | `search`, `product_question`, `competitor_question` |
| `matched_indicators` | Which routing rules triggered |
| `timestamp` | When the query was made |

---

## State-Specific Context

When state codes are detected, state-specific terminology is injected into the prompt:

| State | Quick Reference |
|-------|----------------|
| TX | CCMR indicators, HB 5 endorsements, HB 773 IBC requirements, PGP plans |
| CO | ICAP, MyColoradoJourney, QCPF |
| MI | EDP, MME assessments, Sixty by 30 |
| WI | ACP, PI 26 requirements, WBL criteria |
| NE | CCR Ready framework, Personal Learning Plans, Perkins V |
| UT | PCCR indicators, First Credential initiative, HB260 |
| FL | Scholar designation, graduation pathways, career academies |
| CA | College/Career Indicator (CCI), A-G requirements, CTE pathways |
| NY | CDOS credential, graduation pathways, CTE endorsements |
| OH | Graduation seals, career passport, OhioMeansJobs readiness seal |

---

## Function Routing

| Function | Default Model | Dynamic? |
|----------|---------------|----------|
| `convertNaturalLanguageToQuery()` | `gpt-4o-mini` | No (always fast) |
| `rankResultsByRelevance()` | `gpt-5-mini` | No (always standard) |
| `processConversationalQuery()` | Varies | Yes (complexity-based) |

---

## Cost Estimation

Based on typical usage patterns:

| Query Type | % of Traffic | Model | Relative Cost |
|------------|--------------|-------|---------------|
| Simple | ~60% | gpt-4o-mini | 1x |
| Standard | ~30% | gpt-5-mini | 1.7x |
| Advanced | ~10% | gpt-5.2 | 12x |

**Estimated savings vs using gpt-5.2 for everything:** ~70% reduction in API costs

---

## Files Modified

- `frontend/src/services/nlp.js` - Model routing logic
- `frontend/src/components/ChatInterface.jsx` - Title/description fix
- `supabase/migrations/20260202_ai_prompt_logs.sql` - Prompt logging table

---

## Testing

### Verify Model Routing

Open browser console and search:

1. **Simple**: "show me videos" → Should log `SIMPLE`
2. **Standard**: "content for counselors about FAFSA" → Should log `STANDARD`
3. **Advanced**: "compare Xello vs SchooLinks for Texas CCMR" → Should log `ADVANCED`

### Verify Title/Description Fix

1. Search "Texas customer stories"
2. Check that Pflugerville card shows Pflugerville summary (not Liberty Hill)
3. Verify descriptions come from database `item.summary`, not AI-generated `rec.reason`

---

*Last Updated: February 2, 2026*
