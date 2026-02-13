#!/usr/bin/env python3
"""
Query Popularity & Content Gap Analysis Report
Comprehensive analytics for the Marketing Content Portal's AI Search Assistant.

Pulls all logged user queries from ai_prompt_logs, analyzes popularity,
identifies content gaps, suggests terminology improvements, and saves
results to the database for the admin UI's self-healing feedback loop.

Part of the "Terminology Brain" self-improvement system.

Usage:
    python scripts/query_popularity_report.py
    python scripts/query_popularity_report.py --days 30
    python scripts/query_popularity_report.py --start 2026-02-01 --end 2026-02-10
    python scripts/query_popularity_report.py --output report.json --csv popularity.csv
    python scripts/query_popularity_report.py --dry-run --verbose
"""

import os
import sys
import json
import csv
import re
import argparse
from datetime import datetime, timedelta
from decimal import Decimal
from collections import Counter, defaultdict

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Optional OpenAI import (script works without it)
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Configuration
ANALYSIS_MODEL = 'gpt-4o-mini'          # For terminology suggestions (cheap, fast)
ADVANCED_MODEL = 'gpt-5.2'              # For deep gap analysis + executive summary
LOW_RECOMMENDATION_THRESHOLD = 2
BATCH_SIZE = 20

COMPETITOR_KEYWORDS = [
    'naviance', 'xello', 'scoir', 'majorclarity', 'powerschool',
    'kuder', 'youscience', 'maia', 'maialearning', 'ccgi'
]

CONTENT_TYPE_KEYWORDS = [
    'video', 'webinar', 'ebook', 'blog', 'case study', 'customer story',
    '1-pager', 'one pager', 'fact sheet', 'whitepaper', 'brochure',
    'press release', 'award', 'landing page', 'asset', 'video clip'
]

FEATURE_KEYWORDS = [
    'kri', 'plp', 'ilp', 'ecap', 'pulse', 'game of life', 'transcript',
    'cam', 'college app', 'course planner', 'graduation', 'scheduler',
    'career exploration', 'interest profiler', 'work-based learning'
]

PERSONA_KEYWORDS = [
    'counselor', 'administrator', 'principal', 'superintendent', 'parent',
    'student', 'cte', 'teacher', 'coordinator', 'director'
]

TOPIC_KEYWORDS = [
    'fafsa', 'financial aid', 'wbl', 'work-based learning', 'internship',
    'career readiness', 'college readiness', 'ccmr', 'sel', 'social emotional',
    'ccr', 'post-secondary', 'dual enrollment', 'cte', 'equity'
]

US_STATES = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
}


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


# =============================================================================
# Database Functions
# =============================================================================

def connect_to_database():
    """Connect to Supabase database."""
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        print("Set it in scripts/.env or export it:")
        print("  export DATABASE_URL='postgresql://...'")
        sys.exit(1)
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_openai_client():
    """Get OpenAI client, or None if unavailable."""
    if not OPENAI_AVAILABLE:
        print("  OpenAI package not installed. AI sections will be skipped.")
        return None
    if not OPENAI_API_KEY:
        print("  OPENAI_API_KEY not set. AI sections will be skipped.")
        return None
    return OpenAI(api_key=OPENAI_API_KEY)


def fetch_all_logs(conn, days=9999, start_date=None, end_date=None):
    """Fetch prompt logs for the specified time range."""
    cur = conn.cursor()

    if start_date and end_date:
        query = """
            SELECT
                id, query, complexity, model_used, detected_states,
                query_type, matched_indicators, recommendations_count,
                ai_quick_answer, response_time_ms,
                session_id, created_at
            FROM ai_prompt_logs
            WHERE created_at >= %s AND created_at <= %s
            ORDER BY created_at DESC
        """
        cur.execute(query, (start_date, end_date))
    else:
        query = """
            SELECT
                id, query, complexity, model_used, detected_states,
                query_type, matched_indicators, recommendations_count,
                ai_quick_answer, response_time_ms,
                session_id, created_at
            FROM ai_prompt_logs
            WHERE created_at >= NOW() - INTERVAL '%s days'
            ORDER BY created_at DESC
        """
        cur.execute(query, (days,))

    logs = cur.fetchall()
    cur.close()
    return logs


def fetch_terminology_mappings(conn):
    """Fetch active terminology mappings grouped by type."""
    cur = conn.cursor()
    cur.execute("""
        SELECT map_type, user_term, canonical_term
        FROM terminology_map
        WHERE is_active = true
    """)

    mappings = {}
    for row in cur.fetchall():
        if row['map_type'] not in mappings:
            mappings[row['map_type']] = {}
        mappings[row['map_type']][row['user_term']] = row['canonical_term']

    cur.close()
    return mappings


def fetch_marketing_content(conn):
    """Fetch all marketing content for cross-referencing (includes enrichment data)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT type, title, summary, platform, state, tags,
               enhanced_summary, auto_tags, keywords
        FROM marketing_content
    """)
    content = cur.fetchall()
    cur.close()
    return content


# =============================================================================
# Section 1: Query Popularity Ranking
# =============================================================================

def generate_popularity_ranking(logs):
    """Normalize, deduplicate, and rank queries by frequency."""
    query_groups = defaultdict(list)

    for log in logs:
        normalized = (log['query'] or '').strip().lower()
        if not normalized:
            continue
        query_groups[normalized].append(log)

    ranking = []
    for query_text, entries in query_groups.items():
        count = len(entries)
        recs = [e['recommendations_count'] or 0 for e in entries]
        times = [e['response_time_ms'] for e in entries if e['response_time_ms']]
        complexities = list(set(e['complexity'] for e in entries if e['complexity']))
        query_types = list(set(e['query_type'] for e in entries if e['query_type']))

        ranking.append({
            'query': query_text,
            'count': count,
            'avg_recommendations': round(sum(recs) / len(recs), 2) if recs else 0,
            'avg_response_time_ms': round(sum(times) / len(times)) if times else 0,
            'complexities': complexities,
            'query_types': query_types,
        })

    ranking.sort(key=lambda x: x['count'], reverse=True)

    # Add rank numbers
    for i, item in enumerate(ranking):
        item['rank'] = i + 1

    return ranking


