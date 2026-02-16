#!/usr/bin/env python3
"""
Search Quality Debugging Agent

Multi-step agent that diagnoses why specific queries return poor results,
traces terminology mappings, analyzes keyword overlap, and provides AI-powered
fix recommendations with optional auto-fix.

Steps:
    1. Execute query against database (replicate frontend NLP pipeline)
    2. Trace terminology mapping path
    3. Analyze JSONB keyword weight overlap
    4. Find missed content (direct text match that NLP missed)
    5. AI diagnosis with specific fix recommendations
    6. Optional auto-fix: insert suggested terminology mappings

Usage:
    python scripts/diagnose_search.py "naviance comparison"
    python scripts/diagnose_search.py "FAFSA videos" --auto-fix
    python scripts/diagnose_search.py --query-id UUID-HERE
    python scripts/diagnose_search.py --worst 5
    python scripts/diagnose_search.py --output diagnosis.json -v
    python scripts/diagnose_search.py --dry-run
"""

import os
import sys
import json
import argparse
import re
from datetime import datetime
from decimal import Decimal
from collections import defaultdict

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

AI_MODEL = 'gpt-5-mini'


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def step_execute_query(conn, query, verbose=False):
    """Step 1: Execute query against DB (replicate frontend NLP)."""
    # Simple tokenization (matching frontend logic)
    tokens = [t.lower() for t in re.findall(r'\b\w+\b', query) if len(t) > 2]

    if verbose:
        print(f"    Query tokens: {tokens}")

    # Execute search using the DB search function, then fetch keywords separately
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, type, platform, state, tags, summary, live_link
            FROM search_marketing_content(%s)
            LIMIT 20
        """, (query,))
        results = cur.fetchall()

        # Fetch keywords for the results
        if results:
            ids = [str(r['id']) for r in results]
            cur.execute("""
                SELECT id, keywords
                FROM marketing_content
                WHERE id::text = ANY(%s)
            """, (ids,))
            keywords_map = {str(row['id']): row['keywords'] for row in cur.fetchall()}
        else:
            keywords_map = {}

    return {
        'query': query,
        'tokens': tokens,
        'result_count': len(results),
        'results': [
            {
                'id': str(r['id']),
                'title': r['title'],
                'type': r['type'],
                'platform': r['platform'],
                'tags': r['tags'],
                'keywords': keywords_map.get(str(r['id'])),
            }
            for r in results[:10]
        ],
    }


def step_trace_terminology(conn, query, tokens, verbose=False):
    """Step 2: Trace terminology mapping path."""
    with conn.cursor() as cur:
        # Get all terminology mappings
        cur.execute("""
            SELECT user_term, canonical_term, source, usage_count
            FROM terminology_map
            ORDER BY usage_count DESC NULLS LAST
        """)
        all_mappings = cur.fetchall()

    matched_mappings = []
    unmatched_tokens = set(tokens)

    for mapping in all_mappings:
        user_term = (mapping['user_term'] or '').lower()
        canonical_term = (mapping['canonical_term'] or '').lower()

        # Check if any token matches this mapping
        for token in tokens:
            if (token == user_term or
                token in user_term or
                user_term in token or
                token == canonical_term):
                matched_mappings.append({
                    'user_term': mapping['user_term'],
                    'canonical_term': mapping['canonical_term'],
                    'matched_token': token,
                    'usage_count': mapping['usage_count'] or 0,
                })
                unmatched_tokens.discard(token)
                break

    return {
        'total_mappings_available': len(all_mappings),
        'matched_mappings': matched_mappings,
        'unmatched_tokens': list(unmatched_tokens),
        'mapping_coverage': round(len(matched_mappings) / max(len(tokens), 1) * 100, 1),
    }


def step_keyword_overlap_analysis(conn, query, tokens, results, verbose=False):
    """Step 3: Analyze JSONB keyword weight overlap."""
    overlap_scores = []

    for result in results[:10]:
        keywords = result.get('keywords')
        if not keywords or not isinstance(keywords, dict):
            continue

        # Extract all keyword terms from JSONB
        all_keyword_terms = []
        for category in keywords.values():
            if isinstance(category, dict):
                all_keyword_terms.extend([k.lower() for k in category.keys()])

        # Calculate overlap
        matched_keywords = [k for k in all_keyword_terms if any(t in k or k in t for t in tokens)]
        overlap_score = len(matched_keywords) / max(len(all_keyword_terms), 1)

        overlap_scores.append({
            'content_id': result['id'],
            'title': result['title'][:60],
            'overlap_score': round(overlap_score, 2),
            'matched_keywords': matched_keywords[:5],
            'total_keywords': len(all_keyword_terms),
        })

    avg_overlap = round(sum(s['overlap_score'] for s in overlap_scores) / max(len(overlap_scores), 1), 2)

    return {
        'avg_overlap_score': avg_overlap,
        'top_results_overlap': overlap_scores,
        'quality': 'good' if avg_overlap > 0.3 else 'poor' if avg_overlap < 0.1 else 'fair',
    }


def step_find_missed_content(conn, query, tokens, results, verbose=False):
    """Step 4: Find content that should have matched but didn't."""
    result_ids = [r['id'] for r in results]

    with conn.cursor() as cur:
        # Direct text search on title, summary, tags
        search_pattern = '%' + '%'.join(tokens[:3]) + '%'
        cur.execute("""
            SELECT id, title, type, tags, summary, keywords
            FROM marketing_content
            WHERE (
                LOWER(title) LIKE LOWER(%s) OR
                LOWER(summary) LIKE LOWER(%s) OR
                LOWER(enhanced_summary) LIKE LOWER(%s) OR
                LOWER(tags) LIKE LOWER(%s)
            )
            AND id::text != ALL(%s)
            LIMIT 10
        """, (search_pattern, search_pattern, search_pattern, search_pattern, result_ids or []))
        missed = cur.fetchall()

    return {
        'missed_count': len(missed),
        'missed_content': [
            {
                'id': str(m['id']),
                'title': m['title'][:80],
                'type': m['type'],
                'tags': m['tags'][:100] if m['tags'] else '',
                'has_keywords': bool(m['keywords']),
            }
            for m in missed[:5]
        ],
    }


