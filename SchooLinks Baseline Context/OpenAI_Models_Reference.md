# OpenAI Models Reference

*Last Updated: February 2, 2026*

---

## API Endpoints

### List Available Models
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Retrieve Specific Model
```bash
curl https://api.openai.com/v1/models/gpt-5.2 \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Test Script
Run `./scripts/test_openai_models.sh` to check which models your API key can access.

---

## Our API Key Status (Tested 2026-02-02)

| Model | Status | Used For |
|-------|--------|----------|
| `gpt-4o-mini` | ✅ Working | QUERY_PARSER (simple queries) |
| `gpt-4o` | ✅ Working | STANDARD (topic understanding) |
| `gpt-4.1` | ✅ Working | ADVANCED (complex/sales questions) |
| `gpt-5-mini` | ❌ 400 Error | Not available yet |
| `gpt-5.2` | ❌ 400 Error | Not available yet - switch to this when available |
| `gpt-5-nano` | ❌ 400 Error | Not available yet |
| `o3-mini` | ❌ 400 Error | Not available yet |
| `o4-mini` | ❌ 400 Error | Not available yet |

---

## Frontier / General Text+Vision (Best Default Choices)

| Model ID | Best For | Price per 1M tokens (input / cached / output) |
|----------|----------|----------------------------------------------|
| `gpt-5.2` | Best overall for coding + agentic workflows; supports reasoning.effort | $1.75 / $0.175 / $14.00 |
| `gpt-5-mini` | Cheaper/faster GPT-5 class for well-defined tasks | $0.25 / $0.025 / $2.00 |
| `gpt-5-nano` | Cheapest GPT-5 class; great for summarization/classification | $0.05 / $0.005 / $0.40 |
| `gpt-4.1` | Smartest non-reasoning model; strong instruction following + tool calling | $2.00 / $0.50 / $8.00 |
| `gpt-4o` | Versatile "omni" flagship (text+image in); strong general tasks | $2.50 / $1.25 / $10.00 |
| `gpt-4o-mini` | Fast/cheap for focused tasks; ideal for fine-tuning/distillation | $0.15 / $0.075 / $0.60 |

---

## Coding-Optimized (Codex)

| Model ID | Best For | Price per 1M tokens |
|----------|----------|---------------------|
| `gpt-5.2-codex` | Most intelligent agentic coding model (long-horizon coding) | $1.75 / $0.175 / $14.00 |
| `gpt-5.1-codex` | Agentic coding (GPT-5.1 flavor) | $1.25 / $0.125 / $10.00 |
| `gpt-5.1-codex-max` | Longer running agentic coding | $1.25 / $0.125 / $10.00 |
| `gpt-5.1-codex-mini` | Smaller/cheaper codex option | $0.25 / $0.025 / $2.00 |
| `gpt-5-codex` | Prior GPT-5 codex variant | $1.25 / $0.125 / $10.00 |
| `codex-mini-latest` | Legacy "codex mini" fast reasoning for coding | $1.50 / $0.375 / $6.00 |

---

## Reasoning-Focused (o-series)

| Model ID | Best For | Price per 1M tokens |
|----------|----------|---------------------|
| `o3` | Deep multi-step reasoning across math/science/coding/vision | $2.00 / $0.50 / $8.00 |
| `o3-pro` | More compute for better reasoning | $20.00 / — / $80.00 |
| `o3-mini` | Small reasoning model; supports structured outputs + function calling | $1.10 / $0.55 / $4.40 |
| `o4-mini` | Fast efficient reasoning; strong coding + visual tasks | $1.10 / $0.275 / $4.40 |
| `o1` | Earlier full o-series reasoning model | $15.00 / $7.50 / $60.00 |
| `o1-pro` | More compute (expensive) | $150.00 / — / $600.00 |
| `o1-mini` | Small o1 alternative | $1.10 / $0.55 / $4.40 |

---

## Deep Research Models

| Model ID | Best For | Price per 1M tokens |
|----------|----------|---------------------|
| `o3-deep-research` | Most powerful deep research; web + synthesis | $10.00 / $2.50 / $40.00 |
| `o4-mini-deep-research` | Cheaper deep research | $2.00 / $0.50 / $8.00 |

---

## Smaller 4.1 Variants

| Model ID | Best For | Price per 1M tokens |
|----------|----------|---------------------|
| `gpt-4.1-mini` | Small 4.1 for cheaper tool use + text | $0.40 / $0.10 / $1.60 |
| `gpt-4.1-nano` | Cheapest 4.1 line | $0.10 / $0.025 / $0.40 |

---

## Tool/Specialized Model IDs

### Search-Preview / Tool-Specific
| Model ID | Price |
|----------|-------|
| `gpt-4o-mini-search-preview` | $0.15 / — / $0.60 |
| `gpt-4o-search-preview` | $2.50 / — / $10.00 |
| `computer-use-preview` | $3.00 / — / $12.00 |

### Realtime / Audio I/O
| Model ID | Price |
|----------|-------|
| `gpt-realtime` | $4.00 / $0.40 / $16.00 |
| `gpt-realtime-mini` | $0.60 / $0.06 / $2.40 |
| `gpt-audio` | $2.50 / — / $10.00 |
| `gpt-audio-mini` | $0.60 / — / $2.40 |

### Image Generation (Token-Metered)
- `gpt-image-1.5`
- `chatgpt-image-latest`
- `gpt-image-1`
- `gpt-image-1-mini`

### Embeddings
- `text-embedding-3-small`
- `text-embedding-3-large`
- `text-embedding-ada-002`

### Moderation
- `omni-moderation-latest` (free)

---

## Model ID Usage Notes

### Aliases vs Snapshots
- **Aliases** (recommended): Use `gpt-5.2` for most apps - always points to latest
- **Pinned Snapshots**: Use `gpt-5.2-2025-12-11` for reproducibility

### List Available Models
```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

---

## Marketing Content Portal Model Strategy

### Current Configuration
```javascript
const AI_MODELS = {
  QUERY_PARSER: 'gpt-4o-mini',  // Simple parsing, fast
  STANDARD: 'gpt-5-mini',       // Balanced quality/cost
  ADVANCED: 'gpt-5.2',          // Complex reasoning, state context
};
```

### Routing Logic
| Query Type | Model | Why |
|------------|-------|-----|
| Simple filters ("Texas content") | `gpt-4o-mini` | Fast, cheap |
| Topic understanding | `gpt-5-mini` | Good comprehension |
| Competitor questions | `gpt-5.2` | Deep reasoning needed |
| State compliance (CCMR, HB 773) | `gpt-5.2` | Needs state context understanding |
| Sales objections | `gpt-5.2` | Nuanced responses |

### Cost Optimization
- ~60% queries → gpt-4o-mini ($0.15/1M)
- ~30% queries → gpt-5-mini ($0.25/1M)
- ~10% queries → gpt-5.2 ($1.75/1M)

**Estimated savings vs gpt-5.2 for all: ~70%**