# =============================================================================
# Section 2: Content Gap Analysis
# =============================================================================

def generate_content_gap_analysis(popularity_ranking, content_inventory):
    """Identify popular queries with poor results, cross-ref against content."""
    gaps = []

    # Build a searchable text index from content
    content_texts = []
    for item in content_inventory:
        text = ' '.join(filter(None, [
            (item.get('title') or '').lower(),
            (item.get('summary') or '').lower(),
            (item.get('tags') or '').lower(),
        ]))
        content_texts.append(text)

    for entry in popularity_ranking:
        if entry['count'] < 2:
            continue  # Only care about queries asked more than once

        avg_recs = entry['avg_recommendations']

        # Check how many content items match the query text
        query_words = entry['query'].split()
        significant_words = [w for w in query_words if len(w) > 2]
        content_matches = 0
        for text in content_texts:
            if any(word in text for word in significant_words):
                content_matches += 1

        # Determine gap severity
        if avg_recs == 0:
            severity = 'high'
        elif avg_recs < LOW_RECOMMENDATION_THRESHOLD:
            severity = 'medium'
        elif content_matches < 3 and entry['count'] >= 3:
            severity = 'low'
        else:
            continue  # Not a gap

        gap_score = entry['count'] * (1 / (avg_recs + 0.1))

        gaps.append({
            'query': entry['query'],
            'search_count': entry['count'],
            'avg_recommendations': avg_recs,
            'content_matches_found': content_matches,
            'gap_severity': severity,
            'gap_score': round(gap_score, 2),
            'flagged': False,
        })

    # Sort by gap score (most severe first)
    gaps.sort(key=lambda x: x['gap_score'], reverse=True)
    return gaps


# =============================================================================
# Section 2B: AI Content Recommendations (Advanced Model)
# =============================================================================

def generate_ai_content_recommendations(gaps, content_inventory, openai_client=None, verbose=False, model=None):
    """Use advanced AI to cross-reference gaps against full content inventory
    and produce specific content creation recommendations."""
    if not openai_client:
        return []

    if not gaps:
        return []

    use_model = model or ADVANCED_MODEL

    # Build content inventory summary for AI
    inventory_lines = []
    for item in content_inventory:
        title = (item.get('title') or '')[:60]
        ctype = item.get('type') or ''
        state = item.get('state') or 'National'
        tags = (item.get('tags') or '')[:80]
        keywords = item.get('keywords') or []
        kw_str = ''
        if keywords and isinstance(keywords, list):
            kw_str = ', '.join(k.get('keyword', '') for k in keywords[:5] if isinstance(k, dict))
        line = f"- [{ctype}] {title} | {state} | tags: {tags}"
        if kw_str:
            line += f" | keywords: {kw_str}"
        inventory_lines.append(line)

    inventory_text = '\n'.join(inventory_lines)

    # Build gap summary
    top_gaps = gaps[:20]
    gap_lines = []
    for g in top_gaps:
        gap_lines.append(
            f"- \"{g['query']}\" ({g['search_count']} searches, "
            f"{g['avg_recommendations']} avg results, severity: {g['gap_severity']})"
        )
    gaps_text = '\n'.join(gap_lines)

    if verbose:
        print(f"  Sending {len(top_gaps)} gaps + {len(content_inventory)} content items to {use_model}...")

    try:
        messages = [
            {
                "role": "system",
                "content": """You are a marketing content strategist for SchooLinks, a K-12 college and career readiness platform.
Your job is to analyze what sales reps are searching for, compare it to what content already exists,
and recommend specific new content pieces to create.

Be specific and actionable. Each recommendation should include a concrete content title,
the best format (1-Pager, Customer Story, Video, Ebook, Blog, Webinar), target audience,
and why this content is needed."""
            },
            {
                "role": "user",
                "content": f"""Analyze the gap between what sales reps are searching for and what content we have.

POPULAR QUERIES WITH POOR/NO RESULTS:
{gaps_text}

CURRENT CONTENT INVENTORY ({len(content_inventory)} items):
{inventory_text}

For each major gap, recommend specific content pieces to create.
Return ONLY valid JSON:
{{
  "recommendations": [
    {{
      "gap_query": "the search query this addresses",
      "title": "Suggested content title",
      "content_type": "1-Pager|Customer Story|Video|Ebook|Blog|Webinar",
      "target_audience": "who this is for",
      "priority": "high|medium|low",
      "rationale": "Why this content is needed and how it fills the gap",
      "existing_related": "Titles of any partially related existing content, or 'None'"
    }}
  ]
}}

Provide 5-15 recommendations, prioritized by impact."""
            }
        ]

        # gpt-5.x models use max_completion_tokens instead of max_tokens
        api_params = {"model": use_model, "messages": messages}
        if use_model.startswith('gpt-5') or use_model.startswith('o'):
            api_params["max_completion_tokens"] = 3000
        else:
            api_params["temperature"] = 0.3
            api_params["max_tokens"] = 3000

        response = openai_client.chat.completions.create(**api_params)

        content = response.choices[0].message.content

        # Parse JSON
        json_match = content
        if '```json' in content:
            json_match = content.split('```json')[1].split('```')[0]
        elif '```' in content:
            json_match = content.split('```')[1].split('```')[0]

        parsed = json.loads(json_match.strip())
        recommendations = parsed.get('recommendations', [])

        if verbose:
            print(f"  AI generated {len(recommendations)} content recommendations")

        return recommendations

    except Exception as e:
        print(f"  Warning: AI content recommendations failed: {e}")
        return []