def step_ai_diagnosis(query, all_results, verbose=False):
    """Step 5: AI diagnosis with fix recommendations."""
    if not OPENAI_API_KEY:
        return {'status': 'skipped', 'reason': 'OPENAI_API_KEY not set'}

    client = OpenAI(api_key=OPENAI_API_KEY)

    diagnosis_data = {
        'query': query,
        'result_count': all_results['query_execution']['result_count'],
        'terminology_coverage': all_results['terminology_trace']['mapping_coverage'],
        'unmatched_tokens': all_results['terminology_trace']['unmatched_tokens'],
        'keyword_overlap_quality': all_results['keyword_overlap']['quality'],
        'avg_overlap': all_results['keyword_overlap']['avg_overlap_score'],
        'missed_content_count': all_results['missed_content']['missed_count'],
        'missed_examples': all_results['missed_content']['missed_content'][:3],
    }

    prompt = f"""You are diagnosing why a search query returned poor results in a marketing content database.

QUERY: "{query}"

DIAGNOSIS DATA:
{json.dumps(diagnosis_data, indent=2)}

Analyze the issue and respond with valid JSON only:
{{
  "root_cause": "Brief explanation of why results are poor",
  "severity": "high|medium|low",
  "recommended_fixes": [
    {{
      "fix_type": "add_terminology|improve_keywords|re_enrich|content_gap",
      "description": "What to do",
      "specifics": {{
        "user_term": "the term users are searching",
        "standard_term": "what it should map to",
        "affected_content_ids": ["id1", "id2"]
      }}
    }}
  ],
  "priority": "high|medium|low",
  "explanation": "2-3 sentence explanation for the user"
}}

Focus on:
1. Are terminology mappings missing for key search terms?
2. Do existing content items lack proper keywords?
3. Is there a content gap (users searching for content that doesn't exist)?
4. Are the right results present but ranked poorly?"""

    try:
        api_params = {
            "model": AI_MODEL,
            "messages": [
                {"role": "system", "content": "You are a search quality debugger. Analyze search issues and recommend specific fixes. Respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
        }
        # gpt-5.x: use max_completion_tokens, no temperature
        if AI_MODEL.startswith('gpt-5') or AI_MODEL.startswith('o'):
            api_params["max_completion_tokens"] = 1500
        else:
            api_params["temperature"] = 0.3
            api_params["max_tokens"] = 1500

        response = client.chat.completions.create(**api_params)
        content = response.choices[0].message.content

        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON from AI response', 'raw': content[:500]}

    except Exception as e:
        return {'error': str(e)}


def step_auto_fix(conn, diagnosis, dry_run=False, verbose=False):
    """Step 6: Optional auto-fix - insert suggested terminology mappings."""
    if 'recommended_fixes' not in diagnosis:
        return {'status': 'skipped', 'reason': 'No fixes to apply'}

    fixes_applied = []
    fixes_skipped = []

    for fix in diagnosis['recommended_fixes']:
        if fix.get('fix_type') == 'add_terminology':
            specifics = fix.get('specifics', {})
            user_term = specifics.get('user_term')
            standard_term = specifics.get('standard_term')

            if not user_term or not standard_term:
                fixes_skipped.append({'fix': fix, 'reason': 'Missing user_term or canonical_term'})
                continue

            if dry_run:
                fixes_applied.append({
                    'user_term': user_term,
                    'canonical_term': standard_term,
                    'dry_run': True,
                })
                if verbose:
                    print(f"    [DRY RUN] Would add mapping: {user_term} -> {standard_term}")
            else:
                try:
                    with conn.cursor() as cur:
                        cur.execute("""
                            INSERT INTO terminology_map (user_term, canonical_term, source, usage_count)
                            VALUES (%s, %s, 'auto_diagnose', 0)
                            ON CONFLICT (user_term) DO NOTHING
                        """, (user_term, standard_term))
                    conn.commit()
                    fixes_applied.append({
                        'user_term': user_term,
                        'canonical_term': standard_term,
                        'applied': True,
                    })
                    if verbose:
                        print(f"    Added mapping: {user_term} -> {standard_term}")
                except Exception as e:
                    fixes_skipped.append({'fix': fix, 'reason': str(e)})
        else:
            fixes_skipped.append({'fix': fix, 'reason': f"Fix type '{fix.get('fix_type')}' not supported by auto-fix"})

    return {
        'status': 'applied' if fixes_applied else 'none_applicable',
        'fixes_applied': fixes_applied,
        'fixes_skipped': fixes_skipped,
        'total_applied': len(fixes_applied),
    }


def diagnose_query(conn, query, args):
    """Run full diagnosis on a single query."""
    print(f"\n{'='*60}")
    print(f"DIAGNOSING: \"{query}\"")
    print('='*60)

    all_results = {}

    # Step 1: Execute query
    print(f"\n[1/6] Executing query...")
    qe = step_execute_query(conn, query, args.verbose)
    all_results['query_execution'] = qe
    print(f"  Results: {qe['result_count']}")

    # Step 2: Trace terminology
    print(f"\n[2/6] Tracing terminology mappings...")
    tt = step_trace_terminology(conn, query, qe['tokens'], args.verbose)
    all_results['terminology_trace'] = tt
    print(f"  Coverage: {tt['mapping_coverage']}%, Unmatched: {len(tt['unmatched_tokens'])}")

    # Step 3: Keyword overlap
    print(f"\n[3/6] Analyzing keyword overlap...")
    ko = step_keyword_overlap_analysis(conn, query, qe['tokens'], qe['results'], args.verbose)
    all_results['keyword_overlap'] = ko
    print(f"  Quality: {ko['quality']}, Avg overlap: {ko['avg_overlap_score']}")

    # Step 4: Missed content
    print(f"\n[4/6] Finding missed content...")
    mc = step_find_missed_content(conn, query, qe['tokens'], qe['results'], args.verbose)
    all_results['missed_content'] = mc
    print(f"  Missed: {mc['missed_count']} items")

    # Step 5: AI diagnosis
    print(f"\n[5/6] AI diagnosis...")
    diag = step_ai_diagnosis(query, all_results, args.verbose)
    all_results['diagnosis'] = diag
    if 'root_cause' in diag:
        print(f"  Root cause: {diag['root_cause'][:80]}")
        print(f"  Severity: {diag.get('severity', 'unknown')}")
        print(f"  Fixes: {len(diag.get('recommended_fixes', []))}")
    elif 'error' in diag:
        print(f"  Error: {diag['error']}")

    # Step 6: Auto-fix
    if args.auto_fix:
        print(f"\n[6/6] Applying auto-fixes...")
        af = step_auto_fix(conn, diag, args.dry_run, args.verbose)
        all_results['auto_fix'] = af
        print(f"  Applied: {af['total_applied']}, Skipped: {len(af.get('fixes_skipped', []))}")
    else:
        print(f"\n[6/6] Auto-fix skipped (use --auto-fix to enable)")
        all_results['auto_fix'] = {'status': 'skipped', 'reason': '--auto-fix not specified'}

    return all_results


def print_diagnosis_summary(results):
    """Print formatted diagnosis summary."""
    print(f"\n{'='*60}")
    print("DIAGNOSIS SUMMARY")
    print('='*60)

    diag = results.get('diagnosis', {})
    if 'explanation' in diag:
        print(f"\n{diag['explanation']}")

    if 'recommended_fixes' in diag:
        print(f"\nRecommended Fixes ({len(diag['recommended_fixes'])}):")
        for i, fix in enumerate(diag['recommended_fixes'], 1):
            print(f"  {i}. [{fix.get('fix_type', 'unknown')}] {fix.get('description', 'N/A')}")
            specs = fix.get('specifics', {})
            if specs.get('user_term') and specs.get('standard_term'):
                print(f"     Map: '{specs['user_term']}' -> '{specs['standard_term']}'")

    af = results.get('auto_fix', {})
    if af.get('fixes_applied'):
        print(f"\nAuto-fixes Applied:")
        for fix in af['fixes_applied']:
            canonical_term = fix.get('canonical_term', fix.get('standard_term', 'unknown'))
            print(f"  + {fix['user_term']} -> {canonical_term}")


def main():
    parser = argparse.ArgumentParser(description='Search quality debugging agent')
    parser.add_argument('query', nargs='?', help='The search query to diagnose')
    parser.add_argument('--query-id', type=str, help='Diagnose a specific logged query by UUID')
    parser.add_argument('--worst', type=int, help='Auto-diagnose N worst zero-result queries from last 7 days')
    parser.add_argument('--auto-fix', action='store_true', help='Automatically apply suggested terminology mappings')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    print("=" * 60)
    print("Search Quality Debugging Agent")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()
    all_diagnoses = []

    try:
        # Mode 1: Specific query
        if args.query:
            result = diagnose_query(conn, args.query, args)
            print_diagnosis_summary(result)
            all_diagnoses.append(result)

        # Mode 2: Query by ID
        elif args.query_id:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT query, recommendations_count
                    FROM ai_prompt_logs
                    WHERE id = %s
                """, (args.query_id,))
                log = cur.fetchone()

            if not log:
                print(f"ERROR: Query ID {args.query_id} not found")
                sys.exit(1)

            print(f"Found logged query: \"{log['query']}\" ({log['recommendations_count']} results)")
            result = diagnose_query(conn, log['query'], args)
            print_diagnosis_summary(result)
            all_diagnoses.append(result)

        # Mode 3: Worst N queries
        elif args.worst:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT query, COUNT(*) as query_count
                    FROM ai_prompt_logs
                    WHERE created_at > NOW() - INTERVAL '7 days'
                    AND (recommendations_count = 0 OR recommendations_count IS NULL)
                    GROUP BY query
                    ORDER BY query_count DESC
                    LIMIT %s
                """, (args.worst,))
                worst_queries = cur.fetchall()

            print(f"\nFound {len(worst_queries)} worst zero-result queries:")
            for wq in worst_queries:
                print(f"  - \"{wq['query']}\" ({wq['query_count']} times)")

            for wq in worst_queries:
                result = diagnose_query(conn, wq['query'], args)
                all_diagnoses.append(result)
                print_diagnosis_summary(result)

        else:
            print("ERROR: Must provide --query, --query-id, or --worst N")
            parser.print_help()
            sys.exit(1)

        # Save report
        if args.output:
            report = {
                'agent': 'diagnose-search',
                'version': '1.0.0',
                'timestamp': datetime.now().isoformat(),
                'diagnoses': all_diagnoses,
                'total_queries': len(all_diagnoses),
            }
            with open(args.output, 'w') as f:
                json.dump(report, f, indent=2, cls=DecimalEncoder)
            print(f"\n  Report saved to {args.output}")

    finally:
        conn.close()

    print("\nDone!")


if __name__ == '__main__':
    main()