# =============================================================================
# Section 3: Topic Clustering
# =============================================================================

def generate_topic_clusters(logs):
    """Group queries by detected themes using keyword matching."""
    clusters = {
        'competitor': defaultdict(list),
        'state_specific': defaultdict(list),
        'content_type': defaultdict(list),
        'feature': defaultdict(list),
        'persona': defaultdict(list),
        'topic': defaultdict(list),
    }
    uncategorized = []

    for log in logs:
        query_lower = (log['query'] or '').lower()
        matched = False

        # Competitor detection
        for kw in COMPETITOR_KEYWORDS:
            if kw in query_lower:
                clusters['competitor'][kw].append(query_lower)
                matched = True

        # State detection (from detected_states array)
        states = log.get('detected_states') or []
        for state in states:
            clusters['state_specific'][state].append(query_lower)
            matched = True

        # Content type detection
        for kw in CONTENT_TYPE_KEYWORDS:
            if kw in query_lower:
                clusters['content_type'][kw].append(query_lower)
                matched = True

        # Feature detection
        for kw in FEATURE_KEYWORDS:
            if kw in query_lower:
                clusters['feature'][kw].append(query_lower)
                matched = True

        # Persona detection
        for kw in PERSONA_KEYWORDS:
            if kw in query_lower:
                clusters['persona'][kw].append(query_lower)
                matched = True

        # Topic detection
        for kw in TOPIC_KEYWORDS:
            if kw in query_lower:
                clusters['topic'][kw].append(query_lower)
                matched = True

        if not matched:
            uncategorized.append(query_lower)

    # Build summary
    result = {}
    for cluster_name, sub_clusters in clusters.items():
        total = sum(len(v) for v in sub_clusters.values())
        breakdown = {k: len(v) for k, v in sub_clusters.items()}
        breakdown = dict(sorted(breakdown.items(), key=lambda x: x[1], reverse=True))

        # Top queries for this cluster
        all_queries = []
        for queries in sub_clusters.values():
            all_queries.extend(queries)
        top_queries = [q for q, _ in Counter(all_queries).most_common(5)]

        result[cluster_name] = {
            'count': total,
            'breakdown': breakdown,
            'top_queries': top_queries,
        }

    result['uncategorized'] = {
        'count': len(uncategorized),
        'queries': list(set(uncategorized))[:20],
    }

    return result


# =============================================================================
# Section 4: Terminology Brain Suggestions (AI-powered)
# =============================================================================

def generate_terminology_suggestions(logs, existing_mappings, openai_client=None, verbose=False):
    """Identify unmapped terms and use AI to suggest new mappings."""
    # Part A: Extract frequent unmapped terms (always runs)
    stopwords = {
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
        'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'nor',
        'it', 'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we',
        'our', 'you', 'your', 'he', 'she', 'they', 'them', 'their', 'what',
        'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
        'both', 'few', 'more', 'most', 'other', 'some', 'such', 'any',
        'show', 'me', 'find', 'get', 'give', 'about', 'like', 'need',
        'want', 'looking', 'search', 'content', 'schoolinks', 'schoolink',
    }

    # Collect all existing mapped terms
    mapped_terms = set()
    for type_mappings in existing_mappings.values():
        for term in type_mappings.keys():
            mapped_terms.add(term.lower())
        for term in type_mappings.values():
            mapped_terms.add(term.lower())

    # Extract bigrams and trigrams from queries
    term_counter = Counter()
    term_examples = defaultdict(list)

    for log in logs:
        query = (log['query'] or '').strip().lower()
        words = re.findall(r'[a-z]+(?:\s+[a-z]+)?', query)

        # Unigrams
        for word in query.split():
            word = word.strip().lower()
            if len(word) > 2 and word not in stopwords and word not in mapped_terms:
                term_counter[word] += 1
                if len(term_examples[word]) < 3:
                    term_examples[word].append(query)

        # Bigrams
        query_words = query.split()
        for i in range(len(query_words) - 1):
            bigram = f"{query_words[i]} {query_words[i+1]}"
            if bigram not in mapped_terms and not all(w in stopwords for w in bigram.split()):
                term_counter[bigram] += 1
                if len(term_examples[bigram]) < 3:
                    term_examples[bigram].append(query)

    # Filter to terms seen 2+ times
    unmapped_terms = [
        {
            'term': term,
            'count': count,
            'example_queries': list(set(term_examples[term]))[:3],
        }
        for term, count in term_counter.most_common(100)
        if count >= 2
    ]

    result = {
        'unmapped_terms': unmapped_terms[:50],
        'ai_suggestions': [],
    }

    # Part B: AI-powered suggestion (if available)
    if not openai_client:
        return result

    if not unmapped_terms:
        return result

    if verbose:
        print("  Calling AI for terminology suggestions...")

    # Build prompt with top unmapped terms
    terms_text = "\n".join([
        f"- \"{t['term']}\" (seen {t['count']}x) examples: {t['example_queries']}"
        for t in unmapped_terms[:50]
    ])

    existing_summary = json.dumps(
        {k: dict(list(v.items())[:10]) for k, v in existing_mappings.items()},
        indent=2
    )

    try:
        response = openai_client.chat.completions.create(
            model=ANALYSIS_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": f"""You are a search terminology expert for the SchooLinks Marketing Content Portal.
The portal contains K-12 education marketing content: Customer Stories, Videos, Ebooks, 1-Pagers, etc.

EXISTING TERMINOLOGY MAPPINGS (sample):
{existing_summary}

Analyze the unmapped terms below and suggest new mappings. Focus on:
1. Misspellings of existing terms (typos, phonetic errors)
2. Synonym variations for content types
3. Competitor name variations
4. Education acronym expansions
5. Persona term standardization

Return ONLY valid JSON:
{{
  "suggestions": [
    {{"user_term": "what users typed", "canonical_term": "correct db term", "map_type": "content_type|competitor|persona|topic|feature|state", "confidence": 0.8, "reason": "brief explanation"}}
  ]
}}"""
                },
                {
                    "role": "user",
                    "content": f"Analyze these unmapped search terms and suggest terminology mappings:\n\n{terms_text}"
                }
            ],
            temperature=0.3,
            max_tokens=2000
        )

        content = response.choices[0].message.content

        # Parse JSON
        json_match = content
        if '```json' in content:
            json_match = content.split('```json')[1].split('```')[0]
        elif '```' in content:
            json_match = content.split('```')[1].split('```')[0]

        parsed = json.loads(json_match.strip())
        suggestions = parsed.get('suggestions', [])

        # Filter out terms that already exist
        filtered = []
        for s in suggestions:
            if s.get('user_term', '').lower() not in mapped_terms:
                filtered.append(s)

        result['ai_suggestions'] = filtered

        if verbose:
            print(f"  AI generated {len(filtered)} terminology suggestions")

    except Exception as e:
        print(f"  Warning: AI terminology analysis failed: {e}")

    return result


# =============================================================================
# Section 5: State Coverage Report
# =============================================================================

def generate_state_coverage(logs):
    """Analyze which states are searched most and their result quality."""
    state_data = defaultdict(list)

    for log in logs:
        states = log.get('detected_states') or []
        for state in states:
            state_data[state].append(log)

    coverage = []
    for state, entries in state_data.items():
        recs = [e['recommendations_count'] or 0 for e in entries]
        avg_recs = round(sum(recs) / len(recs), 2) if recs else 0
        unique_queries = len(set((e['query'] or '').lower() for e in entries))

        if avg_recs >= 3:
            rating = 'good'
        elif avg_recs >= 1:
            rating = 'fair'
        else:
            rating = 'poor'

        coverage.append({
            'state': state,
            'query_count': len(entries),
            'unique_queries': unique_queries,
            'avg_recommendations': avg_recs,
            'coverage_rating': rating,
        })

    coverage.sort(key=lambda x: x['query_count'], reverse=True)

    # Find states with zero searches
    searched_states = set(s['state'] for s in coverage)
    no_demand_states = sorted(US_STATES - searched_states)

    return {
        'states': coverage,
        'no_demand_states': no_demand_states,
    }


# =============================================================================
# Section 6: Competitor Intelligence
# =============================================================================

def generate_competitor_intelligence(logs):
    """Analyze competitor mention frequency and result quality."""
    competitor_data = defaultdict(list)

    for log in logs:
        query_lower = (log['query'] or '').lower()
        for kw in COMPETITOR_KEYWORDS:
            if kw in query_lower:
                competitor_data[kw].append(log)

    competitors = []
    for name, entries in competitor_data.items():
        recs = [e['recommendations_count'] or 0 for e in entries]
        times = [e['response_time_ms'] for e in entries if e['response_time_ms']]
        avg_recs = round(sum(recs) / len(recs), 2) if recs else 0
        avg_time = round(sum(times) / len(times)) if times else 0

        # Top query patterns
        query_counter = Counter((e['query'] or '').lower() for e in entries)
        top_queries = [q for q, _ in query_counter.most_common(5)]

        if avg_recs >= 3:
            quality = 'good'
        elif avg_recs >= 1:
            quality = 'fair'
        else:
            quality = 'poor'

        competitors.append({
            'name': name,
            'mention_count': len(entries),
            'avg_recommendations': avg_recs,
            'avg_response_time_ms': avg_time,
            'top_queries': top_queries,
            'result_quality': quality,
        })

    competitors.sort(key=lambda x: x['mention_count'], reverse=True)

    return {
        'total_competitor_queries': sum(c['mention_count'] for c in competitors),
        'competitors': competitors,
    }


# =============================================================================
# Section 7: Query Type Distribution
# =============================================================================

def generate_query_type_distribution(logs):
    """Breakdown of queries by type."""
    type_data = defaultdict(list)

    for log in logs:
        qt = log.get('query_type') or 'unknown'
        type_data[qt].append(log)

    total = len(logs)
    distribution = []

    for qt, entries in type_data.items():
        recs = [e['recommendations_count'] or 0 for e in entries]
        times = [e['response_time_ms'] for e in entries if e['response_time_ms']]

        distribution.append({
            'query_type': qt,
            'count': len(entries),
            'percentage': round(len(entries) / total * 100, 1) if total > 0 else 0,
            'avg_recommendations': round(sum(recs) / len(recs), 2) if recs else 0,
            'avg_response_time_ms': round(sum(times) / len(times)) if times else 0,
        })

    distribution.sort(key=lambda x: x['count'], reverse=True)

    return {
        'total': total,
        'distribution': distribution,
    }


# =============================================================================
# Section 8: Temporal Trends
# =============================================================================

def generate_temporal_trends(logs):
    """Analyze daily/weekly query volume and trends."""
    daily = defaultdict(list)
    hourly = Counter()

    for log in logs:
        ts = log.get('created_at')
        if not ts:
            continue
        date_str = ts.strftime('%Y-%m-%d')
        hour = ts.hour
        daily[date_str].append(log)
        hourly[hour] += 1

    # Daily trend
    daily_trend = []
    for date_str in sorted(daily.keys()):
        entries = daily[date_str]
        recs = [e['recommendations_count'] or 0 for e in entries]
        daily_trend.append({
            'date': date_str,
            'count': len(entries),
            'avg_recommendations': round(sum(recs) / len(recs), 2) if recs else 0,
        })

    # Weekly trend
    weekly = defaultdict(list)
    for log in logs:
        ts = log.get('created_at')
        if not ts:
            continue
        week = ts.strftime('%Y-W%V')
        weekly[week].append(log)

    weekly_trend = []
    for week in sorted(weekly.keys()):
        entries = weekly[week]
        recs = [e['recommendations_count'] or 0 for e in entries]
        weekly_trend.append({
            'week': week,
            'count': len(entries),
            'avg_recommendations': round(sum(recs) / len(recs), 2) if recs else 0,
        })

    # Trend direction
    trend_direction = 'stable'
    if len(weekly_trend) >= 2:
        recent = weekly_trend[-1]['count']
        previous = weekly_trend[-2]['count']
        if recent > previous * 1.2:
            trend_direction = 'increasing'
        elif recent < previous * 0.8:
            trend_direction = 'decreasing'

    # Peak
    peak_day = max(daily_trend, key=lambda x: x['count'])['date'] if daily_trend else None
    peak_hour = max(hourly.items(), key=lambda x: x[1])[0] if hourly else None

    return {
        'daily': daily_trend,
        'weekly': weekly_trend,
        'hourly_distribution': dict(sorted(hourly.items())),
        'trend_direction': trend_direction,
        'peak_day': peak_day,
        'peak_hour': peak_hour,
    }


# =============================================================================
# Section 9: Executive Summary (AI-powered)
# =============================================================================

def generate_executive_summary(report_data, openai_client=None, verbose=False):
    """Generate an AI-powered executive summary, or a basic one without AI."""
    metrics = report_data.get('metrics', {})
    popularity = report_data.get('popularity_ranking', [])
    gaps = report_data.get('content_gaps', [])
    competitor = report_data.get('competitor_intelligence', {})
    state = report_data.get('state_coverage', {})

    # Basic summary (always generated)
    parts = [
        f"Analyzed {metrics.get('total_logs', 0)} total queries.",
    ]

    if popularity:
        top3 = [f'"{p["query"]}" ({p["count"]}x)' for p in popularity[:3]]
        parts.append(f"Top searches: {', '.join(top3)}.")

    high_gaps = [g for g in gaps if g['gap_severity'] == 'high']
    if high_gaps:
        parts.append(f"{len(high_gaps)} HIGH priority content gaps identified.")

    if competitor.get('competitors'):
        top_comp = competitor['competitors'][0]
        parts.append(f"Most asked competitor: {top_comp['name']} ({top_comp['mention_count']}x).")

    if state.get('states'):
        top_state = state['states'][0]
        parts.append(f"Most searched state: {top_state['state']} ({top_state['query_count']}x).")

    basic_summary = ' '.join(parts)

    if not openai_client:
        return basic_summary

    if verbose:
        print("  Generating AI executive summary...")

    # Build digest for AI
    digest = {
        'total_queries': metrics.get('total_logs', 0),
        'top_5_queries': [{'query': p['query'], 'count': p['count'], 'avg_recs': p['avg_recommendations']} for p in popularity[:5]],
        'high_priority_gaps': [{'query': g['query'], 'count': g['search_count'], 'avg_recs': g['avg_recommendations']} for g in high_gaps[:10]],
        'competitor_summary': {c['name']: c['mention_count'] for c in competitor.get('competitors', [])},
        'top_states': [{'state': s['state'], 'queries': s['query_count'], 'rating': s['coverage_rating']} for s in (state.get('states') or [])[:5]],
        'trend': report_data.get('temporal_trends', {}).get('trend_direction', 'unknown'),
    }

    # Include AI content recommendations in digest if available
    ai_recs = report_data.get('ai_content_recommendations', [])
    if ai_recs:
        digest['ai_content_recommendations'] = [
            {'title': r.get('title'), 'type': r.get('content_type'), 'priority': r.get('priority'), 'rationale': r.get('rationale', '')[:100]}
            for r in ai_recs[:10]
        ]

    try:
        exec_messages = [
            {
                "role": "system",
                "content": """You are a marketing analytics consultant for SchooLinks, a K-12 college and career readiness platform.
Summarize the search analytics findings and provide a strategic content creation roadmap for the marketing team.

Structure your response as:
1. **Key Findings** - Top 3-5 insights from the data
2. **Content Creation Priorities** - Specific content pieces to create, ordered by impact
3. **Terminology Improvements** - Search terms that need better mapping
4. **Strategic Recommendations** - Higher-level strategic actions

Be concise and actionable. Use markdown formatting with headers and bullet points. Under 500 words."""
            },
            {
                "role": "user",
                "content": f"Summarize these analytics findings and create a content strategy roadmap:\n\n{json.dumps(digest, indent=2, cls=DecimalEncoder)}"
            }
        ]

        # gpt-5.x models use max_completion_tokens instead of max_tokens
        exec_params = {"model": ADVANCED_MODEL, "messages": exec_messages}
        if ADVANCED_MODEL.startswith('gpt-5') or ADVANCED_MODEL.startswith('o'):
            exec_params["max_completion_tokens"] = 2000
        else:
            exec_params["temperature"] = 0.3
            exec_params["max_tokens"] = 2000

        response = openai_client.chat.completions.create(**exec_params)

        ai_summary = response.choices[0].message.content
        return ai_summary

    except Exception as e:
        print(f"  Warning: AI summary failed: {e}")
        return basic_summary


# =============================================================================
# Report Saving
# =============================================================================

def save_report_to_db(conn, report, dry_run=False):
    """Save the comprehensive report to log_analysis_reports."""
    if dry_run:
        return None

    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO log_analysis_reports (
                analysis_date, logs_analyzed, time_range_start, time_range_end,
                avg_recommendations_count, zero_result_queries, low_confidence_queries,
                competitor_query_count,
                summary, issues_identified, suggested_mappings, pattern_insights,
                terminology_suggestions,
                execution_time_ms, model_used,
                report_type, popularity_ranking, content_gaps, query_clusters,
                state_coverage, competitor_analysis, temporal_trends, executive_summary
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s,
                %s, %s, %s, %s,
                %s,
                %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s
            )
            RETURNING id
        """, (
            report['analysis_date'],
            report['metrics']['total_logs'],
            report.get('time_range_start'),
            report.get('time_range_end'),
            report['metrics']['avg_recommendations'],
            report['metrics']['zero_result_queries'],
            report['metrics']['low_confidence_queries'],
            report['metrics']['competitor_queries'],
            report.get('summary'),
            json.dumps([], cls=DecimalEncoder),  # issues_identified (populated by log_analyzer)
            json.dumps(report.get('terminology_suggestions', {}).get('ai_suggestions', []), cls=DecimalEncoder),
            json.dumps([], cls=DecimalEncoder),  # pattern_insights
            json.dumps(report.get('terminology_suggestions', {}).get('ai_suggestions', []), cls=DecimalEncoder),
            report.get('execution_time_ms'),
            ANALYSIS_MODEL,
            'comprehensive',
            json.dumps(report.get('popularity_ranking', [])[:100], cls=DecimalEncoder),
            json.dumps(report.get('content_gaps', [])[:50], cls=DecimalEncoder),
            json.dumps(report.get('query_clusters', {}), cls=DecimalEncoder),
            json.dumps(report.get('state_coverage', {}), cls=DecimalEncoder),
            json.dumps(report.get('competitor_intelligence', {}), cls=DecimalEncoder),
            json.dumps(report.get('temporal_trends', {}), cls=DecimalEncoder),
            report.get('executive_summary'),
        ))

        result = cur.fetchone()
        conn.commit()
        cur.close()
        return result['id'] if result else None

    except Exception as e:
        print(f"  Error saving report: {e}")
        conn.rollback()
        cur.close()
        return None


def insert_terminology_suggestions(conn, suggestions, dry_run=False):
    """Insert AI term suggestions into terminology_map as unverified/inactive."""
    if not suggestions or dry_run:
        return 0

    cur = conn.cursor()
    inserted = 0

    for suggestion in suggestions:
        try:
            cur.execute("""
                INSERT INTO terminology_map
                    (map_type, user_term, canonical_term, source, confidence, is_verified, is_active)
                VALUES
                    (%s, %s, %s, 'log_analysis', %s, false, false)
                ON CONFLICT (map_type, user_term) DO NOTHING
                RETURNING id
            """, (
                suggestion.get('map_type', 'content_type'),
                suggestion.get('user_term', '').lower(),
                suggestion.get('canonical_term', ''),
                suggestion.get('confidence', 0.5)
            ))
            if cur.fetchone():
                inserted += 1
        except Exception as e:
            print(f"  Warning: Failed to insert suggestion: {e}")

    conn.commit()
    cur.close()
    return inserted


# =============================================================================
# Output Functions
# =============================================================================

def print_report(report, verbose=False):
    """Pretty-print the full report to console."""
    print("\n" + "=" * 70)
    print("  QUERY POPULARITY & CONTENT GAP ANALYSIS REPORT")
    print("  Marketing Content Portal - Self-Healing Analytics")
    print("=" * 70)
    print(f"  Generated: {report['analysis_date']}")
    if report.get('time_range_start') and report.get('time_range_end'):
        print(f"  Time Range: {report['time_range_start'][:10]} to {report['time_range_end'][:10]}")
    print(f"  Total Queries Analyzed: {report['metrics']['total_logs']}")
    print("=" * 70)

    # Section 1: Popularity Ranking
    ranking = report.get('popularity_ranking', [])
    limit = len(ranking) if verbose else 20
    print(f"\n--- 1. QUERY POPULARITY RANKING (Top {min(limit, len(ranking))}) ---")
    for item in ranking[:limit]:
        recs_indicator = ''
        if item['avg_recommendations'] == 0:
            recs_indicator = ' [NO RESULTS]'
        elif item['avg_recommendations'] < LOW_RECOMMENDATION_THRESHOLD:
            recs_indicator = ' [LOW]'
        print(f"  #{item['rank']:3d}  \"{item['query'][:50]}\"  ({item['count']}x)"
              f"  avg recs: {item['avg_recommendations']}{recs_indicator}")
    if len(ranking) > limit:
        print(f"  ... and {len(ranking) - limit} more unique queries")

    # Section 2: Content Gaps
    gaps = report.get('content_gaps', [])
    print(f"\n--- 2. CONTENT GAP ANALYSIS ({len(gaps)} gaps found) ---")
    high_gaps = [g for g in gaps if g['gap_severity'] == 'high']
    med_gaps = [g for g in gaps if g['gap_severity'] == 'medium']
    low_gaps = [g for g in gaps if g['gap_severity'] == 'low']
    if high_gaps:
        print(f"\n  HIGH PRIORITY ({len(high_gaps)}):")
        for g in high_gaps[:10]:
            print(f"    \"{g['query'][:50]}\"  ({g['search_count']} searches, {g['avg_recommendations']} avg recs)")
    if med_gaps:
        print(f"\n  MEDIUM PRIORITY ({len(med_gaps)}):")
        for g in med_gaps[:5]:
            print(f"    \"{g['query'][:50]}\"  ({g['search_count']} searches, {g['avg_recommendations']} avg recs)")
    if low_gaps:
        print(f"\n  LOW PRIORITY: {len(low_gaps)} gaps")

    # Section 2B: AI Content Recommendations
    ai_recs = report.get('ai_content_recommendations', [])
    if ai_recs:
        print(f"\n  AI CONTENT RECOMMENDATIONS ({len(ai_recs)}):")
        for r in ai_recs[:10]:
            priority_icon = {'high': '!!!', 'medium': '!!', 'low': '!'}.get(r.get('priority', ''), '?')
            print(f"    [{priority_icon}] [{r.get('content_type', '?')}] \"{r.get('title', '?')[:55]}\"")
            print(f"        For: {r.get('target_audience', '?')} | Gap: \"{r.get('gap_query', '')[:40]}\"")
            if verbose and r.get('rationale'):
                print(f"        Why: {r['rationale'][:80]}")

    # Section 3: Topic Clusters
    clusters = report.get('query_clusters', {})
    print(f"\n--- 3. TOPIC CLUSTERING ---")
    for cluster_name, data in clusters.items():
        if cluster_name == 'uncategorized':
            print(f"  Uncategorized: {data.get('count', 0)} queries")
            continue
        count = data.get('count', 0)
        if count == 0:
            continue
        breakdown = data.get('breakdown', {})
        top3 = list(breakdown.items())[:3]
        top3_str = ', '.join(f"{k}:{v}" for k, v in top3)
        print(f"  {cluster_name}: {count} queries  ({top3_str})")

    # Section 4: Terminology Suggestions
    term_data = report.get('terminology_suggestions', {})
    ai_suggestions = term_data.get('ai_suggestions', [])
    unmapped = term_data.get('unmapped_terms', [])
    print(f"\n--- 4. TERMINOLOGY BRAIN SUGGESTIONS ---")
    if ai_suggestions:
        print(f"  AI Suggestions ({len(ai_suggestions)}):")
        for s in ai_suggestions[:10]:
            print(f"    \"{s.get('user_term')}\" -> \"{s.get('canonical_term')}\" "
                  f"({s.get('map_type')}, {s.get('confidence', 0):.0%})")
    if unmapped:
        print(f"\n  Top Unmapped Terms ({len(unmapped)}):")
        for t in unmapped[:10]:
            print(f"    \"{t['term']}\" (seen {t['count']}x)")

    # Section 5: State Coverage
    state_data = report.get('state_coverage', {})
    states = state_data.get('states', [])
    print(f"\n--- 5. STATE COVERAGE ---")
    for s in states[:10]:
        rating_icon = {'good': '+', 'fair': '~', 'poor': '!'}
        print(f"  [{rating_icon.get(s['coverage_rating'], '?')}] {s['state']}: "
              f"{s['query_count']} queries, {s['avg_recommendations']} avg recs ({s['coverage_rating']})")
    no_demand = state_data.get('no_demand_states', [])
    if no_demand:
        print(f"  No searches: {', '.join(no_demand[:15])}")

    # Section 6: Competitor Intelligence
    comp_data = report.get('competitor_intelligence', {})
    competitors = comp_data.get('competitors', [])
    print(f"\n--- 6. COMPETITOR INTELLIGENCE ---")
    print(f"  Total competitor queries: {comp_data.get('total_competitor_queries', 0)}")
    for c in competitors:
        print(f"  {c['name']}: {c['mention_count']}x mentions, "
              f"{c['avg_recommendations']} avg recs ({c['result_quality']})")

    # Section 7: Query Type Distribution
    qt_data = report.get('query_type_distribution', {})
    print(f"\n--- 7. QUERY TYPE DISTRIBUTION ---")
    for d in qt_data.get('distribution', []):
        print(f"  {d['query_type']}: {d['count']} ({d['percentage']}%)")

    # Section 8: Temporal Trends
    trends = report.get('temporal_trends', {})
    print(f"\n--- 8. TEMPORAL TRENDS ---")
    print(f"  Trend direction: {trends.get('trend_direction', 'N/A')}")
    if trends.get('peak_day'):
        print(f"  Peak day: {trends['peak_day']}")
    if trends.get('peak_hour') is not None:
        print(f"  Peak hour: {trends['peak_hour']}:00")
    weekly = trends.get('weekly', [])
    if weekly:
        print(f"  Weekly volumes: ", end='')
        for w in weekly[-6:]:
            print(f"{w['week']}={w['count']} ", end='')
        print()

    # Section 9: Executive Summary
    summary = report.get('executive_summary', '')
    print(f"\n--- 9. EXECUTIVE SUMMARY ---")
    print(f"  {summary[:500]}" if summary else "  (No summary generated)")

    print("\n" + "=" * 70)


def export_json(report, output_path):
    """Export full report to JSON file."""
    with open(output_path, 'w') as f:
        json.dump(report, f, indent=2, cls=DecimalEncoder, default=str)
    print(f"  JSON report saved to {output_path}")


def export_csv(popularity_ranking, csv_path):
    """Export popularity ranking to CSV."""
    if not popularity_ranking:
        print(f"  No data to export to CSV")
        return

    with open(csv_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'rank', 'query', 'count', 'avg_recommendations',
            'avg_response_time_ms', 'complexities', 'query_types'
        ])
        writer.writeheader()
        for item in popularity_ranking:
            writer.writerow({
                'rank': item['rank'],
                'query': item['query'],
                'count': item['count'],
                'avg_recommendations': item['avg_recommendations'],
                'avg_response_time_ms': item['avg_response_time_ms'],
                'complexities': ', '.join(item.get('complexities', [])),
                'query_types': ', '.join(item.get('query_types', [])),
            })
    print(f"  CSV ranking saved to {csv_path}")


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Query Popularity & Content Gap Analysis Report',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/query_popularity_report.py
  python scripts/query_popularity_report.py --days 30
  python scripts/query_popularity_report.py --start 2026-02-01 --end 2026-02-10
  python scripts/query_popularity_report.py --output report.json --csv popularity.csv
  python scripts/query_popularity_report.py --dry-run --verbose
        """
    )
    parser.add_argument('--days', type=int, default=9999,
                        help='Number of days to analyze (default: all time)')
    parser.add_argument('--start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--output', type=str, help='Output file path for JSON report')
    parser.add_argument('--csv', type=str, help='Output file path for CSV popularity ranking')
    parser.add_argument('--dry-run', action='store_true', help='No database writes')
    parser.add_argument('--advanced', action='store_true',
                        help=f'Use advanced model ({ADVANCED_MODEL}) for all AI sections')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')

    args = parser.parse_args()

    print("=" * 60)
    print("QUERY POPULARITY REPORT - Marketing Content Portal")
    print("=" * 60)

    start_time = datetime.now()

    # Connect to database
    print("\nConnecting to database...")
    conn = connect_to_database()
    print("  Connected")

    # OpenAI client (optional)
    print("\nChecking OpenAI availability...")
    openai_client = get_openai_client()
    if openai_client:
        print("  OpenAI available")

    # Fetch data
    print("\nFetching prompt logs...")
    if args.start and args.end:
        print(f"  Date range: {args.start} to {args.end}")
        logs = fetch_all_logs(conn, start_date=args.start, end_date=args.end)
    else:
        period = "all time" if args.days >= 9999 else f"last {args.days} days"
        print(f"  Period: {period}")
        logs = fetch_all_logs(conn, days=args.days)
    print(f"  Found {len(logs)} log entries")

    if len(logs) == 0:
        print("\nNo logs found to analyze. Exiting.")
        conn.close()
        return

    print("\nFetching terminology mappings...")
    mappings = fetch_terminology_mappings(conn)
    total_mappings = sum(len(v) for v in mappings.values())
    print(f"  {total_mappings} active mappings across {len(mappings)} types")

    print("\nFetching marketing content inventory...")
    content = fetch_marketing_content(conn)
    print(f"  {len(content)} content items")

    # Calculate basic metrics
    recs_all = [log['recommendations_count'] or 0 for log in logs]
    metrics = {
        'total_logs': len(logs),
        'avg_recommendations': round(sum(recs_all) / len(recs_all), 2),
        'zero_result_queries': sum(1 for r in recs_all if r == 0),
        'low_confidence_queries': sum(1 for r in recs_all if r < LOW_RECOMMENDATION_THRESHOLD),
        'competitor_queries': sum(1 for log in logs if any(kw in (log['query'] or '').lower() for kw in COMPETITOR_KEYWORDS)),
    }

    # Generate all sections
    print("\nGenerating report sections...")

    print("  [1/9] Popularity ranking...")
    popularity = generate_popularity_ranking(logs)

    print("  [2/9] Content gap analysis...")
    gaps = generate_content_gap_analysis(popularity, content)

    print("  [2B/9] AI content recommendations...")
    ai_recs_model = ADVANCED_MODEL if args.advanced else ADVANCED_MODEL  # Always use advanced for recs
    ai_content_recs = generate_ai_content_recommendations(
        gaps, content, openai_client, verbose=args.verbose, model=ai_recs_model
    )
    # Attach AI recommendations to matching gaps
    if ai_content_recs:
        rec_by_query = {}
        for rec in ai_content_recs:
            gq = (rec.get('gap_query') or '').lower()
            if gq not in rec_by_query:
                rec_by_query[gq] = []
            rec_by_query[gq].append(rec)
        for gap in gaps:
            matching_recs = rec_by_query.get(gap['query'].lower(), [])
            if matching_recs:
                gap['ai_recommendations'] = matching_recs

    print("  [3/9] Topic clustering...")
    clusters = generate_topic_clusters(logs)

    print("  [4/9] Terminology suggestions...")
    term_suggestions = generate_terminology_suggestions(logs, mappings, openai_client, verbose=args.verbose)

    print("  [5/9] State coverage...")
    state_coverage = generate_state_coverage(logs)

    print("  [6/9] Competitor intelligence...")
    competitor_intel = generate_competitor_intelligence(logs)

    print("  [7/9] Query type distribution...")
    qt_distribution = generate_query_type_distribution(logs)

    print("  [8/9] Temporal trends...")
    temporal = generate_temporal_trends(logs)

    # Build report (needed for executive summary context)
    execution_time = int((datetime.now() - start_time).total_seconds() * 1000)

    report = {
        'analysis_date': datetime.now().strftime('%Y-%m-%d'),
        'time_range_start': logs[-1]['created_at'].isoformat() if logs else None,
        'time_range_end': logs[0]['created_at'].isoformat() if logs else None,
        'metrics': metrics,
        'popularity_ranking': popularity,
        'content_gaps': gaps,
        'ai_content_recommendations': ai_content_recs,
        'query_clusters': clusters,
        'terminology_suggestions': term_suggestions,
        'state_coverage': state_coverage,
        'competitor_intelligence': competitor_intel,
        'query_type_distribution': qt_distribution,
        'temporal_trends': temporal,
        'execution_time_ms': execution_time,
    }

    print("  [9/9] Executive summary...")
    report['executive_summary'] = generate_executive_summary(report, openai_client, verbose=args.verbose)
    report['summary'] = report['executive_summary'][:500] if report['executive_summary'] else ''

    # Print report
    print_report(report, verbose=args.verbose)

    # Save to database
    if not args.dry_run:
        print("\nSaving report to database...")
        report_id = save_report_to_db(conn, report)
        if report_id:
            print(f"  Report saved (ID: {report_id})")

        # Insert terminology suggestions
        ai_suggestions = term_suggestions.get('ai_suggestions', [])
        if ai_suggestions:
            print(f"\nInserting {len(ai_suggestions)} terminology suggestions...")
            inserted = insert_terminology_suggestions(conn, ai_suggestions)
            print(f"  {inserted} new suggestions added (unverified, inactive)")
    else:
        print("\nDry run - no database changes made")

    # Export files
    if args.output:
        print(f"\nExporting JSON report...")
        export_json(report, args.output)

    if args.csv:
        print(f"\nExporting CSV ranking...")
        export_csv(popularity, args.csv)

    conn.close()
    execution_time = int((datetime.now() - start_time).total_seconds() * 1000)
    print(f"\nDone in {execution_time / 1000:.1f}s")


if __name__ == '__main__':
    main()
